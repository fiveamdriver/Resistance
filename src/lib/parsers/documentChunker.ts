/**
 * Document chunker for RAG pipelines.
 *
 * Splits text into overlapping character-window chunks suitable for embedding.
 * The interface is stable; the splitting strategy (token-aware, semantic
 * boundaries, page provenance) can be upgraded without changing callers.
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

/** Split text into overlapping character-window chunks. */
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
