"use client";

/**
 * Project deletion with an inline two-step confirm (no browser dialogs —
 * they block the desktop shell's event loop). First click arms it; the
 * second click within the armed state deletes and returns to the list.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  projectId: string;
  projectName: string;
}

export function DeleteProjectButton({ projectId, projectName }: Props) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Delete failed (${res.status})`);
      }
      router.push("/projects");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setBusy(false);
      setArmed(false);
    }
  }

  if (!armed) {
    return (
      <div className="text-right">
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="text-xs text-[#4a5568] underline-offset-2 hover:text-red-400 hover:underline"
        >
          Delete project…
        </button>
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5">
      <span className="text-xs text-red-400">
        Delete &ldquo;{projectName}&rdquo; and all its data?
      </span>
      <button
        type="button"
        onClick={() => void doDelete()}
        disabled={busy}
        className="rounded bg-red-500/80 px-2 py-1 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
      >
        {busy ? "Deleting…" : "Delete"}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        disabled={busy}
        className="text-xs text-[#94a3b8] hover:text-[#F5F0E8]"
      >
        Cancel
      </button>
    </div>
  );
}
