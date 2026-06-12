import { describe, expect, it } from "vitest";

import { chunkDocument } from "./chunk";
import { parseBom } from "./bom";
import { parseNetlist } from "./netlist";
import { parsePdf } from "./pdf";

describe("parser placeholders return the documented shapes", () => {
  it("parseNetlist returns connections, components, and nets", async () => {
    const result = await parseNetlist("/mock/path.net");
    expect(result.connections.length).toBeGreaterThan(0);
    expect(result.components.length).toBeGreaterThan(0);
    expect(result.nets).toContain("5V");
    for (const c of result.connections) {
      expect(c).toHaveProperty("componentRefDes");
      expect(c).toHaveProperty("netName");
    }
  });

  it("parseBom returns rows with a quantity", async () => {
    const result = await parseBom("/mock/path.csv");
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0].quantity).toBeGreaterThanOrEqual(1);
  });

  it("parsePdf returns text and page metadata", async () => {
    const result = await parsePdf("/mock/path.pdf");
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.metadata.pageCount).toBe(result.pages.length);
  });
});

describe("chunkDocument", () => {
  it("returns a single chunk for short text", () => {
    const chunks = chunkDocument("short text");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkIndex).toBe(0);
  });

  it("returns no chunks for empty text", () => {
    expect(chunkDocument("   ")).toHaveLength(0);
  });

  it("splits long text into overlapping chunks", () => {
    const text = "A".repeat(2500);
    const chunks = chunkDocument(text, { chunkSize: 1000, overlap: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].content.length).toBeLessThanOrEqual(1000);
    // chunk indices are sequential
    chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i));
  });
});
