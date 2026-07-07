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
import type { Prisma } from "@prisma/client";

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
  datasheet: ["datasheet", "datasheet url", "datasheet link"],
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
  datasheet: number;
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
    datasheet: resolveColumn(headers, COLUMN_ALIASES.datasheet),
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

export interface BomParseOptions {
  /**
   * ProjectFile id of the BOM being parsed. Each file owns its rows: matching
   * scopes to this file (legacy fileId-null rows are adopted), and rows this
   * file previously produced but no longer contains are deleted after the
   * parse (audit #3 — overlapping BOM sources).
   */
  fileId?: string;
  /**
   * True for kicad_sync exports — a fresh design export outranks whatever is
   * on the Component. Non-authoritative BOMs (loose CSV uploads) only fill
   * empty fields; a conflicting MPN is logged and skipped rather than
   * silently rewriting what drives datasheet fetching.
   */
  authoritative?: boolean;
}

async function upsertBomRow(
  db: Prisma.TransactionClient,
  projectId: string,
  cols: ColumnMap,
  row: string[],
  opts: BomParseOptions
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
  const linked: { id: string; refDes: string; mpn: string | null; datasheetUrl: string | null }[] =
    [];

  for (const ref of individualRefs) {
    const comp = await db.component.findUnique({
      where: { projectId_refDes: { projectId, refDes: ref } },
      select: { id: true, refDes: true, mpn: true, datasheetUrl: true },
    });
    if (comp) {
      linked.push(comp);
      linkedRefs.push(ref);
    } else {
      unlinkedRefs.push(ref);
    }
  }
  const componentIds = linked.map((c) => ({ id: c.id }));

  // Upsert: find an existing BomItem with the same refDesRaw for this project.
  // When this parse carries a fileId, prefer this file's own row and fall back
  // to adopting a legacy fileId-null row (BomItem has no unique constraint, so
  // no native upsert). SQLite sorts NULL smallest, so desc puts own-file first.
  const existing = await db.bomItem.findFirst({
    where: opts.fileId
      ? {
          projectId,
          refDesRaw,
          OR: [{ fileId: opts.fileId }, { fileId: null }],
        }
      : { projectId, refDesRaw },
    orderBy: { fileId: "desc" },
  });

  const data = {
    fileId: opts.fileId ?? existing?.fileId ?? null,
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
    await db.bomItem.update({ where: { id: existing.id }, data });
  } else {
    await db.bomItem.create({
      data: {
        projectId,
        fileId: opts.fileId ?? null,
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

  // Write MPN / Datasheet URL back to each linked Component so the datasheet
  // enrichment pipeline can find them without a join. Authoritative (sync)
  // BOMs overwrite; loose uploads only fill blanks and log conflicts.
  const datasheetRaw = cell(row, cols.datasheet);
  const datasheetUrl =
    datasheetRaw && /^https?:\/\//i.test(datasheetRaw) ? datasheetRaw : null;
  if ((mpn || datasheetUrl) && linked.length > 0) {
    const mpnIds: string[] = [];
    const urlIds: string[] = [];
    for (const comp of linked) {
      if (mpn && comp.mpn !== mpn) {
        if (opts.authoritative || comp.mpn == null) {
          mpnIds.push(comp.id);
        } else {
          console.warn(
            `[bom] MPN conflict on ${comp.refDes}: keeping "${comp.mpn}", ignoring "${mpn}" from non-authoritative BOM`
          );
        }
      }
      if (datasheetUrl && comp.datasheetUrl !== datasheetUrl) {
        if (opts.authoritative || comp.datasheetUrl == null) {
          urlIds.push(comp.id);
        }
      }
    }
    if (mpn && mpnIds.length > 0) {
      await db.component.updateMany({
        where: { id: { in: mpnIds } },
        data: { mpn },
      });
    }
    if (datasheetUrl && urlIds.length > 0) {
      await db.component.updateMany({
        where: { id: { in: urlIds } },
        data: { datasheetUrl },
      });
    }
  }

  return { linkedRefs, unlinkedRefs };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * A pick-and-place / CPL export looks BOM-ish (Designator, Footprint…) but
 * describes placement, not the bill of materials — importing one as a BOM
 * corrupts quantities and can rewrite Component MPNs (audit #3). Position
 * columns + a rotation column together are the tell.
 */
function looksLikePickAndPlace(headers: string[]): boolean {
  const norm = headers.map((h) => h.trim().toLowerCase());
  const hasPositionCol = norm.some((h) =>
    /^(mid|pos|ref|pad|center)\s*[_-]?\s*x$/.test(h)
  );
  const hasRotationCol = norm.some((h) => /^rot(ation)?$/.test(h));
  return hasPositionCol && hasRotationCol;
}

/**
 * Parse an Altium BOM CSV export and upsert the rows into the project.
 * Returns a summary of what was written and which refdes had no matching component.
 */
export async function parseBomFile(
  projectId: string,
  filePath: string,
  opts: BomParseOptions = {}
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

  if (looksLikePickAndPlace(headers)) {
    throw new AppError(
      "PARSE_ERROR",
      "This looks like a pick-and-place / CPL export (position + rotation columns), not a BOM. It was not imported."
    );
  }

  const cols = buildColumnMap(headers);

  if (cols.refDes === -1 && cols.description === -1) {
    throw new AppError(
      "PARSE_ERROR",
      `Could not identify BOM columns. Found headers: ${headers.join(", ")}. ` +
        `Expected at least a Designator or Description column.`
    );
  }

  const dataRows = rows.slice(1);

  // Transactional (audit #5): a crash mid-parse rolls back instead of leaving
  // half a BOM as ground truth.
  return prisma.$transaction(
    async (tx) => {
      let linkedComponentCount = 0;
      const allUnlinked: string[] = [];
      const freshRefDesRaw = new Set<string>();

      for (const row of dataRows) {
        // Skip rows that are entirely blank (papaparse sometimes emits them)
        if (row.every((c) => !c.trim())) continue;

        const raw = cell(row, cols.refDes);
        if (raw) freshRefDesRaw.add(raw);
        const { linkedRefs, unlinkedRefs } = await upsertBomRow(
          tx,
          projectId,
          cols,
          row,
          opts
        );
        if (linkedRefs.length > 0) linkedComponentCount++;
        allUnlinked.push(...unlinkedRefs);
      }

      // Per-file supersede: rows this file produced on an earlier parse but
      // that are gone from the file now are stale. Scoped strictly to this
      // file's rows — other BOM sources are untouched.
      if (opts.fileId) {
        const mine = await tx.bomItem.findMany({
          where: { projectId, fileId: opts.fileId },
          select: { id: true, refDesRaw: true },
        });
        const staleIds = mine
          .filter((r) => r.refDesRaw != null && !freshRefDesRaw.has(r.refDesRaw))
          .map((r) => r.id);
        for (let i = 0; i < staleIds.length; i += 200) {
          await tx.bomItem.deleteMany({
            where: { id: { in: staleIds.slice(i, i + 200) } },
          });
        }
      }

      return {
        rowCount: dataRows.length,
        linkedComponentCount,
        // Deduplicate across rows in case the same refdes appears more than once
        unlinkedRefDes: [...new Set(allUnlinked)],
      };
    },
    { timeout: 60_000, maxWait: 10_000 }
  );
}
