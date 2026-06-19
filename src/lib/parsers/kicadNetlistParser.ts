/**
 * KiCad S-expression netlist parser.
 *
 * Parses the S-expression .net format KiCad exports:
 *   (export (version "E")
 *     (components (comp (ref "U1") (value "STM32F4") (footprint "...")) ...)
 *     (nets (net (code "1") (name "GND") (node (ref "U1") (pin "5")) ...) ...))
 *
 * Public API mirrors the Altium parser: parseKicadNetlistFile(projectId, filePath)
 * returns NetlistParseSummary. Internally reuses the shared upsert helpers from
 * netlistParser.ts so both parsers write to the same DB schema.
 */
import "server-only";

import { readFile } from "fs/promises";

import { AppError } from "@/lib/errors";

import {
  ComponentRecord,
  NetlistParseSummary,
  NetRecord,
  PinRef,
  upsertComponents,
  upsertNets,
  upsertPinsAndConnections,
} from "./netlistParser";

// ---------------------------------------------------------------------------
// S-expression helpers
// ---------------------------------------------------------------------------

/**
 * Extract all top-level `(keyword ...)` blocks from src using balanced-paren
 * scanning. The keyword must be followed by whitespace or `)` to avoid false
 * matches on longer identifiers (e.g. `comp` won't match inside `components`).
 */
function extractBlocks(src: string, keyword: string): string[] {
  const blocks: string[] = [];
  const prefix = `(${keyword}`;
  let pos = 0;

  while (pos < src.length) {
    const idx = src.indexOf(prefix, pos);
    if (idx === -1) break;

    const charAfter = src[idx + prefix.length];
    if (
      charAfter !== " " &&
      charAfter !== "\n" &&
      charAfter !== "\r" &&
      charAfter !== "\t" &&
      charAfter !== ")"
    ) {
      pos = idx + 1;
      continue;
    }

    let depth = 0;
    let end = -1;
    for (let i = idx; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (end === -1) break; // malformed — bail
    blocks.push(src.slice(idx, end + 1));
    pos = end + 1;
  }

  return blocks;
}

/**
 * Extract the string value of `(keyword "value")` or `(keyword value)` from
 * within a block. Returns null if the attribute is absent.
 */
function extractAttr(block: string, keyword: string): string | null {
  const quoted = new RegExp(`\\(${keyword}\\s+"([^"]*)"`, "s");
  const m = quoted.exec(block);
  if (m) return m[1];

  const unquoted = new RegExp(`\\(${keyword}\\s+([^\\s)]+)`);
  const m2 = unquoted.exec(block);
  return m2?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Pure text parser (no I/O) — exported for unit testing
// ---------------------------------------------------------------------------

export function parseKicadNetlistText(text: string): {
  components: ComponentRecord[];
  nets: NetRecord[];
} {
  const components: ComponentRecord[] = [];
  const nets: NetRecord[] = [];

  for (const compBlock of extractBlocks(text, "comp")) {
    const refDes = extractAttr(compBlock, "ref");
    if (!refDes) continue;
    components.push({
      refDes,
      name: extractAttr(compBlock, "value"),
      footprint: extractAttr(compBlock, "footprint"),
    });
  }

  for (const netBlock of extractBlocks(text, "net")) {
    const name = extractAttr(netBlock, "name");
    if (!name) continue;

    const pins: PinRef[] = [];
    for (const nodeBlock of extractBlocks(netBlock, "node")) {
      const refDes = extractAttr(nodeBlock, "ref");
      const pinNumber = extractAttr(nodeBlock, "pin");
      if (refDes && pinNumber) pins.push({ refDes, pinNumber });
    }

    if (pins.length > 0) nets.push({ name, pins });
  }

  return { components, nets };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a KiCad S-expression .net file and upsert the connectivity data for
 * the given project. Returns a summary of what was written.
 */
export async function parseKicadNetlistFile(
  projectId: string,
  filePath: string
): Promise<NetlistParseSummary> {
  let text: string;
  try {
    text = await readFile(filePath, "utf-8");
  } catch (err) {
    throw new AppError(
      "PARSE_ERROR",
      `Cannot read KiCad netlist file: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const { components, nets } = parseKicadNetlistText(text);

  if (components.length === 0 && nets.length === 0) {
    throw new AppError(
      "PARSE_ERROR",
      "No components or nets found. Verify the file is a KiCad netlist export."
    );
  }

  await upsertComponents(projectId, components);
  await upsertNets(projectId, nets);
  const connectionCount = await upsertPinsAndConnections(projectId, nets);

  return {
    componentCount: components.length,
    netCount: nets.length,
    connectionCount,
    components: components.map((c) => c.refDes),
    nets: nets.map((n) => n.name),
  };
}
