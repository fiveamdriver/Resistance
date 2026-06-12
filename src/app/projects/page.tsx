import Link from "next/link";

import { listProjects } from "@/server/services/project-service";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = await listProjects();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Projects</h1>
        <Link
          href="/projects/new"
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
        >
          + New Project
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-slate-600">No projects yet.</p>
          <Link
            href="/projects/new"
            className="mt-3 inline-block rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
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
                className="block rounded-lg border border-slate-200 bg-white p-5 transition hover:border-brand hover:shadow-sm"
              >
                <h2 className="font-semibold text-slate-900">{p.name}</h2>
                {p.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                    {p.description}
                  </p>
                )}
                <p className="mt-3 text-xs text-slate-400">
                  {p._count.files} files · {p._count.components} components ·
                  created {p.createdAt.toLocaleDateString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
