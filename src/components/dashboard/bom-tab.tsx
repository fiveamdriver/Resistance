import { EmptyState } from "@/components/ui/empty-state";

import type { BomItemVM } from "./view-models";

export function BomTab({ bomItems }: { bomItems: BomItemVM[] }) {
  if (bomItems.length === 0) {
    return (
      <EmptyState
        title="No BOM items yet"
        hint="Upload a .csv or .xlsx BOM; rows appear here once parsed (Phase 2)."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2.5 font-medium">RefDes</th>
            <th className="px-4 py-2.5 font-medium">Description</th>
            <th className="px-4 py-2.5 font-medium">Manufacturer</th>
            <th className="px-4 py-2.5 font-medium">MPN</th>
            <th className="px-4 py-2.5 font-medium">Qty</th>
            <th className="px-4 py-2.5 font-medium">Matched</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {bomItems.map((item) => (
            <tr key={item.id} className="hover:bg-slate-50">
              <td className="px-4 py-2.5 font-mono text-slate-800">
                {item.refDesRaw ?? "—"}
              </td>
              <td className="px-4 py-2.5 text-slate-600">
                {item.description ?? "—"}
              </td>
              <td className="px-4 py-2.5 text-slate-600">
                {item.manufacturer ?? "—"}
              </td>
              <td className="px-4 py-2.5 font-mono text-slate-600">
                {item.mpn ?? "—"}
              </td>
              <td className="px-4 py-2.5 text-slate-600">{item.quantity}</td>
              <td className="px-4 py-2.5 text-slate-600">
                {item.componentRefs.length > 0
                  ? item.componentRefs.join(", ")
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
