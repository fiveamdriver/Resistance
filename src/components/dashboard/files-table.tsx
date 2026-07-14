"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { EmptyState } from "@/components/ui/empty-state";
import { ParseStatusBadge } from "@/components/ui/parse-status-badge";
import { formatBytes, formatDate } from "@/lib/format";

import type { FileVM } from "./view-models";

const PROVENANCE_LABEL: Record<string, string> = {
  upload: "Uploaded",
  kicad_sync: "Synced from KiCad",
  project_folder: "From project folder",
  design_link: "Linked",
  web_fetch: "Found online",
};

function SourceBadge({ file }: { file: FileVM }) {
  if (file.verifyStatus === "quarantined") {
    return (
      <span className="inline-block rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">
        Quarantined
      </span>
    );
  }
  if (file.verifyStatus === "superseded") {
    return (
      <span className="inline-block rounded-full border border-[rgba(var(--overlay-rgb),0.12)] px-2 py-0.5 text-xs text-[var(--fg-subtle)]">
        Superseded
      </span>
    );
  }
  return (
    <span className="inline-block rounded-full border border-[rgba(var(--overlay-rgb),0.12)] px-2 py-0.5 text-xs text-[var(--fg-muted)]">
      {PROVENANCE_LABEL[file.provenance] ?? file.provenance}
    </span>
  );
}

function ApproveButton({
  projectId,
  fileId,
}: {
  projectId: string;
  fileId: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  async function approve() {
    setState("busy");
    try {
      const res = await fetch(
        `/api/projects/${projectId}/files/${fileId}/approve`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <button
      onClick={approve}
      disabled={state === "busy"}
      className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400 transition hover:bg-emerald-500/20 disabled:opacity-50"
      title="Mark this document as the correct datasheet and make it searchable"
    >
      {state === "busy" ? "Approving…" : state === "error" ? "Retry approve" : "Approve"}
    </button>
  );
}

function FileRows({ projectId, files }: { projectId: string; files: FileVM[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(var(--overlay-rgb),0.03)]">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(var(--overlay-rgb),0.03)] text-xs uppercase tracking-wide text-[var(--fg-subtle)]">
          <tr>
            <th className="px-4 py-2.5 font-medium">File</th>
            <th className="px-4 py-2.5 font-medium">Category</th>
            <th className="px-4 py-2.5 font-medium">Source</th>
            <th className="px-4 py-2.5 font-medium">Size</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 font-medium">Uploaded</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[rgba(var(--overlay-rgb),0.05)]">
          {files.map((file) => (
            <tr key={file.id} className="transition hover:bg-[rgba(var(--overlay-rgb),0.03)]">
              <td className="px-4 py-2.5 font-medium text-[var(--fg)]">
                {file.originalName}
                {file.mpn && (
                  <span className="ml-2 text-xs text-[var(--fg-subtle)]">{file.mpn}</span>
                )}
              </td>
              <td className="px-4 py-2.5 capitalize text-[var(--fg-muted)]">
                {file.category}
              </td>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <SourceBadge file={file} />
                  {file.verifyStatus === "quarantined" && (
                    <ApproveButton projectId={projectId} fileId={file.id} />
                  )}
                </div>
              </td>
              <td className="px-4 py-2.5 text-[var(--fg-muted)]">
                {formatBytes(file.sizeBytes)}
              </td>
              <td className="px-4 py-2.5">
                <ParseStatusBadge status={file.parseStatus} />
              </td>
              <td className="px-4 py-2.5 text-[var(--fg-subtle)]">
                {formatDate(file.uploadedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FilesTable({
  projectId,
  files,
  kicadSync,
}: {
  projectId: string;
  files: FileVM[];
  kicadSync: { syncedAt: string; boardMtime: string | null; kicadVersion: string | null } | null;
}) {
  if (files.length === 0) {
    return (
      <EmptyState
        title="No files uploaded yet"
        hint="Upload a netlist, BOM, datasheet, or requirements doc to get started."
      />
    );
  }

  // Sync artifacts are machine-managed (replaced on every sync) — their own
  // box keeps them from blending into the documents the engineer curates.
  const syncFiles = files.filter((f) => f.provenance === "kicad_sync");
  const docFiles = files.filter((f) => f.provenance !== "kicad_sync");

  return (
    <div className="space-y-5">
      {syncFiles.length > 0 && (
        <section>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
              Design sync
            </h3>
            {kicadSync && (
              <p className="text-xs text-[var(--fg-muted)]">
                Synced{kicadSync.kicadVersion && ` from KiCad ${kicadSync.kicadVersion}`}{" "}
                <span className="font-medium text-[var(--fg)]">
                  {formatDate(kicadSync.syncedAt)}
                </span>
                {kicadSync.boardMtime && (
                  <>
                    {" "}
                    · design last modified{" "}
                    <span className="font-medium text-[var(--fg)]">
                      {formatDate(kicadSync.boardMtime)}
                    </span>
                  </>
                )}
              </p>
            )}
          </div>
          <FileRows projectId={projectId} files={syncFiles} />
        </section>
      )}

      {docFiles.length > 0 && (
        <section>
          {syncFiles.length > 0 && (
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
              Documents &amp; datasheets
            </h3>
          )}
          <FileRows projectId={projectId} files={docFiles} />
        </section>
      )}
    </div>
  );
}
