/**
 * Parser dispatch surface.
 *
 * Central place to pick a parser by file category and to expose all parser
 * interfaces. The upload pipeline / a future background job will call
 * dispatchParse() after a file lands on disk.
 */
import type { FileCategory } from "@/lib/fileTypes";

import { parseBom } from "./bom";
import { chunkDocument } from "./chunk";
import { parseNetlist } from "./netlist";
import { parsePdf } from "./pdf";

export { parseNetlist } from "./netlist";
export { parseBom } from "./bom";
export { parsePdf } from "./pdf";
export { chunkDocument } from "./chunk";
export type { ParsedNetlist } from "./netlist";
export type { ParsedBom, ParsedBomRow } from "./bom";
export type { ParsedPdf } from "./pdf";
export type { DocumentChunkData, ChunkOptions } from "./chunk";

export type ParseResult =
  | { kind: "netlist"; data: Awaited<ReturnType<typeof parseNetlist>> }
  | { kind: "bom"; data: Awaited<ReturnType<typeof parseBom>> }
  | { kind: "pdf"; data: Awaited<ReturnType<typeof parsePdf>> }
  | { kind: "document"; data: ReturnType<typeof chunkDocument> }
  | { kind: "unsupported" };

/**
 * Route a file to the correct parser based on its category.
 *
 * TODO(phase 2): persist parser output to the DB (Components/Nets/Pins/
 * Connections/BomItems/DocumentChunks) and update ProjectFile.parseStatus.
 */
export async function dispatchParse(
  category: FileCategory,
  filePath: string,
  rawText = ""
): Promise<ParseResult> {
  switch (category) {
    case "netlist":
      return { kind: "netlist", data: await parseNetlist(filePath) };
    case "bom":
      return { kind: "bom", data: await parseBom(filePath) };
    case "pdf":
      return { kind: "pdf", data: await parsePdf(filePath) };
    case "document":
      return { kind: "document", data: chunkDocument(rawText) };
    default:
      return { kind: "unsupported" };
  }
}
