/**
 * Node.js bridge to the kicad-mcp Python package.
 *
 * Each exported function shells into the kicad-mcp virtualenv via `uv run`
 * and returns parsed JSON. The project directory is read from syncMeta, which
 * the sync_to_resistance MCP tool stamps after each KiCad sync.
 *
 * These functions are intentionally kept thin: all the heavy lifting (kicad-cli
 * subprocess management, JSON report parsing, kiutils file parsing) lives in
 * the Python package and is reused here rather than reimplemented.
 */
import "server-only";

import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";

import { prisma } from "@/lib/prisma";

const execFileAsync = promisify(execFile);

const MCP_PACKAGE_DIR = path.resolve(process.cwd(), "packages/kicad-mcp");
const UV_TIMEOUT_MS = 120_000;

async function runPython(script: string): Promise<unknown> {
  const { stdout, stderr } = await execFileAsync(
    "uv",
    ["run", "python", "-c", script],
    { cwd: MCP_PACKAGE_DIR, timeout: UV_TIMEOUT_MS },
  );
  if (!stdout.trim()) {
    throw new Error(stderr.trim() || "kicad tool returned no output");
  }
  return JSON.parse(stdout);
}

export async function getKicadProjectDir(
  projectId: string,
): Promise<string | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { syncMeta: true },
  });
  if (!project?.syncMeta) return null;
  try {
    const meta = JSON.parse(project.syncMeta) as Record<string, unknown>;
    return typeof meta.kicadProjectDir === "string"
      ? meta.kicadProjectDir
      : null;
  } catch {
    return null;
  }
}

export type DrcViolation = {
  severity: string;
  rule: string;
  description: string;
  location: [number, number] | null;
  layer: string | null;
};

export async function runDrc(projectDir: string): Promise<DrcViolation[]> {
  return runPython(`
import json
from kicad_mcp.config import resolve_project_dir, resolve_pcb_file
from kicad_mcp.tools.drc import run_drc
from kicad_mcp.schema import to_dict
p = resolve_project_dir(${JSON.stringify(projectDir)})
print(json.dumps(to_dict(run_drc(resolve_pcb_file(p)))))
`) as Promise<DrcViolation[]>;
}

export async function runErc(projectDir: string): Promise<DrcViolation[]> {
  return runPython(`
import json
from kicad_mcp.config import resolve_project_dir, resolve_root_schematic
from kicad_mcp.tools.drc import run_erc
from kicad_mcp.schema import to_dict
p = resolve_project_dir(${JSON.stringify(projectDir)})
print(json.dumps(to_dict(run_erc(resolve_root_schematic(p)))))
`) as Promise<DrcViolation[]>;
}

export async function getSchematicHierarchy(
  projectDir: string,
): Promise<unknown> {
  return runPython(`
import json
from kicad_mcp.config import resolve_project_dir, resolve_root_schematic
from kicad_mcp import file_parser
from kicad_mcp.schema import to_dict
p = resolve_project_dir(${JSON.stringify(projectDir)})
print(json.dumps(to_dict(file_parser.get_hierarchy(resolve_root_schematic(p)))))
`);
}

export async function renderBoard(
  projectDir: string,
  side = "top",
  layer: string | null = null,
  width = 1200,
): Promise<{ data: Buffer; format: string }> {
  const layerArg = layer ? JSON.stringify(layer) : "None";
  const result = (await runPython(`
import json, base64
from kicad_mcp.config import resolve_project_dir, resolve_pcb_file
from kicad_mcp.tools.export import render_board
p = resolve_project_dir(${JSON.stringify(projectDir)})
data, fmt = render_board(resolve_pcb_file(p), ${JSON.stringify(side)}, ${layerArg}, ${width})
print(json.dumps({"data": base64.b64encode(data).decode(), "format": fmt}))
`)) as { data: string; format: string };
  return { data: Buffer.from(result.data, "base64"), format: result.format };
}
