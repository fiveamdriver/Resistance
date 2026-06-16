/**
 * Shared types for the AI design-review feature.
 *
 * The severity scale mirrors the action-item report format: each finding states
 * what to look at, why it's flagged, how serious it is, and whether a human
 * hardware review is required.
 */

export const SEVERITIES = [
  "possible_bug",
  "verify",
  "watch",
  "minor",
  "cosmetic",
  "ok",
] as const;

export type Severity = (typeof SEVERITIES)[number];

/** Human-readable labels for the UI. */
export const SEVERITY_LABEL: Record<Severity, string> = {
  possible_bug: "Possible bug",
  verify: "Verify",
  watch: "Watch",
  minor: "Minor",
  cosmetic: "Cosmetic",
  ok: "OK",
};

/** Sort order for display — most serious first. */
export const SEVERITY_RANK: Record<Severity, number> = {
  possible_bug: 0,
  verify: 1,
  watch: 2,
  minor: 3,
  cosmetic: 4,
  ok: 5,
};

export function isSeverity(value: unknown): value is Severity {
  return (
    typeof value === "string" &&
    (SEVERITIES as readonly string[]).includes(value)
  );
}

/** A single finding as produced by the reviewer and persisted. */
export interface FindingData {
  block: string;
  severity: Severity;
  title: string;
  rationale: string;
  /** Reference designators this finding concerns, e.g. ["U7", "R12"]. */
  refDes: string[];
  hwReviewRequired: boolean;
}

/** The full result of one review run. */
export interface ReviewResult {
  summary: string;
  findings: FindingData[];
}
