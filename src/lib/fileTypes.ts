/**
 * File type / category definitions.
 *
 * Plain string unions mirrored by string columns in the Prisma schema keep the
 * data model Postgres-portable without enum migrations.
 */

export type FileCategory =
  | "netlist"
  | "bom"
  | "pdf"
  | "document"
  | "altium"
  | "other";

export type ParseStatus = "pending" | "parsed" | "failed";

/** Allowed upload extensions grouped by the category they map to. */
export const ACCEPTED_EXTENSIONS: Record<
  Exclude<FileCategory, "other">,
  string[]
> = {
  // Altium netlist exports
  netlist: [".net"],
  // BOM exports
  bom: [".csv", ".xlsx"],
  // Datasheets / schematic PDFs
  pdf: [".pdf"],
  // General docs (.txt can be a netlist OR a doc — see categorizeFile)
  document: [".md", ".txt", ".docx"],
  // Altium native binary documents (schematic / PCB) — imported & stored;
  // connectivity extraction from the binary is future work (see altiumParser).
  altium: [".schdoc", ".pcbdoc"],
};

/** Flat list for the file input `accept` attribute. */
export const ACCEPT_ATTR = [
  ".net",
  ".txt",
  ".csv",
  ".xlsx",
  ".pdf",
  ".md",
  ".docx",
  ".schdoc",
  ".pcbdoc",
].join(",");

/** Extract a lowercased extension (incl. leading dot) from a filename. */
export function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}

/**
 * Pick-and-place / CPL / centroid exports share the BOM's .csv extension but
 * describe placement, not the bill of materials (audit #3: one imported as a
 * BOM corrupts quantities and MPNs). Matches the common EDA export names:
 * KiCad "-pos"/"-all-pos", JLC "CPL_…", Altium "Pick Place …", centroids.
 */
const PICK_AND_PLACE_NAME_RE =
  /(^|[-_.\s])(cpl|pnp|centroid|pos|positions|placement|pick[\s_-]?(and[\s_-]?)?place)([-_.\s]|$)/i;

/**
 * Map a filename to a category. `.txt` is ambiguous between a netlist and a
 * plain document; defaults to "document" but callers can override based on
 * content sniffing. `.csv` files named like pick-and-place exports are
 * "other" — bomParser also rejects them by content as a second line of
 * defense.
 */
export function categorizeFile(filename: string): FileCategory {
  const ext = getExtension(filename);
  if (ext === ".csv" || ext === ".xlsx") {
    const stem = filename.slice(0, filename.length - ext.length);
    if (PICK_AND_PLACE_NAME_RE.test(stem)) return "other";
  }
  for (const [category, exts] of Object.entries(ACCEPTED_EXTENSIONS)) {
    if (exts.includes(ext)) return category as FileCategory;
  }
  return "other";
}

/** Whether the given filename has an extension we accept for upload. */
export function isAcceptedFile(filename: string): boolean {
  return categorizeFile(filename) !== "other";
}
