/**
 * Automatic datasheet ingestion (docs/DATASHEET_INGESTION_PLAN.md).
 *
 * ingestRemotePdf: download a datasheet URL, run the verification gate, store
 * it once globally (content-hashed DatasheetLibrary), link it into the project
 * as a ProjectFile, and index it for search — or quarantine it if the gate
 * fails. Nothing quarantined is ever indexed.
 *
 * approveQuarantinedFile: the one-click human approval that promotes a
 * quarantined document to verified and indexes it.
 */
import "server-only";

import { createHash } from "crypto";
import { readFile } from "fs/promises";

import { AppError } from "@/lib/errors";
import { extractPdfPages } from "@/lib/parsers/pdfParser";
import { prisma } from "@/lib/prisma";
import { resolveStoredPath, saveLibraryFile } from "@/lib/storage";

import { deleteDocumentChunks, indexDocumentFile } from "./document-service";
import { getSettings } from "./settings-service";

export type IngestProvenance = "design_link" | "web_fetch";

/** Higher wins: a live doc is only replaced by a higher-provenance one. */
const TIER: Record<string, number> = {
  upload: 3,
  design_link: 2,
  web_fetch: 1,
};

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
/** MPN must appear within the first N pages of the document. */
const MPN_SEARCH_PAGES = 5;
const MIN_TEXT_CHARS = 200;

export interface IngestResult {
  status: "verified" | "quarantined" | "skipped" | "failed";
  fileId?: string;
  reason?: string;
}

class IngestError extends AppError {
  constructor(message: string) {
    super("INGEST_ERROR", message);
    this.name = "IngestError";
  }
}

/** Uppercased alphanumerics only — tolerant of dashes/dots/spacing variants. */
function normalizeAlnum(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * MPN candidates to look for in the document, most to least specific: the
 * full MPN, then with trailing packaging/reel suffixes stripped (segments
 * after '-' or '/'), never shorter than 4 characters.
 */
function mpnCandidates(mpn: string): string[] {
  const candidates = [normalizeAlnum(mpn)];
  const parts = mpn.split(/[-/]/);
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = normalizeAlnum(parts.slice(0, i).join(""));
    if (prefix.length >= 4) candidates.push(prefix);
  }
  return [...new Set(candidates)].filter((c) => c.length >= 4);
}

interface GateResult {
  ok: boolean;
  reason?: string;
  /**
   * True when the download isn't a plausible datasheet at all (HTML page,
   * oversized, unparseable) — record the failure but store nothing; there is
   * nothing meaningful for a human to review.
   */
  hardFail?: boolean;
}

/**
 * Verification gate: only documents that demonstrably are the datasheet for
 * this MPN (readable PDF, part number present near the front) pass. Anything
 * else is quarantined — a wrong or garbled document indexed as ground truth
 * is worse than no document.
 */
export async function verifyDatasheetPdf(
  bytes: Buffer,
  mpn: string
): Promise<GateResult> {
  if (bytes.length > MAX_PDF_BYTES) {
    return { ok: false, hardFail: true, reason: `File exceeds ${MAX_PDF_BYTES / 1024 / 1024}MB cap` };
  }
  if (!bytes.subarray(0, 5).toString("latin1").startsWith("%PDF-")) {
    return { ok: false, hardFail: true, reason: "Not a PDF (magic bytes missing)" };
  }

  let pages;
  try {
    pages = await extractPdfPages(bytes);
  } catch (err) {
    return {
      ok: false,
      hardFail: true,
      reason:
        "PDF text extraction failed: " +
        (err instanceof Error ? err.message : "unknown error"),
    };
  }

  const fullText = pages.map((p) => p.text).join("\n");
  if (fullText.trim().length < MIN_TEXT_CHARS) {
    return {
      ok: false,
      reason: "Too little extractable text (image-only scan or empty document)",
    };
  }

  // Extraction-quality check: mostly non-word garbage means garbled output
  // that would be quoted confidently later.
  const tokens = fullText.split(/\s+/).filter(Boolean);
  const wordish = tokens.filter((t) => /[A-Za-z0-9]{2,}/.test(t));
  if (tokens.length >= 50 && wordish.length / tokens.length < 0.5) {
    return { ok: false, reason: "Extracted text is mostly non-words (garbled extraction)" };
  }

  const head = normalizeAlnum(
    pages.slice(0, MPN_SEARCH_PAGES).map((p) => p.text).join("\n")
  );
  const found = mpnCandidates(mpn).some((c) => head.includes(c));
  if (!found) {
    return {
      ok: false,
      reason: `Part number "${mpn}" not found in the first ${MPN_SEARCH_PAGES} pages`,
    };
  }

  return { ok: true };
}

async function downloadPdf(url: string): Promise<Buffer> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new IngestError(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new IngestError(`Unsupported URL scheme: ${parsed.protocol}`);
  }

  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "User-Agent": "Resistance-Datasheet-Ingest/1.0" },
  });
  if (!response.ok) {
    throw new IngestError(`Download failed: HTTP ${response.status}`);
  }

  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_PDF_BYTES) {
    throw new IngestError(`File exceeds ${MAX_PDF_BYTES / 1024 / 1024}MB cap`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_PDF_BYTES) {
    throw new IngestError(`File exceeds ${MAX_PDF_BYTES / 1024 / 1024}MB cap`);
  }
  return bytes;
}

/** Highest live (verified) tier already covering this (project, mpn). */
async function existingTier(projectId: string, mpn: string): Promise<number> {
  const files = await prisma.projectFile.findMany({
    where: { projectId, mpn, verifyStatus: "verified" },
    select: { provenance: true },
  });
  return files.reduce((max, f) => Math.max(max, TIER[f.provenance] ?? 0), 0);
}

/** Supersede lower-tier live docs for this (project, mpn): unsearchable, kept visible. */
async function supersedeLowerTiers(
  projectId: string,
  mpn: string,
  newTier: number
): Promise<void> {
  const files = await prisma.projectFile.findMany({
    where: { projectId, mpn, verifyStatus: "verified" },
    select: { id: true, provenance: true },
  });
  for (const f of files) {
    if ((TIER[f.provenance] ?? 0) < newTier) {
      await deleteDocumentChunks(f.id);
      await prisma.projectFile.update({
        where: { id: f.id },
        data: { verifyStatus: "superseded" },
      });
    }
  }
}

export interface IngestRequest {
  projectId: string;
  mpn: string;
  url: string;
  provenance: IngestProvenance;
}

/**
 * Fetch, verify, store, and index one datasheet for one (project, mpn).
 * Never throws — every outcome (including network failure) is a status the
 * caller can record.
 */
export async function ingestRemotePdf(req: IngestRequest): Promise<IngestResult> {
  const { projectId, mpn, url, provenance } = req;
  const tier = TIER[provenance];

  try {
    // Already covered by an equal-or-higher tier? Nothing to do.
    if ((await existingTier(projectId, mpn)) >= tier) {
      return { status: "skipped", reason: "Already covered by an equal-or-higher tier document" };
    }

    // Library-first for web_fetch: identical part → reuse the stored document
    // instead of re-downloading. design_link always honors the engineer's URL
    // (content-hash dedupe still collapses identical bytes below).
    let bytes: Buffer | null = null;
    let sourceUrl = url;
    if (provenance === "web_fetch") {
      const cached = await prisma.datasheetLibrary.findFirst({
        where: { mpn },
        orderBy: { fetchedAt: "desc" },
      });
      if (cached) {
        bytes = await readFile(resolveStoredPath(cached.filePath));
        sourceUrl = cached.sourceUrl ?? url;
      }
    }
    if (!bytes) {
      bytes = await downloadPdf(url);
    }

    const gate = await verifyDatasheetPdf(bytes, mpn);
    if (!gate.ok && gate.hardFail) {
      // Not a reviewable document (HTML error page, oversize, unparseable) —
      // nothing to quarantine.
      return { status: "failed", reason: gate.reason };
    }

    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const stored = await saveLibraryFile(contentHash, ".pdf", bytes);

    if (gate.ok) {
      await prisma.datasheetLibrary.upsert({
        where: { contentHash },
        update: {},
        create: { mpn, contentHash, filePath: stored.relativePath, sourceUrl },
      });
    }

    const fileName = `${mpn}-datasheet.pdf`;
    const record = await prisma.projectFile.create({
      data: {
        projectId,
        originalName: fileName,
        storedName: stored.storedName,
        path: stored.relativePath,
        fileType: "application/pdf",
        category: "pdf",
        sizeBytes: stored.sizeBytes,
        parseStatus: "pending",
        provenance,
        sourceUrl,
        verifyStatus: gate.ok ? "verified" : "quarantined",
        contentHash,
        mpn,
      },
    });

    if (!gate.ok) {
      await prisma.projectFile.update({
        where: { id: record.id },
        data: { parseStatus: "failed", parseError: gate.reason },
      });
      return { status: "quarantined", fileId: record.id, reason: gate.reason };
    }

    await supersedeLowerTiers(projectId, mpn, tier);
    const { chunkCount } = await indexDocumentFile(
      projectId,
      record.id,
      stored.absolutePath,
      "pdf"
    );
    await prisma.projectFile.update({
      where: { id: record.id },
      data: { parseStatus: "parsed" },
    });
    return {
      status: "verified",
      fileId: record.id,
      reason: `Indexed ${chunkCount} chunks`,
    };
  } catch (err) {
    return {
      status: "failed",
      reason: err instanceof Error ? err.message : "Unexpected ingestion error",
    };
  }
}

/**
 * Per-run cap on new datasheet downloads, so a 200-part first sync doesn't
 * fire 200 fetches at once. Remaining parts are picked up on later runs.
 */
function ingestLimit(): number {
  const n = Number(process.env.DATASHEET_INGEST_LIMIT ?? 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

/**
 * Tier-2 ingestion pass: fetch datasheets from the URLs engineers put on the
 * design's symbols (Component.datasheetUrl, carried through netlist/BOM
 * parses). One attempt per distinct MPN, capped per run. Designed to be
 * called fire-and-forget after a parse — all failures are per-part statuses,
 * never throws.
 */
export async function ingestDesignLinkedDatasheets(
  projectId: string
): Promise<IngestResult[]> {
  // Downloading from datasheet URLs leaks MPNs to third-party sites; the
  // settings toggle turns all of it off (datasheets come from uploads only).
  if (!(await getSettings()).datasheetFetchEnabled) return [];

  const components = await prisma.component.findMany({
    where: {
      projectId,
      mpn: { not: null },
      datasheetUrl: { not: null },
    },
    select: { mpn: true, datasheetUrl: true },
  });

  // One candidate URL per distinct MPN.
  const byMpn = new Map<string, string>();
  for (const c of components) {
    if (c.mpn && c.datasheetUrl && !byMpn.has(c.mpn)) {
      byMpn.set(c.mpn, c.datasheetUrl);
    }
  }

  // Skip parts that already failed or were quarantined this way before —
  // retrying the same URL on every parse would spam the source.
  const attempted = await prisma.projectFile.findMany({
    where: { projectId, provenance: "design_link", mpn: { in: [...byMpn.keys()] } },
    select: { mpn: true },
  });
  for (const a of attempted) {
    if (a.mpn) byMpn.delete(a.mpn);
  }

  const results: IngestResult[] = [];
  let fetched = 0;
  const limit = ingestLimit();
  for (const [mpn, url] of byMpn) {
    if (fetched >= limit) break;
    const result = await ingestRemotePdf({
      projectId,
      mpn,
      url,
      provenance: "design_link",
    });
    if (result.status !== "skipped") fetched++;
    results.push(result);
  }
  return results;
}

/**
 * Tier-3 ingestion pass: for parts still without a document after tiers 1–2,
 * download the datasheet URL the spec-fetch web search already found
 * (MpnCache.datasheetUrl) and keep the whole document instead of just the
 * extracted numbers. The verification gate is the backstop against
 * wrong-document grabs. Fire-and-forget safe — never throws.
 */
export async function ingestWebFetchedDatasheets(
  projectId: string
): Promise<IngestResult[]> {
  if (!(await getSettings()).datasheetFetchEnabled) return [];

  const components = await prisma.component.findMany({
    where: { projectId, mpn: { not: null } },
    select: { mpn: true },
  });
  const mpns = [...new Set(components.map((c) => c.mpn).filter((m): m is string => !!m))];

  // Parts with any document already on file (verified or quarantined) are
  // done or awaiting review — don't re-fetch.
  const existing = await prisma.projectFile.findMany({
    where: { projectId, mpn: { in: mpns } },
    select: { mpn: true },
  });
  const covered = new Set(existing.map((f) => f.mpn));

  const results: IngestResult[] = [];
  let fetched = 0;
  const limit = ingestLimit();
  for (const mpn of mpns) {
    if (covered.has(mpn)) continue;
    if (fetched >= limit) break;

    const cache = await prisma.mpnCache.findUnique({ where: { mpn } });
    if (cache?.status !== "complete" || !cache.datasheetUrl) continue;

    const result = await ingestRemotePdf({
      projectId,
      mpn,
      url: cache.datasheetUrl,
      provenance: "web_fetch",
    });
    if (result.status !== "skipped") fetched++;
    results.push(result);
  }
  return results;
}

/**
 * One-click human approval of a quarantined document: the human vouches for
 * it, so it becomes verified and searchable. Supersedes lower-tier docs for
 * the same part.
 */
export async function approveQuarantinedFile(fileId: string): Promise<{ chunkCount: number }> {
  const file = await prisma.projectFile.findUnique({ where: { id: fileId } });
  if (!file) throw new IngestError("File not found");
  if (file.verifyStatus !== "quarantined") {
    throw new IngestError("File is not quarantined");
  }
  if (file.category !== "pdf" && file.category !== "document") {
    throw new IngestError("Only documents can be approved for search");
  }

  if (file.mpn) {
    // Human approval outranks any automated tier for this part.
    await supersedeLowerTiers(file.projectId, file.mpn, TIER.upload);
    if (file.contentHash) {
      await prisma.datasheetLibrary.upsert({
        where: { contentHash: file.contentHash },
        update: {},
        create: {
          mpn: file.mpn,
          contentHash: file.contentHash,
          filePath: file.path,
          sourceUrl: file.sourceUrl,
        },
      });
    }
  }

  const result = await indexDocumentFile(
    file.projectId,
    file.id,
    resolveStoredPath(file.path),
    file.category as "pdf" | "document"
  );
  await prisma.projectFile.update({
    where: { id: fileId },
    data: { verifyStatus: "verified", parseStatus: "parsed", parseError: null },
  });
  return result;
}
