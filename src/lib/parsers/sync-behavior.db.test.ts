/**
 * Characterization tests for the parser → database write layer.
 *
 * These pin the pre-reconciliation contracts that must survive the sync
 * rewrite (docs/TECHNICAL_AUDIT_2026-07-06.md findings #1/#5):
 *
 *   1. Re-parsing the same file converges — no duplicate rows.
 *   2. Null-merge updates — a parse that lacks a field never blanks a value
 *      an earlier parse (or the user) supplied.
 *   3. Manual single-file parses are ADDITIVE — parsing a file that omits a
 *      component does not delete it. (Reconciliation is a folder-sync-path
 *      behavior only; the manual upload path keeps this contract.)
 *   4. A pin moving to a different net rewires its Connection in place.
 *   5. The layout parse touches only placement columns / the Board row, and
 *      creates placement-only components (fiducials, mounting holes).
 *   6. BOM parse links refs, reports unlinked refs, writes MPN back onto
 *      linked components, and converges on re-parse.
 */
import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

import { beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { parseBomFile } from "./bomParser";
import { persistPcbLayout } from "./kicadPcbParser";
import { parseNetlistFile } from "./netlistParser";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sync-behavior-"));
});

async function makeProject(): Promise<string> {
  const project = await prisma.project.create({
    data: { name: `test-${Math.random().toString(36).slice(2)}` },
  });
  return project.id;
}

async function writeFixture(name: string, content: string): Promise<string> {
  const filePath = path.join(
    dir,
    `${Math.random().toString(36).slice(2)}-${name}`
  );
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

/** Two components, two nets, four pins — the smallest interesting board. */
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

async function counts(projectId: string) {
  const [components, nets, pins, connections] = await Promise.all([
    prisma.component.count({ where: { projectId } }),
    prisma.net.count({ where: { projectId } }),
    prisma.pin.count({ where: { component: { projectId } } }),
    prisma.connection.count({ where: { net: { projectId } } }),
  ]);
  return { components, nets, pins, connections };
}

describe("netlist parse → DB", () => {
  it("re-parsing the same file converges with no duplicates", async () => {
    const projectId = await makeProject();
    const file = await writeFixture("board.net", NETLIST);

    const first = await parseNetlistFile(projectId, file);
    expect(first.componentCount).toBe(2);
    expect(first.netCount).toBe(2);
    expect(first.connectionCount).toBe(4);

    await parseNetlistFile(projectId, file);
    expect(await counts(projectId)).toEqual({
      components: 2,
      nets: 2,
      pins: 4,
      connections: 4,
    });
  });

  it("null-merge: a parse without a name/footprint does not blank them", async () => {
    const projectId = await makeProject();
    await parseNetlistFile(projectId, await writeFixture("full.net", NETLIST));

    // Same R1 but the component block carries only the refdes — parseText
    // yields footprint/name = null, and the upsert must skip those fields.
    const sparse = `[
R1
]
(
NET1
R1-1
)
`;
    await parseNetlistFile(projectId, await writeFixture("sparse.net", sparse));

    const r1 = await prisma.component.findUniqueOrThrow({
      where: { projectId_refDes: { projectId, refDes: "R1" } },
    });
    expect(r1.footprint).toBe("0603");
    expect(r1.name).toBe("10k resistor");
  });

  it("manual path is additive: a file omitting U1 does not delete U1", async () => {
    const projectId = await makeProject();
    await parseNetlistFile(projectId, await writeFixture("board.net", NETLIST));

    const withoutU1 = `[
R1
0603
10k resistor
]
(
GND
R1-2
)
`;
    await parseNetlistFile(
      projectId,
      await writeFixture("partial.net", withoutU1)
    );

    const u1 = await prisma.component.findUnique({
      where: { projectId_refDes: { projectId, refDes: "U1" } },
    });
    expect(u1).not.toBeNull();
  });

  it("a pin moving nets rewires its connection in place", async () => {
    const projectId = await makeProject();
    await parseNetlistFile(projectId, await writeFixture("board.net", NETLIST));

    // R1-1 moves from NET1 to GND.
    const rewired = NETLIST.replace("NET1\nR1-1\n", "NET1\n").replace(
      "GND\nR1-2\n",
      "GND\nR1-1\nR1-2\n"
    );
    await parseNetlistFile(
      projectId,
      await writeFixture("rewired.net", rewired)
    );

    const gnd = await prisma.net.findUniqueOrThrow({
      where: { projectId_name: { projectId, name: "GND" } },
      include: { connections: { include: { pin: true } } },
    });
    const gndPins = gnd.connections.map((c) => c.pin.number).sort();
    expect(gndPins).toContain("1");
    // Still exactly one connection per pin (4 pins total).
    expect((await counts(projectId)).connections).toBe(4);
  });
});

describe("layout persist → DB", () => {
  it("touches only placement columns and creates placement-only components", async () => {
    const projectId = await makeProject();
    await parseNetlistFile(projectId, await writeFixture("board.net", NETLIST));

    await persistPcbLayout(
      projectId,
      {
        placements: [
          { refDes: "R1", x: 10.5, y: 20.25, rotation: 90, layer: "F.Cu" },
          // A fiducial exists in the .kicad_pcb but never in the netlist.
          { refDes: "FID1", x: 1, y: 1, rotation: 0, layer: "F.Cu" },
        ],
        board: {
          widthMm: 100,
          heightMm: 80,
          copperLayers: ["F.Cu", "B.Cu"],
          layerCount: 2,
          zones: [{ netName: "GND", layer: "B.Cu" }],
        },
      },
      "board.kicad_pcb"
    );

    const r1 = await prisma.component.findUniqueOrThrow({
      where: { projectId_refDes: { projectId, refDes: "R1" } },
    });
    // Placement written…
    expect(r1.posX).toBe(10.5);
    expect(r1.layer).toBe("F.Cu");
    // …netlist facts untouched.
    expect(r1.name).toBe("10k resistor");
    expect(r1.footprint).toBe("0603");

    const fid = await prisma.component.findUniqueOrThrow({
      where: { projectId_refDes: { projectId, refDes: "FID1" } },
    });
    expect(fid.posX).toBe(1);
    expect(fid.name).toBeNull();

    // One Board row per project, updated in place on re-persist.
    await persistPcbLayout(
      projectId,
      {
        placements: [],
        board: {
          widthMm: 101,
          heightMm: 80,
          copperLayers: ["F.Cu", "B.Cu"],
          layerCount: 2,
          zones: [],
        },
      },
      "board.kicad_pcb"
    );
    const boards = await prisma.board.findMany({ where: { projectId } });
    expect(boards).toHaveLength(1);
    expect(boards[0].widthMm).toBe(101);
  });
});

describe("BOM parse → DB", () => {
  const BOM_CSV = `Designator,Description,Manufacturer,MPN,Value,Footprint,Quantity
R1,Chip resistor,Yageo,RC0603FR-0710KL,10k,0603,1
U9,Ghost part,Nowhere,NOPART-1,,SOIC-8,1
`;

  it("links refs, reports unlinked, writes MPN back, converges on re-parse", async () => {
    const projectId = await makeProject();
    await parseNetlistFile(projectId, await writeFixture("board.net", NETLIST));

    const file = await writeFixture("bom.csv", BOM_CSV);
    const summary = await parseBomFile(projectId, file);

    expect(summary.rowCount).toBe(2);
    expect(summary.unlinkedRefDes).toContain("U9");

    // MPN written back onto the linked component.
    const r1 = await prisma.component.findUniqueOrThrow({
      where: { projectId_refDes: { projectId, refDes: "R1" } },
    });
    expect(r1.mpn).toBe("RC0603FR-0710KL");

    // Re-parse updates rows instead of duplicating them.
    await parseBomFile(projectId, file);
    expect(await prisma.bomItem.count({ where: { projectId } })).toBe(2);
  });
});

describe("concurrent writers → DB (project write lock)", () => {
  // Regression: two syncs overlapping (aborted request still running server-
  // side + a re-click, or watcher + manual sync) both read "component missing"
  // and both created it — the loser died on the (projectId, refDes) unique
  // constraint. writeConnectivity/persistPcbLayout now serialize per project.
  it("parallel netlist parses of the same project all succeed and converge", async () => {
    const projectId = await makeProject();
    const file = await writeFixture("board.net", NETLIST);

    await Promise.all([
      parseNetlistFile(projectId, file),
      parseNetlistFile(projectId, file),
      parseNetlistFile(projectId, file),
    ]);

    expect(await counts(projectId)).toEqual({
      components: 2,
      nets: 2,
      pins: 4,
      connections: 4,
    });
  });

  it("netlist parse racing a layout persist does not duplicate components", async () => {
    const projectId = await makeProject();
    const file = await writeFixture("board.net", NETLIST);
    const layout = {
      placements: [
        { refDes: "R1", x: 1, y: 2, rotation: 0, layer: "F.Cu" },
        { refDes: "U1", x: 3, y: 4, rotation: 90, layer: "F.Cu" },
      ],
      board: {
        widthMm: 10,
        heightMm: 10,
        copperLayers: ["F.Cu", "B.Cu"],
        layerCount: 2,
        zones: [],
      },
    };

    await Promise.all([
      parseNetlistFile(projectId, file),
      persistPcbLayout(projectId, layout, "board.kicad_pcb"),
    ]);

    expect(await prisma.component.count({ where: { projectId } })).toBe(2);
  });
});
