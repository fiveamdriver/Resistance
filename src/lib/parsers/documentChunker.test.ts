import { describe, expect, it } from "vitest";

import { chunkDocument, sanitizeUtf16 } from "./documentChunker";

describe("chunkDocument", () => {
  it("returns a single chunk for short text", () => {
    const chunks = chunkDocument("short text");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkIndex).toBe(0);
  });

  it("returns no chunks for empty text", () => {
    expect(chunkDocument("   ")).toHaveLength(0);
  });

  it("splits long text into overlapping chunks with sequential indices", () => {
    const text = "A".repeat(2500);
    const chunks = chunkDocument(text, { chunkSize: 1000, overlap: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].content.length).toBeLessThanOrEqual(1000);
    chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i));
  });

  it("never leaves a lone surrogate when the window cuts a pair in half", () => {
    // 𝑉 (U+1D449) is a surrogate pair; place it so the 1000-char window
    // boundary lands between its two halves.
    const text = "A".repeat(999) + "𝑉" + "B".repeat(1500);
    const chunks = chunkDocument(text, { chunkSize: 1000, overlap: 150 });
    const lone =
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    for (const c of chunks) {
      expect(lone.test(c.content)).toBe(false);
      expect(() => JSON.stringify(c.content)).not.toThrow();
    }
  });

  it("strips lone surrogates from garbled PDF extraction", () => {
    // Lone high surrogate mid-text — the exact shape that made Prisma reject
    // the AP64501 datasheet chunks at approval time.
    const garbled = `Iq is 22\uD835A typical`; // \uD835 with no low surrogate
    const chunks = chunkDocument(garbled);
    expect(chunks[0].content).toBe("Iq is 22�A typical");
  });
});

describe("sanitizeUtf16", () => {
  it("replaces lone high and low surrogates", () => {
    expect(sanitizeUtf16("a\uD800b")).toBe("a�b");
    expect(sanitizeUtf16("a\uDC00b")).toBe("a�b");
  });

  it("keeps valid surrogate pairs (emoji) intact", () => {
    expect(sanitizeUtf16("temp 🌡 rise")).toBe("temp 🌡 rise");
  });

  it("leaves plain ASCII untouched", () => {
    expect(sanitizeUtf16("VIN = 40V max")).toBe("VIN = 40V max");
  });
});
