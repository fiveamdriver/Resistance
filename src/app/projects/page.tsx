import Link from "next/link";

import { listProjects } from "@/server/services/project-service";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = await listProjects();

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 pt-6">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--fg)]">Projects</h1>
          <Link
            href="/projects/new"
            className="rounded-md bg-[var(--accent-bg)] px-4 py-2 text-sm font-semibold text-[var(--accent-fg)] transition-all hover:bg-[var(--accent-bg-hover)]"
          >
            + New Project
          </Link>
        </div>

        {projects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[rgba(var(--overlay-rgb),0.1)] bg-[rgba(var(--overlay-rgb),0.02)] p-12 text-center">
            <p className="text-[var(--fg-muted)]">No projects yet.</p>
            <Link
              href="/projects/new"
              className="mt-3 inline-block rounded-md bg-[var(--accent-bg)] px-4 py-2 text-sm font-semibold text-[var(--accent-fg)] transition-all hover:bg-[var(--accent-bg-hover)]"
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
                  className="block rounded-lg border border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(var(--overlay-rgb),0.03)] p-5 transition hover:border-[rgba(var(--overlay-rgb),0.25)] hover:bg-[rgba(var(--overlay-rgb),0.05)]"
                >
                  <h2 className="font-semibold text-[var(--fg)]">{p.name}</h2>
                  {p.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-[var(--fg-muted)]">
                      {p.description}
                    </p>
                  )}
                  <p className="mt-3 text-xs text-[var(--fg-subtle)]">
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
