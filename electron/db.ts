/**
 * Database lifecycle for the desktop shell: downgrade guard, backup, migrate.
 *
 * Runs in the Electron main process BEFORE the server child is spawned, so
 * the DB is never open while we copy it. The Prisma CLI is invoked through
 * Electron's own Node (ELECTRON_RUN_AS_NODE) rather than a shell `npx` —
 * GUI-launched apps don't inherit the user's shell PATH.
 */
import { spawnSync } from "child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "fs";
import path from "path";

const BACKUPS_TO_KEEP = 5;

export class MigrationError extends Error {
  constructor(
    message: string,
    public readonly backupDir: string | null
  ) {
    super(message);
    this.name = "MigrationError";
  }
}

export class DowngradeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DowngradeError";
  }
}

function runPrisma(
  repoRoot: string,
  databaseUrl: string,
  args: string[]
): { status: number | null; output: string } {
  const prismaCli = path.join(repoRoot, "node_modules", "prisma", "build", "index.js");
  const res = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      DATABASE_URL: databaseUrl,
      // Prisma CLI update checks are noise inside an app boot.
      PRISMA_HIDE_UPDATE_MESSAGE: "1",
      CI: "1",
    },
    encoding: "utf8",
    timeout: 120_000,
  });
  const output = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  return { status: res.status, output };
}

/**
 * Refuse to touch a database that a NEWER app version migrated forward.
 * `migrate status` reports migrations recorded in the DB but absent from
 * this build's prisma/migrations as "missing from" the local directory.
 */
export function assertNoDowngrade(repoRoot: string, databaseUrl: string): void {
  const dbPath = databaseUrl.replace(/^file:/, "");
  if (!existsSync(dbPath)) return; // fresh install, nothing to guard

  const { output } = runPrisma(repoRoot, databaseUrl, ["migrate", "status"]);
  if (/missing from/i.test(output) || /not found locally/i.test(output)) {
    throw new DowngradeError(
      "This database was created by a newer version of Resistance and can't " +
        "be opened by this one. Update Resistance, or restore the " +
        "pre-migration backup from the backups folder."
    );
  }
}

/**
 * Copy resistance.db (+ -wal/-shm if present) to a timestamped backup dir,
 * pruning old backups. Returns the backup dir, or null when there is no DB
 * yet (fresh install). Must run before the server opens the database.
 */
export function backupDatabase(dataDir: string, dbPath: string): string | null {
  if (!existsSync(dbPath)) return null;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupsRoot = path.join(dataDir, "backups");
  const backupDir = path.join(backupsRoot, stamp);
  mkdirSync(backupDir, { recursive: true });

  for (const suffix of ["", "-wal", "-shm"]) {
    const src = dbPath + suffix;
    if (existsSync(src)) {
      copyFileSync(src, path.join(backupDir, path.basename(src)));
    }
  }

  const entries = readdirSync(backupsRoot).sort();
  for (const stale of entries.slice(0, Math.max(0, entries.length - BACKUPS_TO_KEEP))) {
    rmSync(path.join(backupsRoot, stale), { recursive: true, force: true });
  }
  return backupDir;
}

/** Apply pending migrations. Throws MigrationError with the backup location. */
export function migrateDatabase(
  repoRoot: string,
  databaseUrl: string,
  backupDir: string | null
): void {
  const { status, output } = runPrisma(repoRoot, databaseUrl, [
    "migrate",
    "deploy",
  ]);
  if (status !== 0) {
    throw new MigrationError(
      `Database migration failed.\n\n${output.trim()}\n\n` +
        (backupDir
          ? `Your data was backed up to:\n${backupDir}`
          : "No pre-existing database was found, so nothing was lost."),
      backupDir
    );
  }
}
