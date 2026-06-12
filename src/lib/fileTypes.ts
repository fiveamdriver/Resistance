/**
 * File type / category definitions.
 *
 * Phase 1 keeps these as plain string unions (mirrored by string columns in the
 * Prisma schema) so the data model stays Postgres-portable without enums.
 */

export type FileCategory = "netlist" | "bom" | "pdf" | "document" | "other";

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
].join(",");

/** Extract a lowercased extension (incl. leading dot) from a filename. */
export function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}

/**
 * Map a filename to a category. `.txt` is ambiguous between a netlist and a
 * plain document; we default it to "document" but a caller (or the future
 * parser dispatcher) can override based on content sniffing.
 */
export function categorizeFile(filename: string): FileCategory {
  const ext = getExtension(filename);
  for (const [category, exts] of Object.entries(ACCEPTED_EXTENSIONS)) {
    if (exts.includes(ext)) return category as FileCategory;
  }
  return "other";
}

/** Whether the given filename has an extension we accept for upload. */
export function isAcceptedFile(filename: string): boolean {
  return categorizeFile(filename) !== "other";
}
