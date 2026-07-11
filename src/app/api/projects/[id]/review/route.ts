/**
 * POST /api/projects/[id]/review
 *
 * Runs the AI design-review pipeline over the project's parsed netlist/BOM and
 * persists the findings as a ReviewRun. Returns the saved run id + structured
 * result as JSON. Non-streaming: a review takes several tool rounds, so the
 * client shows a loading state until this resolves.
 *
 * GET /api/projects/[id]/review
 *
 * Status poll for the reports tab: live progress of an in-flight run (round,
 * phase, tool calls) plus the latest persisted run. The review executes
 * server-side inside the POST, so the client can navigate away and re-attach
 * by polling this endpoint — progress is never lost with the component.
 */
import "server-only";

import type { NextRequest } from "next/server";

import { toReviewRunVM } from "@/components/dashboard/view-models";
import { toUserError } from "@/lib/errors";
import {
  getLatestReview,
  getReviewProgress,
  runReview,
} from "@/server/services/review-service";

export const runtime = "nodejs";
// A full review runs multiple LLM rounds; give it headroom on platforms that honor it.
export const maxDuration = 300;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;

  try {
    const { reviewRunId, result } = await runReview(projectId);
    return Response.json({ reviewRunId, ...result });
  } catch (error) {
    const { code, message } = toUserError(error);
    const status =
      code === "NOT_FOUND"
        ? 404
        : code === "FEATURE_DISABLED"
          ? 403
          : code === "REVIEW_IN_PROGRESS"
            ? 409
            : 500;
    return Response.json({ error: message }, { status });
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const progress = getReviewProgress(projectId);
  const run = await getLatestReview(projectId);

  // In-memory progress is the authoritative "running" signal; a DB row stuck
  // in "running" with no progress entry is a crashed run awaiting the stale
  // sweep, and polling it as running would spin forever.
  const running = progress !== null;

  return Response.json({
    status: running ? "running" : (run?.status ?? "none"),
    progress,
    run: run && run.status !== "running" ? toReviewRunVM(run) : null,
  });
}
