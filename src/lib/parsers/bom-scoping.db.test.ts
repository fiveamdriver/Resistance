/**
 * Tests for the NEW BOM source-scoping semantics (audit finding #3):
 *
 *   - Each file owns its rows: a re-parse supersedes only that file's rows,
 *     other sources are untouched.
 *   - Legacy fileId-null rows are adopted on the next matching parse.
 *   - Non-authoritative BOMs cannot silently rewrite Component.mpn; sync
 *     (authoritative) BOMs can.
 *   - Pick-and-place content is rejected by header shape.
 *
 * Pre-existing BOM behavior (linking, MPN fill, convergence) stays pinned in
 * sync-behavior.db.test.ts.
 */
import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

import { beforeAll, describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

import { parseBomFile } from "./bomParser";
import { parseNetlistFile } from "./netlistParser";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "bom-scoping-"));
});

async function makeProject(): Promise<string> {
  const project = await prisma.project.create({
    data: { name: `test-${Math.random().toString(36).slice(2)}` },
  });
  return project.id;
}

/** BomItem.fileId has a real FK — tests need genuine ProjectFile rows. */
async function makeFileRecord(projectId: string, name: string): Promise<string> {
  const record = await prisma.projectFile.create({
    data: {
      projectId,
      originalName: name,
      storedName: `${Math.random().toString(36).slice(2)}-${name}`,
      path: `test/${name}`,
      fileType: "text/csv",
      category: "bom",
    },
  });
  return record.id;
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
`;

describe("per-file BOM row ownership", () => {
  it("re-parse supersedes only this file's rows; other sources untouched", async () => {
    const projectId = await makeProject();
    await parseNetlistFile(projectId, await writeFixture("a.net", NETLIST));

    const fileA = await makeFileRecord(projectId, "bom-a.csv");
    const fileB = await makeFileRecord(projectId, "bom-b.csv");

    await parseBomFile(
      projectId,
      await writeFixture(
        "a.csv",
        `Designator,Description,Quantity\nR1,Resistor,1\nU1,OpAmp,1\n`
      ),
      { fileId: fileA }
    );
    await parseBomFile(
      projectId,
      await writeFixture("b.csv", `Designator,Description,Quantity\nJ9,Connector,1\n`),
      { fileId: fileB }
    );
    expect(await prisma.bomItem.count({ where: { projectId } })).toBe(3);

    // File A drops U1. Its row goes; file B's row survives.
    await parseBomFile(
      projectId,
      await writeFixture("a2.csv", `Designator,Description,Quantity\nR1,Resistor,1\n`),
      { fileId: fileA }
    );
    const rows = await prisma.bomItem.findMany({ where: { projectId } });
    expect(rows.map((r) => r.refDesRaw).sort()).toEqual(["J9", "R1"]);
  });

  it("adopts legacy fileId-null rows instead of duplicating them", async () => {
    const projectId = await makeProject();
    // A pre-migration row: no fileId.
    await prisma.bomItem.create({
      data: { projectId, refDesRaw: "R1", description: "legacy", quantity: 1 },
    });

    const fileA = await makeFileRecord(projectId, "bom.csv");
    await parseBomFile(
      projectId,
      await writeFixture("a.csv", `Designator,Description,Quantity\nR1,Resistor,1\n`),
      { fileId: fileA }
    );

    const rows = await prisma.bomItem.findMany({ where: { projectId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].fileId).toBe(fileA);
    expect(rows[0].description).toBe("Resistor");
  });

  it("deleting a BOM file cascades its rows away", async () => {
    const projectId = await makeProject();
    const fileA = await makeFileRecord(projectId, "bom.csv");
    await parseBomFile(
      projectId,
      await writeFixture("a.csv", `Designator,Description,Quantity\nR9,Widget,1\n`),
      { fileId: fileA }
    );
    expect(await prisma.bomItem.count({ where: { projectId } })).toBe(1);

    await prisma.projectFile.delete({ where: { id: fileA } });
    expect(await prisma.bomItem.count({ where: { projectId } })).toBe(0);
  });
});

describe("MPN write-back authority", () => {
  const CSV = `Designator,MPN,Quantity\nR1,NEW-MPN-999,1\n`;

  it("non-authoritative BOM cannot overwrite an existing different MPN", async () => {
    const projectId = await makeProject();
    await parseNetlistFile(projectId, await writeFixture("a.net", NETLIST));
    await prisma.component.update({
      where: { projectId_refDes: { projectId, refDes: "R1" } },
      data: { mpn: "ORIGINAL-MPN" },
    });

    const fileA = await makeFileRecord(projectId, "loose.csv");
    await parseBomFile(projectId, await writeFixture("a.csv", CSV), {
      fileId: fileA,
      authoritative: false,
    });

    const r1 = await prisma.component.findUniqueOrThrow({
      where: { projectId_refDes: { projectId, refDes: "R1" } },
    });
    expect(r1.mpn).toBe("ORIGINAL-MPN");
  });

  it("non-authoritative BOM still fills an empty MPN", async () => {
    const projectId = await makeProject();
    await parseNetlistFile(projectId, await writeFixture("a.net", NETLIST));

    const fileA = await makeFileRecord(projectId, "loose.csv");
    await parseBomFile(projectId, await writeFixture("a.csv", CSV), {
      fileId: fileA,
      authoritative: false,
    });

    const r1 = await prisma.component.findUniqueOrThrow({
      where: { projectId_refDes: { projectId, refDes: "R1" } },
    });
    expect(r1.mpn).toBe("NEW-MPN-999");
  });

  it("authoritative (sync) BOM overwrites a conflicting MPN", async () => {
    const projectId = await makeProject();
    await parseNetlistFile(projectId, await writeFixture("a.net", NETLIST));
    await prisma.component.update({
      where: { projectId_refDes: { projectId, refDes: "R1" } },
      data: { mpn: "ORIGINAL-MPN" },
    });

    const fileA = await makeFileRecord(projectId, "sync.csv");
    await parseBomFile(projectId, await writeFixture("a.csv", CSV), {
      fileId: fileA,
      authoritative: true,
    });

    const r1 = await prisma.component.findUniqueOrThrow({
      where: { projectId_refDes: { projectId, refDes: "R1" } },
    });
    expect(r1.mpn).toBe("NEW-MPN-999");
  });
});

describe("pick-and-place rejection", () => {
  it("rejects CPL content by header shape", async () => {
    const projectId = await makeProject();
    const cpl = `Designator,Mid X,Mid Y,Layer,Rotation\nR1,10.5,20.1,Top,90\n`;
    await expect(
      parseBomFile(projectId, await writeFixture("cpl.csv", cpl))
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof AppError && /pick-and-place/i.test(e.message)
    );
    expect(await prisma.bomItem.count({ where: { projectId } })).toBe(0);
  });
});
