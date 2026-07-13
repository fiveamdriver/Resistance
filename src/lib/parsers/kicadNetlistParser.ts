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

import { extractAttr, extractBlocks } from "./sexpr";
import {
  ComponentRecord,
  NetlistParseSummary,
  NetRecord,
  PinRef,
  writeConnectivity,
} from "./netlistParser";

// ---------------------------------------------------------------------------
// Format detection — exported so file-service can import it and tests can cover it
// ---------------------------------------------------------------------------

/**
 * Returns true if the file header looks like a KiCad S-expression netlist.
 * Accepts both the classic single-line form `(export (version "E")` and the
 * KiCad 10+ multi-line form `(export\n\t(version "D")`.
 * Pass the first 128 bytes of the file (trimmed of leading whitespace/BOM).
 */
export function isKicadNetlist(header: string): boolean {
  return /^\(export\s+\(version/.test(header.trimStart());
}

// ---------------------------------------------------------------------------
// Pure text parser (no I/O) — exported for unit testing
// ---------------------------------------------------------------------------

/** KiCad writes empty fields as "" (and empty datasheet as "~"). */
function emptyToNull(v: string | null): string | null {
  return v === null || v.trim() === "" ? null : v;
}

export function parseKicadNetlistText(text: string): {
  components: ComponentRecord[];
  nets: NetRecord[];
} {
  const components: ComponentRecord[] = [];
  const nets: NetRecord[] = [];

  for (const compBlock of extractBlocks(text, "comp")) {
    const refDes = extractAttr(compBlock, "ref");
    if (!refDes) continue;

    // Extract MPN and Datasheet from (property (name "...") (value "..."))
    // blocks. KiCad 6+ emits these alongside the (fields ...) block;
    // (property ...) uses the standard (name)/(value) format and is easier to
    // parse. "Datasheet" is a stock KiCad symbol field.
    let mpn: string | null = null;
    let datasheetUrl: string | null = null;
    for (const propBlock of extractBlocks(compBlock, "property")) {
      const propName = extractAttr(propBlock, "name");
      if (propName === "MPN#" && mpn === null) {
        mpn = extractAttr(propBlock, "value");
      } else if (propName === "Datasheet" && datasheetUrl === null) {
        datasheetUrl = extractAttr(propBlock, "value");
      }
    }
    // Netlists also carry a bare (datasheet "...") attribute on the comp.
    datasheetUrl = datasheetUrl ?? extractAttr(compBlock, "datasheet");
    // KiCad uses "~" for empty; only keep real web URLs.
    if (datasheetUrl && !/^https?:\/\//i.test(datasheetUrl)) {
      datasheetUrl = null;
    }

    // KiCad's (value ...) doubles as part name for ICs and value for passives
    // ("100n"). Keep it as the value proper, and take the name from the
    // symbol's (libsource (part ...)) — falling back to the value when the
    // libsource is missing so name never regresses to null.
    const value = emptyToNull(extractAttr(compBlock, "value"));
    const libsource = extractBlocks(compBlock, "libsource")[0];
    const libPart = libsource ? emptyToNull(extractAttr(libsource, "part")) : null;
    const description = libsource
      ? emptyToNull(extractAttr(libsource, "description"))
      : null;

    components.push({
      refDes,
      name: libPart ?? value,
      value,
      description,
      footprint: extractAttr(compBlock, "footprint"),
      mpn,
      datasheetUrl,
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
 *
 * `opts.prune` (sync provenance only) additionally deletes nets and pins that
 * are absent from this parse — see writeConnectivity.
 */
export async function parseKicadNetlistFile(
  projectId: string,
  filePath: string,
  opts: { prune?: boolean } = {}
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

  const written = await writeConnectivity(projectId, components, nets, opts);

  return {
    componentCount: components.length,
    netCount: nets.length,
    connectionCount: written.connectionCount,
    components: components.map((c) => c.refDes),
    nets: nets.map((n) => n.name),
    allRefDes: written.allRefDes,
    pruned: written.pruned,
  };
}
