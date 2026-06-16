/**
 * POST /api/projects/[id]/review
 *
 * Runs the AI design-review pipeline over the project's parsed netlist/BOM and
 * persists the findings as a ReviewRun. Returns the saved run id + structured
 * result as JSON. Non-streaming: a review takes several tool rounds, so the
 * client shows a loading state until this resolves.
 */
import "server-only";

import type { NextRequest } from "next/server";

import { toUserError } from "@/lib/errors";
import { runReview } from "@/server/services/review-service";

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
    const status = code === "NOT_FOUND" ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
}
