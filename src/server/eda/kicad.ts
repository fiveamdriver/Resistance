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
    for (const pro of proFiles) {
      const candidate = pro.replace(/\.kicad_pro$/, ".kicad_sch");
      if (schFiles.includes(candidate)) {
        schematic = candidate;
        name = path.basename(pro, ".kicad_pro");
        break;
      }
    }
    if (!schematic && schFiles.length === 1) {
      schematic = schFiles[0];
      name = path.basename(schematic, ".kicad_sch");
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
