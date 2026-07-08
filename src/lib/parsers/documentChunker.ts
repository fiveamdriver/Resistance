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

/**
 * Replace unpaired UTF-16 surrogates with U+FFFD. PDF text extraction can
 * emit lone surrogates from garbled glyph maps; Prisma rejects them at
 * serialization time ("lone leading surrogate in hex escape"), which made
 * indexing — and therefore quarantine approval — fail for affected
 * datasheets. Valid surrogate pairs (emoji, rare CJK) pass through intact.
 */
export function sanitizeUtf16(text: string): string {
  return text.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "�"
  );
}

/** Split text into overlapping character-window chunks. */
export function chunkDocument(
  text: string,
  options: ChunkOptions = {}
): DocumentChunkData[] {
  const chunkSize = options.chunkSize ?? 1000;
  const overlap = options.overlap ?? 150;
  const clean = sanitizeUtf16(text).replace(/\r\n/g, "\n").trim();

  if (!clean) return [];
  if (clean.length <= chunkSize) {
    return [{ chunkIndex: 0, content: clean }];
  }

  const chunks: DocumentChunkData[] = [];
  const step = Math.max(1, chunkSize - overlap);
  let index = 0;

  for (let start = 0; start < clean.length; start += step) {
    // Sanitize AFTER slicing too: the window boundary can cut a valid
    // surrogate pair in half (e.g. math glyphs like 𝑉 are two UTF-16 code
    // units), leaving a lone surrogate at the chunk edge that Prisma
    // rejects — sanitizing only the whole text misses these.
    const content = sanitizeUtf16(clean.slice(start, start + chunkSize)).trim();
    if (content) {
      chunks.push({ chunkIndex: index++, content });
    }
    if (start + chunkSize >= clean.length) break;
  }

  return chunks;
}
