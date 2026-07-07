/**
 * Provision a throwaway SQLite database for a DB-backed test file.
 *
 * Runs (via vitest.db.config.ts setupFiles) before any test module is
 * imported, so DATABASE_URL is already pointing at the temp database when
 * src/lib/prisma.ts constructs its client. Each test file runs in its own
 * worker and therefore gets its own database — files can run in parallel
 * without sharing state.
 */
import { execSync } from "child_process";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const dir = mkdtempSync(path.join(tmpdir(), "resistance-db-test-"));
const dbPath = path.join(dir, "test.db");

process.env.DATABASE_URL = `file:${dbPath}`;
// Keep test-created upload artifacts out of the repo's uploads/ dir.
process.env.UPLOADS_DIR = path.join(dir, "uploads");

execSync("npx prisma db push --skip-generate", {
  cwd: path.resolve(__dirname, "../.."),
  env: { ...process.env },
  stdio: "pipe",
});
