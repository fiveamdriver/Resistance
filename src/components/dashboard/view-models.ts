/**
 * Serializable view-models passed from the dashboard server component to the
 * client tab components. Keeping these plain (no Prisma types, no Decimal/Date
 * surprises) makes the client/server boundary explicit and the components easy
 * to test and reason about.
 */
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

export interface DashboardVM {
  project: { id: string; name: string; description: string | null };
  files: FileVM[];
  components: ComponentVM[];
  nets: NetVM[];
  bomItems: BomItemVM[];
  graph: ConnectivityGraph;
  documentChunkCount: number;
}
