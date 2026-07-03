import type { PrismaClient } from "@prisma/client";

/**
 * FTS5 full-text index over DocumentChunk.
 *
 * The index is an *external-content* FTS5 table: it stores only the search
 * index and reads row content from DocumentChunk via rowid, so chunk text is
 * never stored twice. Triggers keep the index in sync with every
 * insert/update/delete on DocumentChunk — application code never writes to
 * the FTS table directly, which removes the dual-write drift bug by
 * construction.
 *
 * Everything here is idempotent and runs at startup. If the table exists in
 * the old shape (self-contained, with its own content copy), it is dropped
 * and rebuilt from DocumentChunk — the FTS table is always derived state and
 * safe to regenerate (this also makes `prisma db push` dropping it harmless).
 */

const TRIGGERS = [
  `CREATE TRIGGER IF NOT EXISTS document_chunks_fts_ai
   AFTER INSERT ON DocumentChunk BEGIN
     INSERT INTO document_chunks_fts(rowid, content)
     VALUES (new.rowid, new.content);
   END`,
  `CREATE TRIGGER IF NOT EXISTS document_chunks_fts_ad
   AFTER DELETE ON DocumentChunk BEGIN
     INSERT INTO document_chunks_fts(document_chunks_fts, rowid, content)
     VALUES ('delete', old.rowid, old.content);
   END`,
  `CREATE TRIGGER IF NOT EXISTS document_chunks_fts_au
   AFTER UPDATE OF content ON DocumentChunk BEGIN
     INSERT INTO document_chunks_fts(document_chunks_fts, rowid, content)
     VALUES ('delete', old.rowid, old.content);
     INSERT INTO document_chunks_fts(rowid, content)
     VALUES (new.rowid, new.content);
   END`,
];

export async function ensureFtsSchema(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.$queryRaw<Array<{ sql: string | null }>>`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'document_chunks_fts'
  `;
  const isExternalContent =
    existing.length > 0 && (existing[0].sql ?? "").includes("content='DocumentChunk'");

  if (existing.length > 0 && !isExternalContent) {
    // Old self-contained shape (or unknown) — drop; we rebuild from chunks below.
    await prisma.$executeRawUnsafe(`DROP TABLE document_chunks_fts`);
  }

  const created = existing.length === 0 || !isExternalContent;
  if (created) {
    await prisma.$executeRawUnsafe(
      `CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
         content,
         content='DocumentChunk',
         content_rowid='rowid'
       )`
    );
  }

  for (const trigger of TRIGGERS) {
    await prisma.$executeRawUnsafe(trigger);
  }

  // Reconcile. Note: on an external-content table, plain SELECTs (including
  // count(*)) read from the *content* table, so row counts can't detect a
  // stale index. A fresh table always needs a rebuild; an existing one is
  // verified with FTS5's integrity-check, which compares the index against
  // the content table and errors on mismatch (both are O(index) scans —
  // acceptable at startup for this data size).
  if (created) {
    await rebuildFtsIndex(prisma);
    return;
  }
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO document_chunks_fts(document_chunks_fts, rank) VALUES ('integrity-check', 1)`
    );
  } catch {
    await rebuildFtsIndex(prisma);
  }
}

async function rebuildFtsIndex(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO document_chunks_fts(document_chunks_fts) VALUES ('rebuild')`
  );
}

/**
 * Escape a user query for FTS5 MATCH. Each whitespace-separated term becomes
 * a quoted phrase (internal double quotes doubled), so operator characters in
 * part numbers — "LM317-N", "MAX232(A)" — match literally instead of throwing
 * fts5 syntax errors. Terms are implicitly ANDed.
 */
export function escapeFtsQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll(`"`, `""`)}"`)
    .join(" ");
}
