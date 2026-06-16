/**
 * Serializable view-models passed from the dashboard server component to the
 * client tab components. Keeping these plain (no Prisma types, no Decimal/Date
 * surprises) makes the client/server boundary explicit and the components easy
 * to test and reason about.
 */
import type { Severity } from "@/lib/review-types";
import type { ConnectivityGraph } from "@/types/connectivity";

export interface FileVM {
  id: string;
  originalName: string;
  category: string;
  fileType: string;
  parseStatus: "pending" | "parsed" | "failed";
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
  createdAt: string; // ISO string
  findings: FindingVM[];
}

export interface DashboardVM {
  project: { id: string; name: string; description: string | null };
  files: FileVM[];
  components: ComponentVM[];
  nets: NetVM[];
  bomItems: BomItemVM[];
  graph: ConnectivityGraph;
  documentChunkCount: number;
  /** Most recent design-review run, or null if none has been run yet. */
  latestReview: ReviewRunVM | null;
}
