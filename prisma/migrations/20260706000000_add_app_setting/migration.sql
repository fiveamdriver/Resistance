-- App-wide key-value settings (desktop Phase 2 settings surface).
-- Note: `prisma migrate diff` also proposes dropping the document_chunks_fts*
-- tables here — those are FTS5 derived state owned by src/lib/fts.ts (rebuilt
-- at startup), deliberately outside the Prisma schema. Never drop them in a
-- migration.

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
