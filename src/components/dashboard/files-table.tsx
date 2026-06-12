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
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2.5 font-medium">File</th>
            <th className="px-4 py-2.5 font-medium">Category</th>
            <th className="px-4 py-2.5 font-medium">Size</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 font-medium">Uploaded</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {files.map((file) => (
            <tr key={file.id} className="hover:bg-slate-50">
              <td className="px-4 py-2.5 font-medium text-slate-800">
                {file.originalName}
              </td>
              <td className="px-4 py-2.5 capitalize text-slate-600">
                {file.category}
              </td>
              <td className="px-4 py-2.5 text-slate-600">
                {formatBytes(file.sizeBytes)}
              </td>
              <td className="px-4 py-2.5">
                <ParseStatusBadge status={file.parseStatus} />
              </td>
              <td className="px-4 py-2.5 text-slate-500">
                {formatDate(file.uploadedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
