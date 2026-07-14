import Link from "next/link";

export default function ProjectNotFound() {
  return (
    <div className="rounded-lg border border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(var(--overlay-rgb),0.03)] p-12 text-center">
      <h1 className="text-lg font-semibold text-[var(--fg)]">
        Project not found
      </h1>
      <p className="mt-1 text-sm text-[var(--fg-muted)]">
        This project doesn&apos;t exist or may have been deleted.
      </p>
      <Link
        href="/projects"
        className="mt-4 inline-block rounded-md bg-[var(--accent-bg)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] hover:bg-[var(--accent-bg-hover)]"
      >
        Back to projects
      </Link>
    </div>
  );
}
