/**
 * POST /api/projects/[id]/upload
 *
 * Accepts a multipart/form-data upload with a single `file` field. Delegates
 * the full pipeline (validate → store → parse → DB update) to uploadFiles()
 * in the file domain service.
 *
 * Errors before the file lands on disk are returned as 4xx with no DB record.
 * Parse failures are returned as 200 with success: false — the file was still
 * stored and the ProjectFile record reflects the failure.
 */
import { NextResponse } from "next/server";

import { NotFoundError, toUserError } from "@/lib/errors";
import { uploadFiles } from "@/server/services/file-service";

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;

  // ── Extract file from multipart form ─────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Request must be multipart/form-data" },
      { status: 400 }
    );
  }

  const fileEntry = formData.get("file");
  if (!(fileEntry instanceof File) || fileEntry.size === 0) {
    return NextResponse.json(
      { error: 'A non-empty "file" field is required.' },
      { status: 400 }
    );
  }

  // Optional provenance tag. Only "kicad_sync" (the KiCad MCP server) may be
  // claimed by API callers; other provenance values are assigned internally.
  const provenanceEntry = formData.get("provenance");
  if (provenanceEntry !== null && provenanceEntry !== "kicad_sync") {
    return NextResponse.json(
      { error: 'Unsupported "provenance" value. Only "kicad_sync" is accepted.' },
      { status: 400 }
    );
  }
  const provenance = provenanceEntry === "kicad_sync" ? "kicad_sync" : undefined;

  // ── Delegate the full pipeline to the file service ────────────────────────
  let outcomes: Awaited<ReturnType<typeof uploadFiles>>;
  try {
    outcomes = await uploadFiles(projectId, [fileEntry], { provenance });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const { message } = toUserError(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const outcome = outcomes[0];

  if (!outcome.ok) {
    const status = outcome.isStorageError ? 500 : 400;
    return NextResponse.json(
      { error: outcome.error, details: outcome.details },
      { status }
    );
  }

  return NextResponse.json(
    {
      success: outcome.parseStatus !== "failed",
      projectFileId: outcome.projectFileId,
      summary: outcome.summary,
    },
    { status: 201 }
  );
}
