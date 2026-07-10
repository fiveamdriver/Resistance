import { describe, expect, it } from "vitest";

import { makePdf, PDF_FILLER as FILLER } from "@/test/pdf-fixture";

import { verifyDatasheetPdf } from "./ingest-service";

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
