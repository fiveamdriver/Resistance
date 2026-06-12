/**
 * Document chunker — minimal real implementation (no external deps).
 *
 * Splits text into overlapping chunks suitable for future embedding + RAG.
 * The interface is stable; the splitting strategy can be upgraded later
 * (token-aware, semantic boundaries) without changing callers.
 */

export interface DocumentChunkData {
  chunkIndex: number;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ChunkOptions {
  /** Target chunk size in characters. */
  chunkSize?: number;
  /** Overlap between consecutive chunks in characters. */
  overlap?: number;
}

/**
 * Split text into overlapping character-window chunks.
 *
 * TODO(phase 2): make this token-aware and prefer paragraph/sentence
 * boundaries; attach page numbers from parsePdf() for citation support.
 */
export function chunkDocument(
  text: string,
  options: ChunkOptions = {}
): DocumentChunkData[] {
  const chunkSize = options.chunkSize ?? 1000;
  const overlap = options.overlap ?? 150;
  const clean = text.replace(/\r\n/g, "\n").trim();

  if (!clean) return [];
  if (clean.length <= chunkSize) {
    return [{ chunkIndex: 0, content: clean }];
  }

  const chunks: DocumentChunkData[] = [];
  const step = Math.max(1, chunkSize - overlap);
  let index = 0;

  for (let start = 0; start < clean.length; start += step) {
    const content = clean.slice(start, start + chunkSize).trim();
    if (content) {
      chunks.push({ chunkIndex: index++, content });
    }
    if (start + chunkSize >= clean.length) break;
  }

  return chunks;
}
