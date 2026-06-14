import Link from "next/link";

export default function ProjectNotFound() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-12 text-center">
      <h1 className="text-lg font-semibold text-slate-900">
        Project not found
      </h1>
      <p className="mt-1 text-sm text-slate-600">
        This project doesn&apos;t exist or may have been deleted.
      </p>
      <Link
        href="/projects"
        className="mt-4 inline-block rounded-md bg-brand px-4 py-2 text-sm font-medium text-[#F5F0E8] hover:bg-brand-dark"
      >
        Back to projects
      </Link>
    </div>
  );
}
