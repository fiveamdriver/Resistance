/**
 * Altium BOM CSV parser.
 *
 * Uses papaparse to parse the CSV, then maps Altium column names tolerantly
 * (case-insensitive, partial match, common alias variants). Upserts BomItems
 * and links them to existing Components via the project's refdes.
 *
 * Safe to call multiple times — re-parsing the same file updates existing rows
 * instead of creating duplicates.
 */
import "server-only";

import { readFile } from "fs/promises";

import Papa from "papaparse";

import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

export interface BomParseSummary {
  rowCount: number;
  /** How many BomItems were linked to at least one existing Component. */
  linkedComponentCount: number;
  /** RefDes values in the BOM that had no matching Component in the project. */
  unlinkedRefDes: string[];
}

// ---------------------------------------------------------------------------
// Column resolution
// ---------------------------------------------------------------------------

/**
 * Aliases for each logical field. Listed in priority order — first exact match
 * wins, then first partial match.
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  refDes: [
    "designator",
    "refdes",
    "ref des",
    "ref",
    "reference",
    "reference designator",
    "component designator",
    "comp ref",
  ],
  description: [
    "description",
    "comment",
    "desc",
    "part description",
    "component description",
  ],
  manufacturer: [
    "manufacturer",
    "mfr",
    "mfg",
    "maker",
    "manufacturer name",
  ],
  mpn: [
    "mpn",
    "manufacturer part number",
    "part number",
    "part no",
    "part#",
    "mfr part no",
    "mfr part",
    "order code",
    "pn",
    "part_number",
  ],
  value: ["value", "val", "component value"],
  footprint: ["footprint", "package", "pcb footprint", "pattern", "land pattern"],
  quantity: ["quantity", "qty", "count", "amount", "num"],
};

/**
 * Given the CSV headers (as-is) and an alias list, return the column index or
 * -1 if not found. Tries exact case-insensitive match first, then substring.
 */
function resolveColumn(headers: string[], aliases: string[]): number {
  const lower = headers.map((h) => h.toLowerCase().trim());

  // Exact match (case-insensitive)
  for (const alias of aliases) {
    const idx = lower.indexOf(alias.toLowerCase());
    if (idx !== -1) return idx;
  }

  // Partial / contains match
  for (const alias of aliases) {
    const a = alias.toLowerCase();
    const idx = lower.findIndex((h) => h.includes(a) || a.includes(h));
    if (idx !== -1) return idx;
  }

  return -1;
}

interface ColumnMap {
  refDes: number;
  description: number;
  manufacturer: number;
  mpn: number;
  value: number;
  footprint: number;
  quantity: number;
}

function buildColumnMap(headers: string[]): ColumnMap {
  return {
    refDes: resolveColumn(headers, COLUMN_ALIASES.refDes),
    description: resolveColumn(headers, COLUMN_ALIASES.description),
    manufacturer: resolveColumn(headers, COLUMN_ALIASES.manufacturer),
    mpn: resolveColumn(headers, COLUMN_ALIASES.mpn),
    value: resolveColumn(headers, COLUMN_ALIASES.value),
    footprint: resolveColumn(headers, COLUMN_ALIASES.footprint),
    quantity: resolveColumn(headers, COLUMN_ALIASES.quantity),
  };
}

// ---------------------------------------------------------------------------
// Row normalization
// ---------------------------------------------------------------------------

function cell(row: string[], idx: number): string | null {
  if (idx === -1) return null;
  const v = row[idx]?.trim() ?? "";
  return v === "" ? null : v;
}

/**
 * Expand an Altium refdes cell (possibly "R1, R2, R3" or "R1 R2 R3") into
 * individual designators.
 */
function expandRefDes(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((r) => r.trim())
    .filter(Boolean);
}

function parseQuantity(raw: string | null): number {
  if (!raw) return 1;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// ---------------------------------------------------------------------------
// DB upserts
// ---------------------------------------------------------------------------

async function upsertBomRow(
  projectId: string,
  cols: ColumnMap,
  row: string[]
): Promise<{ linkedRefs: string[]; unlinkedRefs: string[] }> {
  const refDesRaw = cell(row, cols.refDes);
  const description = cell(row, cols.description);
  const manufacturer = cell(row, cols.manufacturer);
  const mpn = cell(row, cols.mpn);
  const value = cell(row, cols.value);
  const footprint = cell(row, cols.footprint);
  const quantity = parseQuantity(cell(row, cols.quantity));

  // Resolve component links for the M2M relation
  const individualRefs = expandRefDes(refDesRaw);
  const linkedRefs: string[] = [];
  const unlinkedRefs: string[] = [];
  const componentIds: { id: string }[] = [];

  for (const ref of individualRefs) {
    const comp = await prisma.component.findUnique({
      where: { projectId_refDes: { projectId, refDes: ref } },
      select: { id: true },
    });
    if (comp) {
      componentIds.push({ id: comp.id });
      linkedRefs.push(ref);
    } else {
      unlinkedRefs.push(ref);
    }
  }

  // Upsert: find an existing BomItem with the same refDesRaw for this project
  // (BomItem has no unique constraint, so we can't use Prisma's native upsert)
  const existing = await prisma.bomItem.findFirst({
    where: { projectId, refDesRaw: refDesRaw },
  });

  const data = {
    description,
    manufacturer,
    mpn,
    value,
    footprint,
    quantity,
    components: {
      // Replace the full set of linked components so re-parses stay accurate
      set: componentIds,
    },
  };

  if (existing) {
    await prisma.bomItem.update({ where: { id: existing.id }, data });
  } else {
    await prisma.bomItem.create({
      data: {
        projectId,
        refDesRaw,
        description,
        manufacturer,
        mpn,
        value,
        footprint,
        quantity,
        components: { connect: componentIds },
      },
    });
  }

  return { linkedRefs, unlinkedRefs };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an Altium BOM CSV export and upsert the rows into the project.
 * Returns a summary of what was written and which refdes had no matching component.
 */
export async function parseBomFile(
  projectId: string,
  filePath: string
): Promise<BomParseSummary> {
  let csvText: string;
  try {
    csvText = await readFile(filePath, "utf-8");
  } catch (err) {
    throw new AppError(
      "PARSE_ERROR",
      `Cannot read BOM file: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const result = Papa.parse<string[]>(csvText, {
    skipEmptyLines: true,
    // Parse as raw arrays so we can inspect the first row as headers ourselves
    header: false,
  });

  if (result.errors.length > 0 && result.data.length === 0) {
    throw new AppError(
      "PARSE_ERROR",
      `CSV parse error: ${result.errors[0].message}`
    );
  }

  const rows = result.data as string[][];
  if (rows.length < 2) {
    throw new AppError("PARSE_ERROR", "BOM file has no data rows.");
  }

  const headers = rows[0].map((h) => h.trim());
  const cols = buildColumnMap(headers);

  if (cols.refDes === -1 && cols.description === -1) {
    throw new AppError(
      "PARSE_ERROR",
      `Could not identify BOM columns. Found headers: ${headers.join(", ")}. ` +
        `Expected at least a Designator or Description column.`
    );
  }

  const dataRows = rows.slice(1);
  let linkedComponentCount = 0;
  const allUnlinked: string[] = [];

  for (const row of dataRows) {
    // Skip rows that are entirely blank (papaparse sometimes emits them)
    if (row.every((c) => !c.trim())) continue;

    const { linkedRefs, unlinkedRefs } = await upsertBomRow(projectId, cols, row);
    if (linkedRefs.length > 0) linkedComponentCount++;
    allUnlinked.push(...unlinkedRefs);
  }

  return {
    rowCount: dataRows.length,
    linkedComponentCount,
    // Deduplicate across rows in case the same refdes appears more than once
    unlinkedRefDes: [...new Set(allUnlinked)],
  };
}
