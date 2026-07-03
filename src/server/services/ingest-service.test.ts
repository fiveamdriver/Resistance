import { describe, expect, it } from "vitest";

import { verifyDatasheetPdf } from "./ingest-service";

/**
 * Build a small but structurally valid PDF (correct xref offsets) with one
 * page per entry in `pageTexts`. Exercises the real pdf-parse extraction
 * path instead of mocking it.
 */
function makePdf(pageTexts: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

  const objects: string[] = [];
  const pageCount = pageTexts.length;
  const kids = pageTexts.map((_, i) => `${3 + i * 2} 0 R`).join(" ");

  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);

  const fontRef = 3 + pageCount * 2;
  for (let i = 0; i < pageCount; i++) {
    const contentRef = 4 + i * 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentRef} 0 R /Resources << /Font << /F1 ${fontRef} 0 R >> >> >>`
    );
    // Break the text into lines so long content stays inside the media box.
    const words = pageTexts[i].split(/\s+/);
    const lines: string[] = [];
    for (let w = 0; w < words.length; w += 10) {
      lines.push(words.slice(w, w + 10).join(" "));
    }
    const streamBody =
      `BT /F1 12 Tf 72 760 Td\n` +
      lines.map((line) => `(${esc(line)}) Tj 0 -14 Td`).join("\n") +
      `\nET`;
    objects.push(`<< /Length ${Buffer.byteLength(streamBody)} >>\nstream\n${streamBody}\nendstream`);
  }
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);

  let pdf = `%PDF-1.4\n`;
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}

const FILLER =
  "The output voltage is adjustable over a wide range and the device features " +
  "internal current limiting thermal overload protection and safe area compensation. " +
  "Typical applications include local on card regulation and programmable output regulation.";

describe("verifyDatasheetPdf", () => {
  it("verifies a PDF that names the exact MPN", async () => {
    const pdf = makePdf([`LM317-N three terminal adjustable regulator. ${FILLER}`]);
    const result = await verifyDatasheetPdf(pdf, "LM317-N");
    expect(result).toEqual({ ok: true });
  });

  it("tolerates dash/spacing variants via normalization", async () => {
    const pdf = makePdf([`The LM317 N wide input regulator. ${FILLER}`]);
    const result = await verifyDatasheetPdf(pdf, "lm317-n");
    expect(result.ok).toBe(true);
  });

  it("matches the base part when the MPN has a packaging suffix", async () => {
    const pdf = makePdf([`LM317 adjustable regulator datasheet. ${FILLER}`]);
    const result = await verifyDatasheetPdf(pdf, "LM317-NOPB");
    expect(result.ok).toBe(true);
  });

  it("quarantines the wrong document (part number absent)", async () => {
    const pdf = makePdf([`NE555 precision timer datasheet. ${FILLER}`]);
    const result = await verifyDatasheetPdf(pdf, "LM317-N");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("LM317-N");
  });

  it("requires the MPN near the front, not buried at the back", async () => {
    const pages = [FILLER, FILLER, FILLER, FILLER, FILLER, `Appendix mentions LM317-N once. ${FILLER}`];
    const result = await verifyDatasheetPdf(makePdf(pages), "LM317-N");
    expect(result.ok).toBe(false);
  });

  it("rejects non-PDF bytes", async () => {
    const result = await verifyDatasheetPdf(Buffer.from("<html>404 not found</html>"), "LM317-N");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("magic bytes");
  });

  it("rejects documents with too little extractable text", async () => {
    const result = await verifyDatasheetPdf(makePdf(["LM317-N"]), "LM317-N");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("extractable text");
  });
});
