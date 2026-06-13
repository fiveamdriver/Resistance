import { describe, expect, it } from "vitest";

import { chunkDocument } from "./documentChunker";

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
});
