/**
 * PDF parser — PLACEHOLDER.
 *
 * Phase 1 returns mock extracted text + page metadata. Used for datasheets,
 * schematic PDFs, and requirements docs that later feed the RAG pipeline.
 */

export interface ParsedPdf {
  text: string; // full concatenated text
  pages: { pageNumber: number; text: string }[];
  metadata: {
    pageCount: number;
    title?: string;
  };
}

/**
 * Extract text from a PDF file.
 *
 * @param _filePath absolute path to the uploaded PDF
 *
 * TODO(phase 2): use a PDF text-extraction library (e.g. pdf-parse / pdfjs).
 * For scanned datasheets without a text layer, fall back to OCR. Return per-page
 * text so chunking can preserve page provenance for citations.
 */
export async function parsePdf(_filePath: string): Promise<ParsedPdf> {
  // --- MOCK DATA (remove when real parsing lands) --------------------------
  const pages = [
    {
      pageNumber: 1,
      text:
        "TPS54331 — 3.5V to 28V Input, 3A Step-Down Converter. Absolute maximum ratings...",
    },
    {
      pageNumber: 2,
      text:
        "Electrical Characteristics. Switching frequency 570 kHz typical. Enable threshold...",
    },
  ];

  return {
    text: pages.map((p) => p.text).join("\n\n"),
    pages,
    metadata: { pageCount: pages.length, title: "TPS54331 Datasheet (mock)" },
  };
}
