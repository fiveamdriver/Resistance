/**
 * REST endpoint for projects — provided alongside the server actions so future
 * non-form clients (CLI, integrations, the AI agent) have a typed JSON surface.
 * Business logic lives in the project service; this layer only handles HTTP.
 */
import { NextResponse } from "next/server";

import { toUserError } from "@/lib/errors";
import { createProject, listProjects } from "@/server/services/project-service";

export async function GET() {
  const projects = await listProjects();
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
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
    const project = await createProject(body);
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    const { code, message, details } = toUserError(error);
    const status = code === "VALIDATION_ERROR" ? 400 : 500;
    return NextResponse.json({ error: message, details }, { status });
  }
}
