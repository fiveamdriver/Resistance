"use client";

import { useMemo, useState } from "react";

import {
  SEVERITY_LABEL,
  SEVERITY_RANK,
  type Severity,
} from "@/lib/review-types";

import type { DashboardVM } from "./view-models";

/** Normalized finding shape rendered by this tab (from DB or a fresh run). */
interface ViewFinding {
  block: string;
  severity: Severity;
  title: string;
  rationale: string;
  refDes: string[];
  hwReviewRequired: boolean;
}

interface ReviewState {
  summary: string | null;
  findings: ViewFinding[];
  ranAt: string | null; // ISO; null until a run exists
}

// Severity → badge classes (dark theme).
const SEVERITY_STYLE: Record<Severity, string> = {
  possible_bug: "border-red-500/30 bg-red-500/10 text-red-300",
  verify: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  watch: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  minor: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  cosmetic: "border-slate-500/30 bg-slate-500/10 text-slate-400",
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
};

export function ReportsTab({ vm }: { vm: DashboardVM }) {
  const [review, setReview] = useState<ReviewState>(() => ({
    summary: vm.latestReview?.summary ?? null,
    findings: vm.latestReview?.findings ?? [],
    ranAt: vm.latestReview?.createdAt ?? null,
  }));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stats = [
    { label: "Files", value: vm.files.length },
    { label: "Components", value: vm.components.length },
    { label: "Nets", value: vm.nets.length },
    { label: "BOM items", value: vm.bomItems.length },
    {
      label: "Findings",
      value: review.ranAt ? review.findings.length : "—",
    },
  ];

  const hasParsedData = vm.components.length > 0 || vm.nets.length > 0;

  async function runReview() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${vm.project.id}/review`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Review failed");
      setReview({
        summary: data.summary ?? null,
        findings: (data.findings ?? []) as ViewFinding[],
        ranAt: new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setRunning(false);
    }
  }

  // Group findings by block; blocks ordered by their most severe finding.
  const grouped = useMemo(() => {
    const byBlock = new Map<string, ViewFinding[]>();
    for (const f of review.findings) {
      const list = byBlock.get(f.block) ?? [];
      list.push(f);
      byBlock.set(f.block, list);
    }
    return Array.from(byBlock.entries())
      .map(([block, list]) => ({
        block,
        findings: [...list].sort(
          (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
        ),
        topRank: Math.min(...list.map((f) => SEVERITY_RANK[f.severity])),
      }))
      .sort((a, b) => a.topRank - b.topRank);
  }, [review.findings]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4 text-center"
          >
            <div className="text-2xl font-bold text-[#F5F0E8]">{s.value}</div>
            <div className="text-xs uppercase tracking-wide text-[#4a5568]">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4">
        <div>
          <p className="font-medium text-[#F5F0E8]">AI Design Review</p>
          <p className="mt-0.5 text-sm text-[#94a3b8]">
            Discovers functional blocks, verifies passive values, and flags
            action items from your parsed netlist and BOM.
          </p>
          {review.ranAt && (
            <p className="mt-1 text-xs text-[#4a5568]">
              Last run {new Date(review.ranAt).toLocaleString()}
            </p>
          )}
        </div>
        <button
          onClick={runReview}
          disabled={running || !hasParsedData}
          className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black transition-all hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running
            ? "Analyzing…"
            : review.ranAt
              ? "Re-run review"
              : "Run design review"}
        </button>
      </div>

      {!hasParsedData && (
        <p className="text-sm text-[#94a3b8]">
          Upload and parse a netlist or BOM first — the review runs on parsed
          board data.
        </p>
      )}

      {running && (
        <div className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-6 text-center text-sm text-[#94a3b8]">
          Analyzing the board… this can take up to a minute as the reviewer
          inspects nets, components, and passive values.
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          {error}
        </div>
      )}

      {/* Results */}
      {!running && review.ranAt && (
        <div className="space-y-4">
          {review.summary && (
            <div className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4 text-sm text-[#cbd5e1]">
              {review.summary}
            </div>
          )}

          {review.findings.length === 0 ? (
            <p className="text-sm text-[#94a3b8]">
              No findings were raised. (Severity scale: Possible bug · Verify ·
              Watch · Minor · Cosmetic · OK.)
            </p>
          ) : (
            grouped.map((group) => (
              <div key={group.block} className="space-y-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-[#94a3b8]">
                  {group.block}
                </h3>
                <ul className="space-y-2">
                  {group.findings.map((f, i) => (
                    <li
                      key={`${group.block}-${i}`}
                      className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLE[f.severity]}`}
                        >
                          {SEVERITY_LABEL[f.severity]}
                        </span>
                        {f.hwReviewRequired && (
                          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300">
                            HW review
                          </span>
                        )}
                        <span className="font-medium text-[#F5F0E8]">
                          {f.title}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-[#cbd5e1]">
                        {f.rationale}
                      </p>
                      {f.refDes.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {f.refDes.map((r) => (
                            <span
                              key={r}
                              className="rounded border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-1.5 py-0.5 font-mono text-xs text-[#94a3b8]"
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
