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

  // Restore auto-sync folder watchers (they live in process memory). Done
  // here rather than instrumentation.ts: this module only ever loads in the
  // Node runtime, while instrumentation is also compiled for the edge
  // runtime, where the watcher chain's child_process import can't resolve.
  // Deferred a tick so the import cycle (watcher → prisma) resolves cleanly.
  setTimeout(() => {
    import("@/server/services/watcher-service")
      .then((m) => m.reconcileWatchers())
      .catch((err) =>
        console.error("[auto-sync] watcher restore failed:", err)
      );
  }, 0);
}
