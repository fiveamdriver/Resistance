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
      <span className="inline-block rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
        Quarantined
      </span>
    );
  }
  if (file.verifyStatus === "superseded") {
    return (
      <span className="inline-block rounded-full border border-[rgba(255,255,255,0.12)] px-2 py-0.5 text-xs text-[#4a5568]">
        Superseded
      </span>
    );
  }
  return (
    <span className="inline-block rounded-full border border-[rgba(255,255,255,0.12)] px-2 py-0.5 text-xs text-[#94a3b8]">
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

export function FilesTable({
  projectId,
  files,
}: {
  projectId: string;
  files: FileVM[];
}) {
  if (files.length === 0) {
    return (
      <EmptyState
        title="No files uploaded yet"
        hint="Upload a netlist, BOM, datasheet, or requirements doc to get started."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] text-xs uppercase tracking-wide text-[#4a5568]">
          <tr>
            <th className="px-4 py-2.5 font-medium">File</th>
            <th className="px-4 py-2.5 font-medium">Category</th>
            <th className="px-4 py-2.5 font-medium">Source</th>
            <th className="px-4 py-2.5 font-medium">Size</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 font-medium">Uploaded</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[rgba(255,255,255,0.05)]">
          {files.map((file) => (
            <tr key={file.id} className="transition hover:bg-[rgba(255,255,255,0.03)]">
              <td className="px-4 py-2.5 font-medium text-[#F5F0E8]">
                {file.originalName}
                {file.mpn && (
                  <span className="ml-2 text-xs text-[#4a5568]">{file.mpn}</span>
                )}
              </td>
              <td className="px-4 py-2.5 capitalize text-[#94a3b8]">
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
              <td className="px-4 py-2.5 text-[#94a3b8]">
                {formatBytes(file.sizeBytes)}
              </td>
              <td className="px-4 py-2.5">
                <ParseStatusBadge status={file.parseStatus} />
              </td>
              <td className="px-4 py-2.5 text-[#4a5568]">
                {formatDate(file.uploadedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
