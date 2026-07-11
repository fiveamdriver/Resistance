/**
 * GET /api/projects/[id]/assistant/conversations
 *
 * Sidebar data: the project's conversations, most recently active first.
 */
import "server-only";

import type { NextRequest } from "next/server";

import { listConversations } from "@/server/services/assistant-service";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  return Response.json({ conversations: await listConversations(projectId) });
}
