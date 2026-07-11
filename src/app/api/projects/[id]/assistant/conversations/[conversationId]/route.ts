/**
 * GET    /api/projects/[id]/assistant/conversations/[conversationId]
 * DELETE /api/projects/[id]/assistant/conversations/[conversationId]
 *
 * GET is the poll target while a reply is generating: full message list,
 * whether a reply is still pending, and the live progress (phase/tool calls)
 * of the in-flight turn. DELETE removes the conversation and its messages.
 */
import "server-only";

import type { NextRequest } from "next/server";

import { toUserError } from "@/lib/errors";
import {
  deleteConversation,
  getConversation,
} from "@/server/services/assistant-service";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; conversationId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id: projectId, conversationId } = await params;
  try {
    return Response.json(await getConversation(projectId, conversationId));
  } catch (error) {
    const { code, message } = toUserError(error);
    return Response.json(
      { error: message },
      { status: code === "NOT_FOUND" ? 404 : 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id: projectId, conversationId } = await params;
  await deleteConversation(projectId, conversationId);
  return Response.json({ ok: true });
}
