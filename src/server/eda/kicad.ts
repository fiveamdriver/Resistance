/**
 * KiCad adapter: recognizes a .kicad_pro/.kicad_sch project folder and
 * produces fresh netlist + BOM exports via kicad-cli. Mirrors the discovery
 * rules of the kicad-mcp server (packages/kicad-mcp/src/kicad_mcp/config.py):
 * root schematic = the .kicad_sch matching a .kicad_pro basename, because
 * hierarchical subsheets live in the same directory and a bare glob would be
 * ambiguous.
 */
import "server-only";

import { execFile } from "child_process";
import { readdirSync, readFileSync } from "fs";
import { mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";

import { AppError } from "@/lib/errors";
import { detectKicadCli } from "@/lib/kicad-cli";
import { getSettings } from "@/server/services/settings-service";

import type { EdaAdapter, EdaExport, EdaExportPlan, EdaProjectInfo } from "./types";

const execFileAsync = promisify(execFile);
const EXPORT_TIMEOUT_MS = 60_000;

/** Directories that are never interesting: VCS, KiCad autosaves, build junk.
 *  Shared with the folder-sync document scan so both walks agree. */
export const SKIP_DIRS = new Set([".git", ".svn", "node_modules", "__pycache__"]);
export const SKIP_DIR_SUFFIX = "-backups";
export const MAX_SCAN_DEPTH = 4;

/** BOM columns: the parser's alias table resolves all of these; unknown
 *  symbol fields (MPN on parts that lack it) come out as empty cells. */
const BOM_FIELDS = "Reference,Value,Footprint,Datasheet,MPN,${QUANTITY},${DNP}";

function listFiles(dir: string, ext: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(ext))
    .map((e) => path.join(dir, e.name))
    .sort();
}

/** e.g. (generator_version "10.0") in the file header. */
function readGeneratorVersion(file: string): string | null {
  try {
    const head = readFileSync(file, "utf8").slice(0, 2000);
    return /\(generator_version\s+"([^"]+)"/.exec(head)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function resolveKicadCli(): Promise<string> {
  const { kicadCliPath } = await getSettings();
  const detection = await detectKicadCli(kicadCliPath);
  if (!detection.cli) {
    throw new AppError(
      "FEATURE_DISABLED",
      detection.overrideError ??
        "kicad-cli was not found. Install KiCad, or set its path in Settings."
    );
  }
  return detection.cli.path;
}

async function runKicadCli(args: string[]): Promise<void> {
  const bin = await resolveKicadCli();
  try {
    // kicad-cli prints harmless Fontconfig noise on stderr; only a non-zero
    // exit is an error, and its message is engineer-readable.
    await execFileAsync(bin, args, { timeout: EXPORT_TIMEOUT_MS });
  } catch (err) {
    const detail =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr: unknown }).stderr).trim()
        : String(err);
    throw new AppError("PARSE_ERROR", `kicad-cli failed: ${detail.slice(0, 500)}`);
  }
}

export const kicadAdapter: EdaAdapter = {
  id: "kicad",
  displayName: "KiCad",

  async detect(dir: string): Promise<EdaProjectInfo | null> {
    const proFiles = listFiles(dir, ".kicad_pro");
    const schFiles = listFiles(dir, ".kicad_sch");
    const pcbFiles = listFiles(dir, ".kicad_pcb");
    if (schFiles.length === 0) return null;

    // Root schematic: .kicad_sch matching a .kicad_pro stem; else, if the
    // folder has exactly one schematic, that one; else ambiguous → not
    // detectable (the engineer can still import files individually).
    let schematic: string | null = null;
    let name: string | null = null;
    let projectFile: string | null = null;
    for (const pro of proFiles) {
      const candidate = pro.replace(/\.kicad_pro$/, ".kicad_sch");
      if (schFiles.includes(candidate)) {
        schematic = candidate;
        name = path.basename(pro, ".kicad_pro");
        projectFile = pro;
        break;
      }
    }
    if (!schematic && schFiles.length === 1) {
      schematic = schFiles[0];
      name = path.basename(schematic, ".kicad_sch");
      projectFile = proFiles.length === 1 ? proFiles[0] : null;
    }
    if (!schematic || !name) return null;

    // Board: prefer the stem match; a single board also counts. Multiple
    // unmatched boards (test jigs, panels) → leave null rather than guess.
    const stemBoard = schematic.replace(/\.kicad_sch$/, ".kicad_pcb");
    const board = pcbFiles.includes(stemBoard)
      ? stemBoard
      : pcbFiles.length === 1
        ? pcbFiles[0]
        : null;

    return {
      adapterId: "kicad",
      name,
      schematic,
      projectFile,
      board,
      designFiles: [...schFiles, ...pcbFiles],
      generatorVersion: readGeneratorVersion(board ?? schematic),
    };
  },

  plannedExports(info: EdaProjectInfo): EdaExportPlan[] {
    return [
      { filename: `${info.name}.net`, kind: "netlist" },
      { filename: `${info.name}-bom.csv`, kind: "bom" },
    ];
  },

  async exportArtifacts(info: EdaProjectInfo): Promise<EdaExport[]> {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "resistance-kicad-"));
    try {
      const netOut = path.join(tmp, `${info.name}.net`);
      const bomOut = path.join(tmp, `${info.name}-bom.csv`);

      await runKicadCli([
        "sch", "export", "netlist",
        "--format", "kicadsexpr",
        "--output", netOut,
        info.schematic,
      ]);
      await runKicadCli([
        "sch", "export", "bom",
        "--fields", BOM_FIELDS,
        "--output", bomOut,
        info.schematic,
      ]);

      return [
        { filename: path.basename(netOut), kind: "netlist", content: await readFile(netOut) },
        { filename: path.basename(bomOut), kind: "bom", content: await readFile(bomOut) },
      ];
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  },
};

/** Registered adapters, tried in order. KiCad is the only one today; an
 *  Altium adapter (manual-export tier) slots in here. */
export const edaAdapters: EdaAdapter[] = [kicadAdapter];

export async function detectEdaProject(
  dir: string
): Promise<{ adapter: EdaAdapter; info: EdaProjectInfo } | null> {
  for (const adapter of edaAdapters) {
    const info = await adapter.detect(dir);
    if (info) return { adapter, info };
  }
  return null;
}

export interface DetectedEdaProject {
  /** Directory the project lives in (absolute). */
  dir: string;
  adapter: EdaAdapter;
  info: EdaProjectInfo;
}

export interface LegacyKicadProject {
  /** Directory the legacy project lives in (absolute). */
  dir: string;
  /** Directory basename — legacy dirs often hold one .pro per sheet, so the
   *  folder, not a file stem, is the project's identity. */
  name: string;
  /** Root project file to open in KiCad (absolute): the .pro whose stem
   *  matches the directory name, else the lone .pro, else null. */
  rootPro: string | null;
}

/** Depth-first list of `root` and its scannable subdirectories. */
function listScanDirs(root: string): string[] {
  const dirs: string[] = [];
  const visit = (dir: string, depth: number) => {
    dirs.push(dir);
    if (depth >= MAX_SCAN_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable subdir — skip it, not the whole scan
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      if (SKIP_DIRS.has(entry.name) || entry.name.endsWith(SKIP_DIR_SUFFIX)) continue;
      visit(path.join(dir, entry.name), depth + 1);
    }
  };
  visit(root, 0);
  return dirs;
}

/**
 * Find every EDA project in `root` or any subdirectory (a linked folder is
 * often a whole repo with designs nested under e.g. Hardware/<board>/).
 * Detection stays per-directory so hierarchical-sheet rules keep working.
 */
export async function findEdaProjects(root: string): Promise<DetectedEdaProject[]> {
  const found: DetectedEdaProject[] = [];
  for (const dir of listScanDirs(root)) {
    const detected = await detectEdaProject(dir);
    if (detected) found.push({ dir, ...detected });
  }
  return found;
}

/**
 * Directories holding a legacy (KiCad ≤5) project: .pro + .sch but no
 * .kicad_sch. kicad-cli cannot export from these, so they are reported for a
 * "convert in KiCad 6+" hint rather than detected as syncable projects.
 */
export async function findLegacyKicadProjects(
  root: string
): Promise<LegacyKicadProject[]> {
  const found: LegacyKicadProject[] = [];
  for (const dir of listScanDirs(root)) {
    // endsWith matching would let .kicad_pro/.kicad_sch shadow the legacy
    // extensions, so exclude the modern forms explicitly.
    const legacyPro = listFiles(dir, ".pro").filter((f) => !f.endsWith(".kicad_pro"));
    const legacySch = listFiles(dir, ".sch").filter((f) => !f.endsWith(".kicad_sch"));
    if (
      listFiles(dir, ".kicad_sch").length === 0 &&
      legacyPro.length > 0 &&
      legacySch.length > 0
    ) {
      const name = path.basename(dir);
      const rootPro =
        legacyPro.find(
          (f) => path.basename(f, ".pro").toLowerCase() === name.toLowerCase()
        ) ?? (legacyPro.length === 1 ? legacyPro[0] : null);
      found.push({ dir, name, rootPro });
    }
  }
  return found;
}
