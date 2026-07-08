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
 * an old shape (self-contained with its own content copy, or external-content
 * without porter stemming), it is dropped and rebuilt from DocumentChunk —
 * the FTS table is always derived state and safe to regenerate (this also
 * makes `prisma db push` dropping it harmless).
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
  // Current shape = external-content AND porter-stemmed. A table missing either
  // (the old self-contained shape, or the unstemmed external-content shape) is
  // dropped and rebuilt — checking only content= would silently keep an
  // unstemmed index and "current limiting" would never match "current limit".
  const existingSql = existing.length > 0 ? (existing[0].sql ?? "") : "";
  const isCurrentShape =
    existingSql.includes("content='DocumentChunk'") &&
    existingSql.includes("porter");

  if (existing.length > 0 && !isCurrentShape) {
    await prisma.$executeRawUnsafe(`DROP TABLE document_chunks_fts`);
  }

  const created = existing.length === 0 || !isCurrentShape;
  if (created) {
    // porter stemming folds English inflections ("limiting" ↔ "limit",
    // "regulation" ↔ "regulates") so qualifier morphology can't cause false
    // "not on file" answers. Part-number tokens (LM317, MAX232) are unaffected:
    // unicode61 tokenizes before porter runs, and the stemmer leaves
    // letter+digit tokens alone.
    await prisma.$executeRawUnsafe(
      `CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
         content,
         content='DocumentChunk',
         content_rowid='rowid',
         tokenize='porter unicode61'
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
 * Split a user query into individually-quoted FTS5 terms (internal double
 * quotes doubled), so operator characters in part numbers — "LM317-N",
 * "MAX232(A)" — match literally instead of throwing fts5 syntax errors.
 * Callers join with " " (implicit AND) or " OR " (relaxed match).
 */
export function escapeFtsTerms(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll(`"`, `""`)}"`);
}

/**
 * Escape a user query for FTS5 MATCH with implicit-AND semantics: every term
 * must appear in the chunk.
 */
export function escapeFtsQuery(query: string): string {
  return escapeFtsTerms(query).join(" ");
}

/** Quote a (possibly multi-word) phrase as a single FTS5 phrase query. */
export function escapeFtsPhrase(phrase: string): string {
  return `"${phrase.trim().replaceAll(`"`, `""`)}"`;
}
