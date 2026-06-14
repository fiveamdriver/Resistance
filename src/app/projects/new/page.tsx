import Link from "next/link";

import { NewProjectForm } from "@/components/projects/new-project-form";

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8 pt-24">
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <Link
            href="/projects"
            className="text-sm text-[#4a5568] transition-colors hover:text-[#F5F0E8]"
          >
            ← Back to projects
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-[#F5F0E8]">New project</h1>
          <p className="mt-1 text-sm text-[#94a3b8]">
            Create a workspace, then upload your netlists, BOMs, datasheets, and
            requirements.
          </p>
        </div>

        <div className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-6">
          <NewProjectForm />
        </div>
      </div>
    </div>
  );
}
