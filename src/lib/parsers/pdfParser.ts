import { PDFParse } from "pdf-parse";

export interface PdfPage {
  /** 1-based page number. */
  page: number;
  text: string;
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.text;
}

/** Extract text per page, preserving page numbers for chunk provenance. */
export async function extractPdfPages(buffer: Buffer): Promise<PdfPage[]> {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.pages.map((p) => ({ page: p.num, text: p.text }));
}
