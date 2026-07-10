import Link from "next/link";
import { notFound } from "next/navigation";

import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";
import { DeleteProjectButton } from "@/components/dashboard/delete-project-button";
import { KicadFolderCard } from "@/components/dashboard/kicad-folder-card";
import type {
  DashboardVM,
  FileVM,
  ReviewRunVM,
} from "@/components/dashboard/view-models";
import { NotFoundError } from "@/lib/errors";
import type { ParseStatus } from "@/lib/fileTypes";
import { isSeverity } from "@/lib/review-types";
import { getConnectivityGraph } from "@/server/services/connectivity-service";
import {
  getProjectDashboard,
  type ProjectDashboard,
} from "@/server/services/project-service";

export const dynamic = "force-dynamic";

/** Map persisted project data into the serializable dashboard view-model. */
function toViewModel(
  project: ProjectDashboard,
  graph: DashboardVM["graph"]
): DashboardVM {
  const files: FileVM[] = project.files.map((f) => ({
    id: f.id,
    originalName: f.originalName,
    category: f.category,
    fileType: f.fileType,
    parseStatus: f.parseStatus as ParseStatus,
    provenance: f.provenance,
    verifyStatus: f.verifyStatus,
    mpn: f.mpn,
    sizeBytes: f.sizeBytes,
    uploadedAt: f.uploadedAt.toISOString(),
  }));

  // Datasheet coverage: distinct component MPNs vs. those with a verified
  // datasheet on file (auto-ingested docs carry their MPN).
  const designMpns = new Set(
    project.components.map((c) => c.mpn).filter((m): m is string => !!m)
  );
  const coveredMpns = new Set(
    project.files
      .filter((f) => f.verifyStatus === "verified" && f.mpn && designMpns.has(f.mpn))
      .map((f) => f.mpn as string)
  );
  const datasheetCoverage =
    designMpns.size > 0
      ? { covered: coveredMpns.size, total: designMpns.size }
      : null;

  // syncMeta is a JSON string stamped by the KiCad MCP server; treat malformed
  // or legacy content as "never synced" rather than failing the page.
  let kicadSync: DashboardVM["kicadSync"] = null;
  if (project.syncMeta) {
    try {
      const meta: unknown = JSON.parse(project.syncMeta);
      if (
        meta !== null &&
        typeof meta === "object" &&
        "syncedAt" in meta &&
        typeof meta.syncedAt === "string"
      ) {
        const m = meta as {
          syncedAt: string;
          boardMtime?: unknown;
          kicadVersion?: unknown;
          kicadProjectFile?: unknown;
        };
        kicadSync = {
          syncedAt: m.syncedAt,
          boardMtime: typeof m.boardMtime === "string" ? m.boardMtime : null,
          kicadVersion: typeof m.kicadVersion === "string" ? m.kicadVersion : null,
          kicadProjectFile:
            typeof m.kicadProjectFile === "string" ? m.kicadProjectFile : null,
        };
      }
    } catch {
      // ignore malformed syncMeta
    }
  }

  const run = project.reviewRuns[0];
  const latestReview: ReviewRunVM | null = run
    ? {
        id: run.id,
        status: run.status,
        model: run.model,
        summary: run.summary,
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
      }
    : null;

  return {
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
    },
    files,
    components: project.components.map((c) => ({
      id: c.id,
      refDes: c.refDes,
      name: c.name,
      value: c.value,
      footprint: c.footprint,
      pinCount: c.pins.length,
      bomCount: c.bomItems.length,
    })),
    nets: project.nets.map((n) => ({
      id: n.id,
      name: n.name,
      connectionCount: n._count.connections,
    })),
    bomItems: project.bomItems.map((b) => ({
      id: b.id,
      refDesRaw: b.refDesRaw,
      description: b.description,
      manufacturer: b.manufacturer,
      mpn: b.mpn,
      value: b.value,
      quantity: b.quantity,
      componentRefs: b.components.map((c) => c.refDes),
    })),
    graph,
    documentChunkCount: project._count.documentChunks,
    datasheetCoverage,
    latestReview,
    kicadSync,
    kicadFolder: {
      path: project.kicadProjectPath,
      autoSyncEnabled: project.autoSyncEnabled,
    },
  };
}

export default async function ProjectDashboardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  let vm: DashboardVM;
  try {
    const [project, graph] = await Promise.all([
      getProjectDashboard(projectId),
      getConnectivityGraph(projectId),
    ]);
    vm = toViewModel(project, graph);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 pt-6">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link
              href="/projects"
              className="text-sm text-[#4a5568] transition-colors hover:text-[#F5F0E8]"
            >
              ← All projects
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-[#F5F0E8]">
              {vm.project.name}
            </h1>
            {vm.project.description && (
              <p className="mt-1 text-sm text-[#94a3b8]">
                {vm.project.description}
              </p>
            )}
          </div>
          <div className="pt-6">
            <DeleteProjectButton
              projectId={vm.project.id}
              projectName={vm.project.name}
            />
          </div>
        </div>

        <KicadFolderCard
          projectId={vm.project.id}
          folder={vm.kicadFolder}
          kicadSync={vm.kicadSync}
        />

        <DashboardTabs vm={vm} />
      </div>
    </div>
  );
}
