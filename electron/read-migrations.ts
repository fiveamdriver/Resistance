/**
 * Prints (as JSON) the completed migration names recorded in a database's
 * _prisma_migrations ledger. Spawned by db.ts under ELECTRON_RUN_AS_NODE with
 * DATABASE_URL set — a separate process so the main process never loads
 * Prisma's native engine into Electron.
 *
 * argv[2] = repo root (where node_modules/@prisma/client lives).
 */
import path from "path";

const repoRoot = process.argv[2];

async function main(): Promise<void> {
  // Resolved at runtime from the app's own node_modules, not electron/dist.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaClient } = require(
    path.join(repoRoot, "node_modules", "@prisma/client")
  ) as typeof import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL"
    );
    console.log(JSON.stringify(rows.map((r) => r.migration_name)));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  // A DB from the pre-migrations era (db:push only) has no ledger table —
  // that's "no history", not an error.
  if (err instanceof Error && /_prisma_migrations/.test(err.message)) {
    console.log("[]");
    return;
  }
  console.error(err);
  process.exit(1);
});
