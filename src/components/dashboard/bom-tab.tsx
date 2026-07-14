import { EmptyState } from "@/components/ui/empty-state";

import type { BomItemVM } from "./view-models";

export function BomTab({ bomItems }: { bomItems: BomItemVM[] }) {
  if (bomItems.length === 0) {
    return (
      <EmptyState
        title="No BOM items yet"
        hint="Upload a .csv or .xlsx BOM file to populate this table."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(var(--overlay-rgb),0.03)]">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(var(--overlay-rgb),0.03)] text-xs uppercase tracking-wide text-[var(--fg-subtle)]">
          <tr>
            <th className="px-4 py-2.5 font-medium">RefDes</th>
            <th className="px-4 py-2.5 font-medium">Description</th>
            <th className="px-4 py-2.5 font-medium">Manufacturer</th>
            <th className="px-4 py-2.5 font-medium">MPN</th>
            <th className="px-4 py-2.5 font-medium">Qty</th>
            <th className="px-4 py-2.5 font-medium">Matched</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[rgba(var(--overlay-rgb),0.06)]">
          {bomItems.map((item) => (
            <tr key={item.id} className="transition hover:bg-[rgba(var(--overlay-rgb),0.03)]">
              <td className="px-4 py-2.5 font-mono text-[var(--fg)]">
                {item.refDesRaw ?? "—"}
              </td>
              <td className="px-4 py-2.5 text-[var(--fg-muted)]">{item.description ?? "—"}</td>
              <td className="px-4 py-2.5 text-[var(--fg-muted)]">{item.manufacturer ?? "—"}</td>
              <td className="px-4 py-2.5 font-mono text-[var(--fg-muted)]">{item.mpn ?? "—"}</td>
              <td className="px-4 py-2.5 text-[var(--fg-muted)]">{item.quantity}</td>
              <td className="px-4 py-2.5 text-[var(--fg-muted)]">
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
