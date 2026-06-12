/**
 * BOM parser — PLACEHOLDER.
 *
 * Phase 1 returns mock rows. Supports `.csv` and `.xlsx` once implemented.
 */

export interface ParsedBomRow {
  refDesRaw?: string; // raw refdes cell, e.g. "R1, R2, R3"
  description?: string;
  manufacturer?: string;
  mpn?: string; // manufacturer part number
  value?: string;
  footprint?: string;
  quantity: number;
}

export interface ParsedBom {
  rows: ParsedBomRow[];
}

/**
 * Parse a Bill of Materials export into normalized rows.
 *
 * @param _filePath absolute path to the uploaded BOM file (.csv / .xlsx)
 *
 * TODO(phase 2): detect extension; parse CSV with a streaming CSV reader and
 * XLSX with a spreadsheet library. Normalize common column header aliases
 * (e.g. "Designator"/"RefDes", "Comment"/"Description", "MPN"/"Part Number").
 * Expand multi-refdes cells ("R1, R2") so each maps to its Component.
 */
export async function parseBom(_filePath: string): Promise<ParsedBom> {
  // --- MOCK DATA (remove when real parsing lands) --------------------------
  return {
    rows: [
      {
        refDesRaw: "U7",
        description: "3A Step-Down Regulator",
        manufacturer: "Texas Instruments",
        mpn: "TPS54331DR",
        quantity: 1,
      },
      {
        refDesRaw: "R12",
        description: "Resistor 10k 1%",
        manufacturer: "Yageo",
        mpn: "RC0402FR-0710KL",
        value: "10k",
        footprint: "0402",
        quantity: 1,
      },
      {
        refDesRaw: "C5",
        description: "Capacitor 100nF 16V X7R",
        manufacturer: "Murata",
        mpn: "GRM155R71C104KA88D",
        value: "100nF",
        footprint: "0402",
        quantity: 1,
      },
    ],
  };
}
