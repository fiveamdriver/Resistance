import Link from "next/link";

import { listProjects } from "@/server/services/project-service";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = await listProjects();

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 pt-6">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[#F5F0E8]">Projects</h1>
          <Link
            href="/projects/new"
            className="rounded-md bg-[#F5F0E8] px-4 py-2 text-sm font-semibold text-black transition-all hover:bg-[#F5F0E8]/90"
          >
            + New Project
          </Link>
        </div>

        {projects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)] p-12 text-center">
            <p className="text-[#94a3b8]">No projects yet.</p>
            <Link
              href="/projects/new"
              className="mt-3 inline-block rounded-md bg-[#F5F0E8] px-4 py-2 text-sm font-semibold text-black transition-all hover:bg-[#F5F0E8]/90"
            >
              Create your first project
            </Link>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="block rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-5 transition hover:border-[rgba(255,255,255,0.25)] hover:bg-[rgba(255,255,255,0.05)]"
                >
                  <h2 className="font-semibold text-[#F5F0E8]">{p.name}</h2>
                  {p.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-[#94a3b8]">
                      {p.description}
                    </p>
                  )}
                  <p className="mt-3 text-xs text-[#4a5568]">
                    {p._count.files} files · {p._count.components} components ·
                    created {p.createdAt.toLocaleDateString()}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
