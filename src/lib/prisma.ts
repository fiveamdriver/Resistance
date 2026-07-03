import { PrismaClient } from "@prisma/client";

import { ensureFtsSchema } from "./fts";

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

// Ensure the FTS5 index (external-content table + sync triggers) exists and
// matches DocumentChunk on first initialization. Idempotent; rebuilds the
// index from chunks when shapes or counts diverge.
if (isNew) {
  ensureFtsSchema(prisma).catch((err) =>
    console.error("[prisma] FTS5 init failed:", err)
  );
}
