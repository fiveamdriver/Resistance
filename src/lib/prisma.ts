import { PrismaClient } from "@prisma/client";

// Reuse a single PrismaClient across hot-reloads in development to avoid
// exhausting database connections.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const isNew = !globalForPrisma.prisma;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Create the FTS5 virtual table on first initialization. IF NOT EXISTS makes
// this a no-op if the migration has already been applied.
if (isNew) {
  prisma
    .$executeRaw`CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(content, chunk_id UNINDEXED, project_id UNINDEXED)`
    .catch((err) => console.error("[prisma] FTS5 init failed:", err));
}
