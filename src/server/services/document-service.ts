import "server-only";

import { readFile } from "fs/promises";
import path from "path";

import { Prisma } from "@prisma/client";

import { extractDocxText } from "@/lib/parsers/docxParser";
import { chunkDocument, DocumentChunkData } from "@/lib/parsers/documentChunker";
import { extractPdfPages } from "@/lib/parsers/pdfParser";
import { escapeFtsPhrase, escapeFtsTerms } from "@/lib/fts";
import { prisma } from "@/lib/prisma";
import { expandQuerySynonyms } from "@/lib/retrieval-synonyms";

/** A chunk paired with its 1-based source page (null when pageless). */
interface PagedChunk extends DocumentChunkData {
  page: number | null;
}

/**
 * Extract text from a document file and produce page-tagged chunks. PDFs are
 * chunked per page so every chunk knows its page number (chunks never span
 * pages); other formats have no page structure.
 */
export async function extractChunks(
  absolutePath: string,
  category: "pdf" | "document",
): Promise<PagedChunk[]> {
  const buffer = await readFile(absolutePath);

  if (category === "pdf") {
    const pages = await extractPdfPages(buffer);
    const chunks: PagedChunk[] = [];
    let index = 0;
    for (const { page, text } of pages) {
      for (const chunk of chunkDocument(text)) {
        chunks.push({ chunkIndex: index++, content: chunk.content, page });
      }
    }
    return chunks;
  }

  const ext = path.extname(absolutePath).toLowerCase();
  const text =
    ext === ".docx" ? await extractDocxText(buffer) : buffer.toString("utf-8");
  return chunkDocument(text).map((c) => ({ ...c, page: null }));
}

/**
 * Chunk a document and store the chunks. The FTS5 index is maintained by
 * triggers on DocumentChunk (see lib/fts.ts) — no separate index write, so
 * chunks and index cannot drift.
 *
 * Only call this for documents that passed verification (or human uploads,
 * which are verified by definition): once chunks exist, they are searchable.
 */
export async function indexDocumentFile(
  projectId: string,
  fileId: string,
  absolutePath: string,
  category: "pdf" | "document",
): Promise<{ chunkCount: number }> {
  const chunks = await extractChunks(absolutePath, category);

  await prisma.documentChunk.createMany({
    data: chunks.map((chunk) => ({
      projectId,
      fileId,
      chunkIndex: chunk.chunkIndex,
      page: chunk.page,
      content: chunk.content,
    })),
  });

  return { chunkCount: chunks.length };
}

export interface DocumentSearchResult {
  content: string;
  fileName: string | null;
  chunkIndex: number;
  page: number | null;
  provenance: string | null;
  score: number;
}

/** How a search's results were matched — reported to the model for honesty. */
export type SearchStrategy = "strict" | "relaxed" | "synonyms";

export interface DocumentSearchOutcome {
  results: DocumentSearchResult[];
  /**
   * "strict"   — every query term matched (implicit AND).
   * "relaxed"  — strict found nothing; any-term OR match, BM25-ranked.
   * "synonyms" — relaxed found nothing; domain synonyms were OR'd in.
   * On zero results this is the last strategy attempted, i.e. "nothing
   * matched even after relaxation".
   */
  strategy: SearchStrategy;
}

type Row = {
  rank: number;
  content: string;
  chunkIndex: number;
  page: number | null;
  originalName: string | null;
  provenance: string | null;
};

async function runFtsMatch(
  projectId: string,
  match: string,
  limit: number,
): Promise<Row[]> {
  return prisma.$queryRaw<Row[]>(
    Prisma.sql`
      SELECT document_chunks_fts.rank AS rank, dc.content, dc.chunkIndex, dc.page,
             pf.originalName, pf.provenance
      FROM document_chunks_fts
      JOIN DocumentChunk dc ON dc.rowid = document_chunks_fts.rowid
      LEFT JOIN ProjectFile pf ON pf.id = dc.fileId
      WHERE document_chunks_fts MATCH ${match}
        AND dc.projectId = ${projectId}
        AND (pf.id IS NULL OR pf.verifyStatus = 'verified')
      ORDER BY document_chunks_fts.rank
      LIMIT ${limit}
    `,
  );
}

/**
 * Best-effort search log (EMBEDDINGS_FOR_RAG.md W1 feedback loop). Zero-hit
 * rows are real vocabulary gaps — the seed data for the synonym table and the
 * eval set. Never allowed to fail the search itself.
 */
function logSearch(
  projectId: string,
  query: string,
  strategy: SearchStrategy,
  hits: number,
): void {
  void prisma.retrievalLog
    .create({ data: { projectId, query, strategy, hits } })
    .catch(() => {});
}

/**
 * Full-text search over a project's verified document chunks.
 *
 * Match strategy (EMBEDDINGS_FOR_RAG.md W6): strict AND first — full
 * precision when the wording lines up. On zero hits, relax to OR with BM25
 * ranking, so a qualifier word absent from the chunk ("maximum current
 * limit" vs "current limit is 500mA") can't produce a false "not on file".
 * Still nothing: OR in domain synonyms (W1). Qualifier words are never
 * dropped from the query — max vs typical are different numbers, and
 * OR-ranking gets the recall without discarding that signal.
 *
 * Throws on failure — callers must distinguish "search broke" from "no
 * matches" so the assistant never mistakes an error for an empty library.
 */
export async function searchDocuments(
  projectId: string,
  query: string,
  limit = 5,
): Promise<DocumentSearchOutcome> {
  const terms = escapeFtsTerms(query);
  if (terms.length === 0) return { results: [], strategy: "strict" };

  let strategy: SearchStrategy = "strict";
  let rows = await runFtsMatch(projectId, terms.join(" "), limit);

  if (rows.length === 0 && terms.length > 1) {
    strategy = "relaxed";
    rows = await runFtsMatch(projectId, terms.join(" OR "), limit);
  }

  if (rows.length === 0) {
    const synonyms = expandQuerySynonyms(query).map(escapeFtsPhrase);
    if (synonyms.length > 0) {
      strategy = "synonyms";
      rows = await runFtsMatch(
        projectId,
        [...terms, ...synonyms].join(" OR "),
        limit,
      );
    }
  }

  logSearch(projectId, query, strategy, rows.length);

  return {
    results: rows.map((r) => ({
      content: r.content,
      fileName: r.originalName ?? null,
      chunkIndex: r.chunkIndex,
      page: r.page,
      provenance: r.provenance,
      score: r.rank,
    })),
    strategy,
  };
}

export async function deleteDocumentChunks(fileId: string): Promise<void> {
  // FTS index rows are removed by the DocumentChunk delete trigger.
  await prisma.documentChunk.deleteMany({ where: { fileId } });
}
