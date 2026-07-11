/**
 * Serializable view-models passed from the dashboard server component to the
 * client tab components. Keeping these plain (no Prisma types, no Decimal/Date
 * surprises) makes the client/server boundary explicit and the components easy
 * to test and reason about.
 */
import { isSeverity, type Severity } from "@/lib/review-types";
import type { ConnectivityGraph } from "@/types/connectivity";

export interface FileVM {
  id: string;
  originalName: string;
  category: string;
  fileType: string;
  parseStatus: "pending" | "parsed" | "failed";
  /** "upload" | "design_link" | "web_fetch" — how the document arrived. */
  provenance: string;
  /** "verified" | "quarantined" | "superseded" — gate outcome / lifecycle. */
  verifyStatus: string;
  /** MPN the document describes (auto-ingested datasheets). */
  mpn: string | null;
  sizeBytes: number;
  uploadedAt: string; // ISO string
}

export interface ComponentVM {
  id: string;
  refDes: string;
  name: string | null;
  value: string | null;
  footprint: string | null;
  pinCount: number;
  bomCount: number;
}

export interface NetVM {
  id: string;
  name: string;
  connectionCount: number;
}

export interface BomItemVM {
  id: string;
  refDesRaw: string | null;
  description: string | null;
  manufacturer: string | null;
  mpn: string | null;
  value: string | null;
  quantity: number;
  componentRefs: string[];
}

export interface FindingVM {
  id: string;
  block: string;
  severity: Severity;
  title: string;
  rationale: string;
  refDes: string[];
  hwReviewRequired: boolean;
}

export interface ReviewRunVM {
  id: string;
  status: string;
  model: string;
  summary: string | null;
  /** Failure message when status is "failed", else null. */
  error: string | null;
  createdAt: string; // ISO string
  findings: FindingVM[];
}

/**
 * Map a persisted review run (Prisma shape, structurally typed) to its VM.
 * Shared by the dashboard server component and the review status endpoint so
 * both surfaces render the identical shape.
 */
export function toReviewRunVM(run: {
  id: string;
  status: string;
  model: string;
  summary: string | null;
  error: string | null;
  createdAt: Date;
  findings: {
    id: string;
    block: string;
    severity: string;
    title: string;
    rationale: string;
    refDes: string | null;
    hwReviewRequired: boolean;
  }[];
}): ReviewRunVM {
  return {
    id: run.id,
    status: run.status,
    model: run.model,
    summary: run.summary,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
    findings: run.findings.map((f) => ({
      id: f.id,
      block: f.block,
      // Stored as a validated string; fall back to "verify" if ever unexpected.
      severity: isSeverity(f.severity) ? f.severity : "verify",
      title: f.title,
      rationale: f.rationale,
      refDes: f.refDes
        ? f.refDes
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      hwReviewRequired: f.hwReviewRequired,
    })),
  };
}

export interface DashboardVM {
  project: { id: string; name: string; description: string | null };
  files: FileVM[];
  components: ComponentVM[];
  nets: NetVM[];
  bomItems: BomItemVM[];
  graph: ConnectivityGraph;
  documentChunkCount: number;
  /**
   * Datasheet coverage: how many of the project's distinct MPNs have a
   * verified datasheet on file. Null when the design has no MPNs.
   */
  datasheetCoverage: { covered: number; total: number } | null;
  /** Most recent design-review run, or null if none has been run yet. */
  latestReview: ReviewRunVM | null;
  /**
   * Last push from the KiCad MCP server (parsed from Project.syncMeta), or
   * null if this project has never been synced from KiCad.
   */
  kicadSync: {
    syncedAt: string; // ISO string
    boardMtime: string | null; // ISO string
    kicadVersion: string | null;
    /** Absolute path of the synced .kicad_pro — the "Open in KiCad" target. */
    kicadProjectFile: string | null;
  } | null;
  /** Linked KiCad project folder (desktop Phase 4). */
  kicadFolder: {
    path: string | null;
    autoSyncEnabled: boolean;
  };
}
