import { EmptyState } from "@/components/ui/empty-state";
import { ParseStatusBadge } from "@/components/ui/parse-status-badge";
import { formatBytes, formatDate } from "@/lib/format";

import type { FileVM } from "./view-models";

export function FilesTable({ files }: { files: FileVM[] }) {
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
              </td>
              <td className="px-4 py-2.5 capitalize text-[#94a3b8]">
                {file.category}
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
