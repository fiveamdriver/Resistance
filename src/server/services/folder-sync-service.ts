/**
 * Linked-folder scan and import (desktop Phase 4, docs/DESKTOP_APP_PLAN.md).
 *
 * scanLinkedFolder: inclusive, categorized listing of a project's linked EDA
 * folder — fresh CLI exports (default-checked in the UI, `kicad_sync`
 * provenance), recognized documents (`project_folder` provenance), everything
 * else behind "show all". The engineer is the filter.
 *
 * importFromFolder / syncNow: pull the selection through the existing upload
 * pipeline (validate → store → parse → index), so folder imports behave
 * exactly like uploads, then stamp syncMeta for staleness display.
 */
import "server-only";

import { File as NodeFile } from "buffer";
import { readdir, readFile, stat, unlink } from "fs/promises";
import path from "path";

import { AppError, ValidationError } from "@/lib/errors";
import { categorizeFile, isAcceptedFile, type FileCategory } from "@/lib/fileTypes";
import { parsePcbLayoutFile, type PcbLayoutSummary } from "@/lib/parsers/kicadPcbParser";
import { type NetlistParseSummary } from "@/lib/parsers/netlistParser";
import { prisma } from "@/lib/prisma";
import { resolveStoredPath } from "@/lib/storage";
import { detectEdaProject } from "@/server/eda/kicad";

import { uploadFiles, type UploadOutcome } from "./file-service";

/** Directories that are never interesting: VCS, KiCad autosaves, build junk. */
const SKIP_DIRS = new Set([".git", ".svn", "node_modules", "__pycache__"]);
const SKIP_DIR_SUFFIX = "-backups";
/** Design files are represented by the EDA project itself, not the doc scan. */
const DESIGN_EXTENSIONS = [".kicad_pro", ".kicad_sch", ".kicad_pcb", ".kicad_prl"];
const MAX_SCAN_DEPTH = 4;
const MAX_OTHER_FILES = 200;

export interface ScannedFile {
  /** Path relative to the linked folder (what import requests carry). */
  relPath: string;
  sizeBytes: number;
  mtime: string;
  category: FileCategory;
  /** A project file with this name already exists (any provenance). */
  alreadyImported: boolean;
}

export interface FolderScan {
  folder: string;
  eda: {
    adapterId: string;
    displayName: string;
    name: string;
    schematic: string;
    board: string | null;
    generatorVersion: string | null;
    exports: { filename: string; kind: "netlist" | "bom" }[];
  } | null;
  documents: ScannedFile[];
  other: { relPath: string; sizeBytes: number }[];
  otherTruncated: boolean;
}

async function getLinkedProject(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError("NOT_FOUND", "Project not found");
  if (!project.kicadProjectPath) {
    throw new ValidationError("No KiCad folder is linked to this project");
  }
  try {
    if (!(await stat(project.kicadProjectPath)).isDirectory()) throw new Error();
  } catch {
    throw new ValidationError(
      `Linked folder no longer exists: ${project.kicadProjectPath}`
    );
  }
  return { ...project, kicadProjectPath: project.kicadProjectPath };
}

async function walk(
  root: string,
  dir: string,
  depth: number,
  out: { relPath: string; sizeBytes: number; mtimeMs: number }[]
): Promise<void> {
  if (depth > MAX_SCAN_DEPTH) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.endsWith(SKIP_DIR_SUFFIX)) continue;
      await walk(root, abs, depth + 1, out);
    } else if (entry.isFile()) {
      const s = await stat(abs);
      out.push({
        relPath: path.relative(root, abs),
        sizeBytes: s.size,
        mtimeMs: s.mtimeMs,
      });
    }
  }
}

export async function scanLinkedFolder(projectId: string): Promise<FolderScan> {
  const project = await getLinkedProject(projectId);
  const root = project.kicadProjectPath;

  const detected = await detectEdaProject(root);
  const files: { relPath: string; sizeBytes: number; mtimeMs: number }[] = [];
  await walk(root, root, 0, files);

  const existingNames = new Set(
    (
      await prisma.projectFile.findMany({
        where: { projectId },
        select: { originalName: true },
      })
    ).map((f) => f.originalName)
  );

  const documents: ScannedFile[] = [];
  const other: { relPath: string; sizeBytes: number }[] = [];
  for (const f of files) {
    const base = path.basename(f.relPath);
    if (DESIGN_EXTENSIONS.some((ext) => base.toLowerCase().endsWith(ext))) continue;
    if (isAcceptedFile(base)) {
      documents.push({
        relPath: f.relPath,
        sizeBytes: f.sizeBytes,
        mtime: new Date(f.mtimeMs).toISOString(),
        category: categorizeFile(base),
        alreadyImported: existingNames.has(base),
      });
    } else if (other.length < MAX_OTHER_FILES) {
      other.push({ relPath: f.relPath, sizeBytes: f.sizeBytes });
    }
  }
  documents.sort((a, b) => a.relPath.localeCompare(b.relPath));
  other.sort((a, b) => a.relPath.localeCompare(b.relPath));

  return {
    folder: root,
    eda: detected
      ? {
          adapterId: detected.adapter.id,
          displayName: detected.adapter.displayName,
          name: detected.info.name,
          schematic: path.relative(root, detected.info.schematic),
          board: detected.info.board
            ? path.relative(root, detected.info.board)
            : null,
          generatorVersion: detected.info.generatorVersion,
          exports: detected.adapter.plannedExports(detected.info),
        }
      : null,
    documents,
    other,
    otherTruncated: other.length >= MAX_OTHER_FILES,
  };
}

/** Resolve a scan-relative path inside root, refusing traversal outside it. */
function resolveInside(root: string, relPath: string): string {
  const abs = path.resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new ValidationError(`Path escapes the linked folder: ${relPath}`);
  }
  return abs;
}

export interface FolderImportResult {
  exports: UploadOutcome[];
  documents: UploadOutcome[];
  /** Board layout parsed from the linked .kicad_pcb, when one was found. */
  layout: PcbLayoutSummary | null;
  syncMeta: {
    syncedAt: string;
    boardMtime: string;
    kicadVersion: string;
    kicadProjectDir: string;
    /** Outcome of the stale-component reconciliation pass (audit #1). */
    reconcile?: ReconcileSummary;
  } | null;
}

export interface ReconcileSummary {
  componentsDeleted: number;
  placementsCleared: number;
  /** Set when reconciliation refused to delete (partial-looking parse). */
  skippedReason?: string;
}

/** SQLite parameter limit is 999; stay well under it for `in` lists. */
const RECONCILE_CHUNK = 200;

function chunkIds(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += RECONCILE_CHUNK) {
    out.push(ids.slice(i, i + RECONCILE_CHUNK));
  }
  return out;
}

/** Below this many existing components the shrink guard stays out of the way. */
const SHRINK_GUARD_MIN_ROWS = 20;
/** Refuse deletes when fewer than this fraction of components survive. */
const SHRINK_GUARD_MIN_RATIO = 0.5;

/**
 * Sync is authoritative: delete components that are in neither the fresh
 * netlist nor the fresh layout (the union keeps layout-only parts like
 * fiducials and mounting holes alive), and clear placements for components
 * that left the board but remain in the schematic. Guarded: a fresh parse
 * that would delete more than half of a non-trivial project looks like a
 * parser hiccup, not a redesign — upserts stand, deletes are skipped.
 *
 * Exported for the DB-backed test suite; only importFromFolder calls it.
 */
export async function reconcileComponents(
  projectId: string,
  keepRefDes: Set<string>,
  layout: PcbLayoutSummary | null
): Promise<ReconcileSummary> {
  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.component.findMany({
        where: { projectId },
        select: { id: true, refDes: true, posX: true },
      });
      const stale = existing.filter((c) => !keepRefDes.has(c.refDes));

      const surviving = existing.length - stale.length;
      if (
        existing.length >= SHRINK_GUARD_MIN_ROWS &&
        surviving < existing.length * SHRINK_GUARD_MIN_RATIO
      ) {
        return {
          componentsDeleted: 0,
          placementsCleared: 0,
          skippedReason: `fresh sync covers only ${surviving} of ${existing.length} components — kept existing rows`,
        };
      }

      // Cascades clean up pins, connections, and BOM links.
      for (const ids of chunkIds(stale.map((c) => c.id))) {
        await tx.component.deleteMany({ where: { id: { in: ids } } });
      }

      // A component still in the schematic but no longer placed on the board
      // must not keep its old coordinates as ground truth.
      let placementsCleared = 0;
      if (layout) {
        const placed = new Set(layout.placedRefDes);
        const toClear = existing.filter(
          (c) => keepRefDes.has(c.refDes) && c.posX != null && !placed.has(c.refDes)
        );
        for (const ids of chunkIds(toClear.map((c) => c.id))) {
          await tx.component.updateMany({
            where: { id: { in: ids } },
            data: { posX: null, posY: null, rotation: null, layer: null },
          });
        }
        placementsCleared = toClear.length;
      }

      return { componentsDeleted: stale.length, placementsCleared };
    },
    { timeout: 60_000, maxWait: 10_000 }
  );
}

/**
 * Fresh exports supersede the previous sync's: same-name `kicad_sync` files
 * are removed (DB row + stored bytes) before the new ones land, so repeated
 * syncs don't pile up stale rows in the Files tab.
 */
async function removeSupersededExports(
  projectId: string,
  filenames: string[]
): Promise<void> {
  const stale = await prisma.projectFile.findMany({
    where: {
      projectId,
      provenance: "kicad_sync",
      originalName: { in: filenames },
    },
  });
  for (const file of stale) {
    await prisma.projectFile.delete({ where: { id: file.id } });
    try {
      await unlink(resolveStoredPath(file.path));
    } catch {
      // Missing bytes on disk are not worth failing a sync over.
    }
  }
}

export async function importFromFolder(
  projectId: string,
  options: { runExports: boolean; files: string[] }
): Promise<FolderImportResult> {
  const project = await getLinkedProject(projectId);
  const root = project.kicadProjectPath;

  const result: FolderImportResult = {
    exports: [],
    documents: [],
    layout: null,
    syncMeta: null,
  };

  // ── Fresh EDA exports (kicad_sync provenance) ─────────────────────────────
  if (options.runExports) {
    const detected = await detectEdaProject(root);
    if (!detected) {
      throw new ValidationError(
        "No EDA project recognized in the linked folder — nothing to export"
      );
    }
    const artifacts = await detected.adapter.exportArtifacts(detected.info);
    await removeSupersededExports(
      projectId,
      artifacts.map((a) => a.filename)
    );
    const exportFiles = artifacts.map(
      (a) => new NodeFile([a.content], a.filename) as unknown as File
    );
    result.exports = await uploadFiles(projectId, exportFiles, {
      provenance: "kicad_sync",
    });

    // Staleness stamp: same shape the MCP server's sync_to_resistance writes.
    let boardMtimeMs = 0;
    for (const designFile of detected.info.designFiles) {
      try {
        boardMtimeMs = Math.max(boardMtimeMs, (await stat(designFile)).mtimeMs);
      } catch {
        // A design file listed a moment ago may have been renamed; skip it.
      }
    }
    result.syncMeta = {
      syncedAt: new Date().toISOString(),
      boardMtime: new Date(boardMtimeMs || Date.now()).toISOString(),
      kicadVersion: detected.info.generatorVersion ?? "unknown",
      kicadProjectDir: root,
    };

    // Structured board layout (placements, dimensions, stackup, zones) from the
    // .kicad_pcb — powers the layout query tools. Best-effort: a layout-parse
    // failure must never fail a sync, same as the exports above.
    if (detected.info.board) {
      try {
        result.layout = await parsePcbLayoutFile(
          projectId,
          detected.info.board,
          path.basename(detected.info.board)
        );
      } catch {
        result.layout = null;
      }
    }

    // ── Reconcile: this sync is the authoritative design state (audit #1) ──
    // Delete components in neither the fresh netlist nor the fresh layout.
    // Requires a successfully parsed netlist; if the folder has a board file
    // whose layout parse failed, skip deletes — without placements we cannot
    // tell fiducials/mounting holes from stale parts.
    const netlistIdx = artifacts.findIndex((a) => a.kind === "netlist");
    const netlistOutcome = netlistIdx >= 0 ? result.exports[netlistIdx] : undefined;
    const netlistSummary =
      netlistOutcome?.ok && netlistOutcome.parseStatus === "parsed"
        ? (netlistOutcome.summary as NetlistParseSummary)
        : null;
    if (netlistSummary) {
      if (detected.info.board && !result.layout) {
        result.syncMeta.reconcile = {
          componentsDeleted: 0,
          placementsCleared: 0,
          skippedReason: "board layout failed to parse — kept existing components",
        };
      } else {
        const keep = new Set([
          ...netlistSummary.allRefDes,
          ...(result.layout?.placedRefDes ?? []),
        ]);
        result.syncMeta.reconcile = await reconcileComponents(
          projectId,
          keep,
          result.layout
        );
      }
    }

    await prisma.project.update({
      where: { id: projectId },
      data: { syncMeta: JSON.stringify(result.syncMeta) },
    });
  }

  // ── Selected loose documents (project_folder provenance) ─────────────────
  if (options.files.length > 0) {
    const docFiles: File[] = [];
    for (const relPath of options.files) {
      const abs = resolveInside(root, relPath);
      const content = await readFile(abs);
      docFiles.push(
        new NodeFile([content], path.basename(abs)) as unknown as File
      );
    }
    result.documents = await uploadFiles(projectId, docFiles, {
      provenance: "project_folder",
    });
  }

  return result;
}

/** The sync button / file watcher path: re-export netlist + BOM only. */
export async function syncNow(projectId: string): Promise<FolderImportResult> {
  return importFromFolder(projectId, { runExports: true, files: [] });
}
