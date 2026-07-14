"use client";

import { useEffect, useMemo, useState } from "react";

import {
  SEVERITY_LABEL,
  SEVERITY_RANK,
  type Severity,
} from "@/lib/review-types";

import type { DashboardVM, ReviewRunVM } from "./view-models";

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

/** Mirror of the server's ReviewProgress (review-service.ts). */
interface ReviewProgress {
  round: number;
  maxRounds: number;
  phase: string;
  toolCalls: number;
  startedAt: number;
}

interface ReviewStatusPayload {
  status: "running" | "completed" | "failed" | "none";
  progress: ReviewProgress | null;
  run: ReviewRunVM | null;
}

/** Poll cadence while a review is in flight. */
const POLL_MS = 2000;

function formatElapsed(startedAt: number): string {
  const s = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// Severity → badge classes.
const SEVERITY_STYLE: Record<Severity, string> = {
  possible_bug: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  verify: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  watch: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  minor: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  cosmetic: "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-400",
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

export function ReportsTab({ vm }: { vm: DashboardVM }) {
  // A failed latest run must not render as "reviewed, zero findings".
  const lastCompleted =
    vm.latestReview?.status === "completed" ? vm.latestReview : null;
  const [review, setReview] = useState<ReviewState>(() => ({
    summary: lastCompleted?.summary ?? null,
    findings: lastCompleted?.findings ?? [],
    ranAt: lastCompleted?.createdAt ?? null,
  }));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ReviewProgress | null>(null);
  const [error, setError] = useState<string | null>(
    vm.latestReview?.status === "failed"
      ? (vm.latestReview.error ?? "The last review failed. Re-run it.")
      : null
  );

  function applyFinishedRun(run: ReviewRunVM) {
    if (run.status === "completed") {
      setReview({
        summary: run.summary,
        findings: run.findings,
        ranAt: run.createdAt,
      });
      setError(null);
    } else if (run.status === "failed") {
      setError(run.error ?? "Review failed. Re-run it.");
    }
  }

  // On mount, re-attach: the review runs server-side, so if the user switched
  // tabs mid-run (unmounting this component) the run kept going. Ask the
  // server whether one is in flight, or whether a newer result landed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${vm.project.id}/review`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as ReviewStatusPayload;
        if (cancelled) return;
        if (data.status === "running") {
          setProgress(data.progress);
          setRunning(true);
        } else if (data.run) {
          applyFinishedRun(data.run);
        }
      } catch {
        // Status check is best-effort; the tab still renders the page data.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vm.project.id]);

  // While running, poll for progress and pick up the result when it lands.
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/projects/${vm.project.id}/review`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as ReviewStatusPayload;
        if (cancelled) return;
        if (data.status === "running") {
          setProgress(data.progress);
        } else {
          if (data.run) applyFinishedRun(data.run);
          setProgress(null);
          setRunning(false);
        }
      } catch {
        // Transient poll failure — keep polling.
      }
    };
    const interval = setInterval(tick, POLL_MS);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, vm.project.id]);

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
    setProgress(null);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${vm.project.id}/review`, {
        method: "POST",
      });
      // Someone (or a previous click) already has a run going — attach to it
      // via the poll loop instead of erroring.
      if (res.status === 409) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Review failed");
      setReview({
        summary: data.summary ?? null,
        findings: (data.findings ?? []) as ViewFinding[],
        ranAt: new Date().toISOString(),
      });
      setProgress(null);
      setRunning(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
      setProgress(null);
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
            className="rounded-lg border border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(var(--overlay-rgb),0.03)] p-4 text-center"
          >
            <div className="text-2xl font-bold text-[var(--fg)]">{s.value}</div>
            <div className="text-xs uppercase tracking-wide text-[var(--fg-subtle)]">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(var(--overlay-rgb),0.03)] p-4">
        <div>
          <p className="font-medium text-[var(--fg)]">AI Design Review</p>
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
            Discovers functional blocks, verifies passive values, and flags
            action items from your parsed netlist and BOM.
          </p>
          {review.ranAt && (
            <p className="mt-1 text-xs text-[var(--fg-subtle)]">
              Last run {new Date(review.ranAt).toLocaleString()}
            </p>
          )}
        </div>
        <button
          onClick={runReview}
          disabled={running || !hasParsedData}
          className="rounded-md bg-[var(--accent-bg)] px-4 py-2 text-sm font-semibold text-[var(--accent-fg)] transition-all hover:bg-[var(--accent-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running
            ? "Analyzing…"
            : review.ranAt
              ? "Re-run review"
              : "Run design review"}
        </button>
      </div>

      {!hasParsedData && (
        <p className="text-sm text-[var(--fg-muted)]">
          Upload and parse a netlist or BOM first — the review runs on parsed
          board data.
        </p>
      )}

      {running && (
        <div className="space-y-3 rounded-lg border border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(var(--overlay-rgb),0.03)] p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-medium text-[var(--fg)]">
              {progress?.phase ?? "Starting the review"}…
            </span>
            {progress && (
              <span className="text-xs text-[var(--fg-subtle)]">
                Round {Math.max(1, progress.round)} of {progress.maxRounds} ·{" "}
                {progress.toolCalls} tool call
                {progress.toolCalls === 1 ? "" : "s"} ·{" "}
                {formatElapsed(progress.startedAt)}
              </span>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[rgba(var(--overlay-rgb),0.1)]">
            <div
              className="h-full animate-pulse rounded-full bg-[var(--fg)] opacity-70 transition-all duration-700"
              style={{
                width: progress
                  ? `${Math.min(94, Math.max(6, Math.round((progress.round / progress.maxRounds) * 100)))}%`
                  : "6%",
              }}
            />
          </div>
          <p className="text-xs text-[var(--fg-subtle)]">
            The review runs on the server — switch tabs or keep working, and
            progress picks up right here when you come back.
          </p>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {/* Results */}
      {!running && review.ranAt && (
        <div className="space-y-4">
          {review.summary && (
            <div className="rounded-lg border border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(var(--overlay-rgb),0.03)] p-4 text-sm text-[var(--fg-muted)]">
              {review.summary}
            </div>
          )}

          {review.findings.length === 0 ? (
            <p className="text-sm text-[var(--fg-muted)]">
              No findings were raised. (Severity scale: Possible bug · Verify ·
              Watch · Minor · Cosmetic · OK.)
            </p>
          ) : (
            grouped.map((group) => (
              <div key={group.block} className="space-y-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--fg-muted)]">
                  {group.block}
                </h3>
                <ul className="space-y-2">
                  {group.findings.map((f, i) => (
                    <li
                      key={`${group.block}-${i}`}
                      className="rounded-lg border border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(var(--overlay-rgb),0.03)] p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLE[f.severity]}`}
                        >
                          {SEVERITY_LABEL[f.severity]}
                        </span>
                        {f.hwReviewRequired && (
                          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                            HW review
                          </span>
                        )}
                        <span className="font-medium text-[var(--fg)]">
                          {f.title}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-[var(--fg-muted)]">
                        {f.rationale}
                      </p>
                      {f.refDes.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {f.refDes.map((r) => (
                            <span
                              key={r}
                              className="rounded border border-[rgba(var(--overlay-rgb),0.1)] bg-[rgba(var(--overlay-rgb),0.04)] px-1.5 py-0.5 font-mono text-xs text-[var(--fg-muted)]"
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
