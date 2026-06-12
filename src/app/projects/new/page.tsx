import Link from "next/link";

import { NewProjectForm } from "@/components/projects/new-project-form";

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link
          href="/projects"
          className="text-sm text-slate-500 hover:text-brand"
        >
          ← Back to projects
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">New project</h1>
        <p className="mt-1 text-sm text-slate-600">
          Create a workspace, then upload your netlists, BOMs, datasheets, and
          requirements.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <NewProjectForm />
      </div>
    </div>
  );
}
