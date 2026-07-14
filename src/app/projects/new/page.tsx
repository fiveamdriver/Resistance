import Link from "next/link";

import { NewProjectForm } from "@/components/projects/new-project-form";

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8 pt-6">
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <Link
            href="/projects"
            className="text-sm text-[var(--fg-subtle)] transition-colors hover:text-[var(--fg)]"
          >
            ← Back to projects
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-[var(--fg)]">New project</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            Create a workspace, then upload your netlists, BOMs, datasheets, and
            requirements.
          </p>
        </div>

        <div className="rounded-lg border border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(var(--overlay-rgb),0.03)] p-6">
          <NewProjectForm />
        </div>
      </div>
    </div>
  );
}
