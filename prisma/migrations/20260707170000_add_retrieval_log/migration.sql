-- Search-miss feedback log (docs/EMBEDDINGS_FOR_RAG.md, W1).
-- NOTE: no FTS statements here on purpose — document_chunks_fts is derived
-- state owned by ensureFtsSchema (src/lib/fts.ts), which detects the old
-- unstemmed shape at startup and rebuilds it with porter stemming.

-- CreateTable
CREATE TABLE "RetrievalLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "hits" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "RetrievalLog_projectId_createdAt_idx" ON "RetrievalLog"("projectId", "createdAt");
