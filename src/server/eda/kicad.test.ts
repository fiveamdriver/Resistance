import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findEdaProjects, findLegacyKicadProjects } from "./kicad";

let root: string;

function put(relPath: string, content = ""): void {
  const abs = path.join(root, relPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "kicad-discovery-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("findEdaProjects", () => {
  it("finds a project at the linked root", async () => {
    put("Board.kicad_pro");
    put("Board.kicad_sch");
    put("Board.kicad_pcb");

    const found = await findEdaProjects(root);
    expect(found).toHaveLength(1);
    expect(found[0].dir).toBe(root);
    expect(found[0].info.name).toBe("Board");
  });

  it("finds projects nested in subdirectories", async () => {
    put("Hardware/Alpha/Alpha.kicad_pro");
    put("Hardware/Alpha/Alpha.kicad_sch");
    put("Hardware/Beta/Beta.kicad_pro");
    put("Hardware/Beta/Beta.kicad_sch");
    put("Firmware/main.c");

    const found = await findEdaProjects(root);
    expect(found.map((p) => p.info.name).sort()).toEqual(["Alpha", "Beta"]);
    expect(found.map((p) => path.relative(root, p.dir)).sort()).toEqual([
      path.join("Hardware", "Alpha"),
      path.join("Hardware", "Beta"),
    ]);
  });

  it("skips VCS, backup, and hidden directories", async () => {
    put(".git/Ghost/Ghost.kicad_pro");
    put(".git/Ghost/Ghost.kicad_sch");
    put("Board-backups/Old/Old.kicad_pro");
    put("Board-backups/Old/Old.kicad_sch");
    put(".hidden/H/H.kicad_pro");
    put(".hidden/H/H.kicad_sch");

    expect(await findEdaProjects(root)).toHaveLength(0);
  });

  it("ignores directories beyond the depth limit", async () => {
    put("a/b/c/d/e/Deep.kicad_pro");
    put("a/b/c/d/e/Deep.kicad_sch");

    expect(await findEdaProjects(root)).toHaveLength(0);
  });
});

describe("findLegacyKicadProjects", () => {
  it("flags dirs with .pro + .sch and no .kicad_sch", async () => {
    put("Hardware/Hades/Hades.pro");
    put("Hardware/Hades/Hades.sch");
    put("Hardware/Hades/FCC.sch");
    put("Hardware/Hades/Hades.kicad_pcb");

    const legacy = await findLegacyKicadProjects(root);
    expect(legacy).toHaveLength(1);
    expect(legacy[0].name).toBe("Hades");
    expect(path.relative(root, legacy[0].dir)).toBe(path.join("Hardware", "Hades"));
  });

  it("does not flag modern or converted projects", async () => {
    // Modern project: .kicad_pro/.kicad_sch must not read as legacy .pro/.sch.
    put("Modern/Board.kicad_pro");
    put("Modern/Board.kicad_sch");
    // Converted in place: legacy files still present alongside .kicad_sch.
    put("Converted/Board.pro");
    put("Converted/Board.sch");
    put("Converted/Board.kicad_sch");

    expect(await findLegacyKicadProjects(root)).toHaveLength(0);
  });
});
