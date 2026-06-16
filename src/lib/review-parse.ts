/**
 * Pure normalization of the `submit_review` tool input into a typed ReviewResult.
 *
 * Kept separate from the service (which needs server-only Anthropic/Prisma) so it
 * can be unit-tested in plain Node. Defensive by design: the LLM controls this
 * shape, so every field is validated and bad findings are dropped rather than
 * trusted.
 */
import {
  isSeverity,
  type FindingData,
  type ReviewResult,
} from "./review-types";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRefDes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

function normalizeFinding(raw: unknown): FindingData | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const severity = r.severity;
  const title = asString(r.title);
  const rationale = asString(r.rationale);
  // A finding with no title or unknown severity is unusable — drop it.
  if (!title || !isSeverity(severity)) return null;

  return {
    block: asString(r.block) || "General",
    severity,
    title,
    rationale,
    refDes: normalizeRefDes(r.refdes),
    hwReviewRequired: r.hw_review_required === true,
  };
}

export function parseSubmitReview(input: unknown): ReviewResult {
  const obj = (
    typeof input === "object" && input !== null ? input : {}
  ) as Record<string, unknown>;
  const findingsRaw = Array.isArray(obj.findings) ? obj.findings : [];

  const findings = findingsRaw
    .map(normalizeFinding)
    .filter((f): f is FindingData => f !== null);

  return {
    summary: asString(obj.summary),
    findings,
  };
}
