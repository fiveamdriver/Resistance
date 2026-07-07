/**
 * Auto-sync file watchers (desktop Phase 4, docs/DESKTOP_APP_PLAN.md).
 *
 * One fs.watch per project with autoSyncEnabled: a change to any KiCad design
 * file in the linked folder re-runs the folder sync (fresh netlist/BOM
 * exports) after a debounce, so Resistance tracks the board as the engineer
 * saves in KiCad. Watchers live in module state, reconciled from the DB on
 * first server use (src/lib/prisma.ts init) and after every project update.
 */
import "server-only";

import { watch, type FSWatcher } from "fs";
import path from "path";

import { prisma } from "@/lib/prisma";

import { syncNow } from "./folder-sync-service";

const DESIGN_EXTENSIONS = [".kicad_sch", ".kicad_pcb"];
const DEBOUNCE_MS = 2_000;

interface WatchEntry {
  dir: string;
  watcher: FSWatcher;
  timer: NodeJS.Timeout | null;
  syncing: boolean;
  /** A change arrived while a sync was running — run once more when it ends. */
  rerun: boolean;
}

// Survives Next dev hot-reloads (same pattern as the shared PrismaClient).
const globalForWatchers = globalThis as unknown as {
  resistanceWatchers: Map<string, WatchEntry> | undefined;
};
const registry = (globalForWatchers.resistanceWatchers ??= new Map());

async function runSync(projectId: string): Promise<void> {
  const entry = registry.get(projectId);
  if (!entry) return;
  if (entry.syncing) {
    entry.rerun = true;
    return;
  }
  entry.syncing = true;
  try {
    const result = await syncNow(projectId);
    console.log(
      `[auto-sync] ${projectId}: re-exported ${result.exports.length} files`
    );
  } catch (err) {
    console.error(`[auto-sync] ${projectId} failed:`, err);
  } finally {
    entry.syncing = false;
    if (entry.rerun) {
      entry.rerun = false;
      scheduleSync(projectId);
    }
  }
}

function scheduleSync(projectId: string): void {
  const entry = registry.get(projectId);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void runSync(projectId);
  }, DEBOUNCE_MS);
}

function stopWatcher(projectId: string): void {
  const entry = registry.get(projectId);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.watcher.close();
  registry.delete(projectId);
}

function startWatcher(projectId: string, dir: string): void {
  const existing = registry.get(projectId);
  if (existing?.dir === dir) return;
  if (existing) stopWatcher(projectId);

  let watcher: FSWatcher;
  try {
    // Non-recursive: KiCad design files live at the project root (subsheets
    // included). Doc subfolders are import-on-demand, not auto-synced.
    watcher = watch(dir, (_event, filename) => {
      if (!filename) return;
      const ext = path.extname(filename).toLowerCase();
      if (DESIGN_EXTENSIONS.includes(ext)) scheduleSync(projectId);
    });
  } catch (err) {
    console.error(`[auto-sync] cannot watch ${dir}:`, err);
    return;
  }
  watcher.on("error", (err) => {
    console.error(`[auto-sync] watcher error on ${dir}:`, err);
    stopWatcher(projectId);
  });
  registry.set(projectId, { dir, watcher, timer: null, syncing: false, rerun: false });
  console.log(`[auto-sync] watching ${dir} for project ${projectId}`);
}

/**
 * Bring running watchers in line with the DB: start for every project with
 * auto-sync on and a linked folder, stop the rest. Safe to call repeatedly.
 */
export async function reconcileWatchers(): Promise<void> {
  const projects = await prisma.project.findMany({
    where: { autoSyncEnabled: true, kicadProjectPath: { not: null } },
    select: { id: true, kicadProjectPath: true },
  });
  const wanted = new Map(projects.map((p) => [p.id, p.kicadProjectPath as string]));

  for (const projectId of [...registry.keys()]) {
    if (!wanted.has(projectId)) stopWatcher(projectId);
  }
  for (const [projectId, dir] of wanted) {
    startWatcher(projectId, dir);
  }
}
