/**
 * POST /api/projects/[id]/assistant
 *
 * Send a chat message. Body: { conversationId?: string, message: string }.
 * Omitting conversationId starts a new conversation (created from the first
 * message). The assistant reply is generated server-side before this
 * resolves — a client that navigated away picks it up by polling the
 * conversation endpoint instead.
 *
 * Returns { conversationId, reply } on success.
 */
import "server-only";

import type { NextRequest } from "next/server";

import { toUserError } from "@/lib/errors";
import { sendMessage } from "@/server/services/assistant-service";

export const runtime = "nodejs";
// A grounded answer can take several tool rounds; give it headroom.
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;

  let body: { conversationId?: unknown; message?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.message !== "string" || !body.message.trim()) {
    return Response.json(
      { error: "body.message must be a non-empty string" },
      { status: 400 }
    );
  }
  const conversationId =
    typeof body.conversationId === "string" ? body.conversationId : null;

  try {
    const result = await sendMessage(projectId, conversationId, body.message);
    return Response.json(result);
  } catch (error) {
    const { code, message } = toUserError(error);
    const status =
      code === "NOT_FOUND"
        ? 404
        : code === "VALIDATION_ERROR"
          ? 400
          : code === "FEATURE_DISABLED"
            ? 403
            : code === "CHAT_BUSY"
              ? 409
              : 500;
    return Response.json({ error: message }, { status });
  }
}
