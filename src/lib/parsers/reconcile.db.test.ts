/**
 * Tests for the NEW sync-authoritative semantics (audit finding #1):
 *
 *   - prune (kicad_sync provenance): nets/pins absent from a fresh parse are
 *     deleted; manual parses stay additive; the shrink guard refuses deletes
 *     when the parse looks partial.
 *   - reconcileComponents (folder-sync path): components in neither the fresh
 *     netlist nor the fresh layout are deleted; layout-only parts survive;
 *     placements clear when a part leaves the board; shrink guard applies.
 *
 * The pre-existing contracts these must NOT disturb are pinned separately in
 * sync-behavior.db.test.ts.
 */
import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

import { beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { reconcileComponents } from "@/server/services/folder-sync-service";

import { persistPcbLayout, type PcbLayoutSummary } from "./kicadPcbParser";
import { parseNetlistFile } from "./netlistParser";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "reconcile-"));
});

async function makeProject(): Promise<string> {
  const project = await prisma.project.create({
    data: { name: `test-${Math.random().toString(36).slice(2)}` },
  });
  return project.id;
}

async function writeFixture(name: string, content: string): Promise<string> {
  const filePath = path.join(dir, `${Math.random().toString(36).slice(2)}-${name}`);
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

const NETLIST = `[
R1
0603
10k resistor
]
[
U1
SOIC-8
OpAmp
]
(
NET1
R1-1
U1-1
)
(
GND
R1-2
U1-4
)
`;

/** R1 pin 2 and the GND net are gone; U1 keeps both pins on NET1. */
const NETLIST_TRIMMED = `[
R1
0603
10k resistor
]
[
U1
SOIC-8
OpAmp
]
(
NET1
R1-1
U1-1
U1-4
)
`;

function layoutOf(placedRefDes: string[]): PcbLayoutSummary {
  return {
    placedCount: placedRefDes.length,
    layerCount: 2,
    widthMm: 100,
    heightMm: 80,
    zoneCount: 0,
    placedRefDes,
  };
}

describe("prune (sync provenance)", () => {
  it("deletes nets and pins absent from a fresh pruning parse", async () => {
    const projectId = await makeProject();
    await parseNetlistFile(projectId, await writeFixture("a.net", NETLIST), {
      prune: true,
    });

    const summary = await parseNetlistFile(
      projectId,
      await writeFixture("b.net", NETLIST_TRIMMED),
      { prune: true }
    );

    expect(summary.pruned).toEqual({ netsDeleted: 1, pinsDeleted: 1 });
    const nets = await prisma.net.findMany({ where: { projectId } });
    expect(nets.map((n) => n.name)).toEqual(["NET1"]);
    const r1Pins = await prisma.pin.findMany({
      where: { component: { projectId, refDes: "R1" } },
    });
    expect(r1Pins.map((p) => p.number)).toEqual(["1"]);
    // No orphaned connections: 3 fresh pin refs → 3 connections.
    expect(
      await prisma.connection.count({ where: { net: { projectId } } })
    ).toBe(3);
  });

  it("without prune, the same re-parse keeps stale nets and pins (manual path)", async () => {
    const projectId = await makeProject();
    await parseNetlistFile(projectId, await writeFixture("a.net", NETLIST));

    const summary = await parseNetlistFile(
      projectId,
      await writeFixture("b.net", NETLIST_TRIMMED)
    );

    expect(summary.pruned).toBeUndefined();
    expect(await prisma.net.count({ where: { projectId } })).toBe(2);
    expect(
      await prisma.pin.count({ where: { component: { projectId } } })
    ).toBe(4);
  });

  it("shrink guard: a drastically smaller parse upserts but refuses to delete", async () => {
    const projectId = await makeProject();
    // 30 single-pin nets → 30 nets, 30 pins (over the guard's minimum rows).
    const big = Array.from({ length: 30 }, (_, i) => `(
NET${i}
R${i}-1
)`).join("\n");
    await parseNetlistFile(projectId, await writeFixture("big.net", big), {
      prune: true,
    });

    const tiny = `(
NET0
R0-1
)`;
    const summary = await parseNetlistFile(
      projectId,
      await writeFixture("tiny.net", tiny),
      { prune: true }
    );

    expect(summary.pruned?.skippedReason).toMatch(/looks partial/);
    expect(summary.pruned?.netsDeleted).toBe(0);
    expect(await prisma.net.count({ where: { projectId } })).toBe(30);
  });
});

describe("reconcileComponents (folder-sync path)", () => {
  it("deletes components absent from the netlist ∪ layout union; fiducials survive", async () => {
    const projectId = await makeProject();
    await parseNetlistFile(projectId, await writeFixture("a.net", NETLIST), {
      prune: true,
    });
    await persistPcbLayout(
      projectId,
      {
        placements: [
          { refDes: "R1", x: 10, y: 10, rotation: 0, layer: "F.Cu" },
          { refDes: "U1", x: 20, y: 20, rotation: 0, layer: "F.Cu" },
          { refDes: "FID1", x: 1, y: 1, rotation: 0, layer: "F.Cu" },
        ],
        board: {
          widthMm: 100,
          heightMm: 80,
          copperLayers: ["F.Cu", "B.Cu"],
          layerCount: 2,
          zones: [],
        },
      },
      "board.kicad_pcb"
    );

    // Next sync: U1 was deleted in KiCad. Fresh netlist has R1 only; fresh
    // layout has R1 + the fiducial.
    const summary = await reconcileComponents(
      projectId,
      new Set(["R1", "FID1"]),
      layoutOf(["R1", "FID1"])
    );

    expect(summary.componentsDeleted).toBe(1);
    const refs = (
      await prisma.component.findMany({ where: { projectId } })
    ).map((c) => c.refDes);
    expect(refs.sort()).toEqual(["FID1", "R1"]);
    // U1's pins and connections cascaded away.
    expect(
      await prisma.pin.count({ where: { component: { projectId } } })
    ).toBe(2);
  });

  it("clears placement for a part still in the schematic but off the board", async () => {
    const projectId = await makeProject();
    await parseNetlistFile(projectId, await writeFixture("a.net", NETLIST));
    await persistPcbLayout(
      projectId,
      {
        placements: [
          { refDes: "R1", x: 10, y: 10, rotation: 0, layer: "F.Cu" },
          { refDes: "U1", x: 20, y: 20, rotation: 0, layer: "F.Cu" },
        ],
        board: {
          widthMm: 100,
          heightMm: 80,
          copperLayers: ["F.Cu", "B.Cu"],
          layerCount: 2,
          zones: [],
        },
      },
      "board.kicad_pcb"
    );

    // U1 still in the netlist but no longer placed.
    const summary = await reconcileComponents(
      projectId,
      new Set(["R1", "U1"]),
      layoutOf(["R1"])
    );

    expect(summary.componentsDeleted).toBe(0);
    expect(summary.placementsCleared).toBe(1);
    const u1 = await prisma.component.findUniqueOrThrow({
      where: { projectId_refDes: { projectId, refDes: "U1" } },
    });
    expect(u1.posX).toBeNull();
    expect(u1.layer).toBeNull();
    // R1's placement is untouched.
    const r1 = await prisma.component.findUniqueOrThrow({
      where: { projectId_refDes: { projectId, refDes: "R1" } },
    });
    expect(r1.posX).toBe(10);
  });

  it("shrink guard: refuses to delete most of a non-trivial project", async () => {
    const projectId = await makeProject();
    const big = Array.from({ length: 30 }, (_, i) => `[
R${i}
0603
part
]`).join("\n");
    // Netlist needs at least one net to parse; give R0 a pin.
    await parseNetlistFile(
      projectId,
      await writeFixture("big.net", `${big}\n(\nNET0\nR0-1\n)`)
    );

    const summary = await reconcileComponents(projectId, new Set(["R0"]), null);

    expect(summary.skippedReason).toMatch(/kept existing rows/);
    expect(summary.componentsDeleted).toBe(0);
    expect(await prisma.component.count({ where: { projectId } })).toBe(30);
  });
});
