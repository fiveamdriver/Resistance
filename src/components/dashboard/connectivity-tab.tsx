"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import {
  componentsForNet,
  netsForComponent,
  type ConnectivityGraph,
} from "@/types/connectivity";

type Mode = "component" | "net";

export function ConnectivityTab({ graph }: { graph: ConnectivityGraph }) {
  const [mode, setMode] = useState<Mode>("component");
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    return mode === "component"
      ? netsForComponent(graph, q)
      : componentsForNet(graph, q);
  }, [graph, mode, query]);

  const isEmpty = graph.connections.length === 0;

  if (isEmpty) {
    return (
      <EmptyState
        title="No connectivity data yet"
        hint="Parse a netlist (Phase 2) to explore what connects to what."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-[rgba(255,255,255,0.08)] p-0.5">
            {(["component", "net"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded px-3 py-1 text-sm font-medium capitalize transition-colors ${
                  mode === m
                    ? "bg-brand text-white"
                    : "text-[#94a3b8] hover:bg-[rgba(255,255,255,0.06)] hover:text-white"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              mode === "component"
                ? "Search RefDes, e.g. U7"
                : "Search net, e.g. 5V"
            }
            className="flex-1 rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-3 py-1.5 text-sm text-white placeholder:text-[#2a2a35] outline-none transition focus:border-[rgba(255,255,255,0.3)] focus:ring-1 focus:ring-[rgba(255,255,255,0.1)]"
          />
        </div>

        {results && (
          <div className="mt-4">
            {results.length === 0 ? (
              <p className="text-sm text-[#4a5568]">
                No {mode === "component" ? "nets" : "components"} found for
                &quot;{query}&quot;.
              </p>
            ) : (
              <div>
                <p className="text-xs uppercase tracking-wide text-[#4a5568]">
                  {mode === "component"
                    ? `Nets connected to ${query}`
                    : `Components on net ${query}`}
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {results.map((r) => (
                    <li
                      key={r}
                      className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3 py-1 font-mono text-sm text-[#94a3b8]"
                    >
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-dashed border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)] p-4 text-sm text-[#4a5568]">
        A visual node-link graph (components ↔ nets) will render here in a
        future phase using React Flow. The underlying graph data is already
        available via the connectivity service.
      </div>
    </div>
  );
}
