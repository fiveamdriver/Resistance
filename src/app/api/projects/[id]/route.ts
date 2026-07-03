/**
 * PATCH /api/projects/[id]
 *
 * Partial project update. Sole caller today is the KiCad MCP server's
 * sync_to_resistance tool, which stamps syncMeta after pushing netlist + BOM.
 * Business logic lives in the project service; this layer only handles HTTP.
 */
import { NextResponse } from "next/server";

import { NotFoundError, toUserError } from "@/lib/errors";
import { updateProject } from "@/server/services/project-service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 }
    );
  }

  try {
    const project = await updateProject(projectId, body);
    return NextResponse.json({ project });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const { code, message, details } = toUserError(error);
    const status = code === "VALIDATION_ERROR" ? 400 : 500;
    return NextResponse.json({ error: message, details }, { status });
  }
}
