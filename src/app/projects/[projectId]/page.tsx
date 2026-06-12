import Link from "next/link";
import { notFound } from "next/navigation";

import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";
import type { DashboardVM, FileVM } from "@/components/dashboard/view-models";
import { NotFoundError } from "@/lib/errors";
import type { ParseStatus } from "@/lib/fileTypes";
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
    sizeBytes: f.sizeBytes,
    uploadedAt: f.uploadedAt.toISOString(),
  }));

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
    <div className="mx-auto max-w-6xl px-6 py-8">
    <div className="space-y-6">
      <div>
        <Link
          href="/projects"
          className="text-sm text-slate-500 hover:text-brand"
        >
          ← All projects
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">
          {vm.project.name}
        </h1>
        {vm.project.description && (
          <p className="mt-1 text-sm text-slate-600">
            {vm.project.description}
          </p>
        )}
      </div>

      <DashboardTabs vm={vm} />
    </div>
    </div>
  );
}
