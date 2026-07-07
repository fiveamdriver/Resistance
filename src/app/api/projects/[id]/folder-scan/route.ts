/**
 * GET /api/projects/[id]/folder-scan
 *
 * Categorized listing of the project's linked KiCad folder: the recognized
 * EDA project + its fresh exports, importable documents, and everything else.
 * Read-only; the import itself is POST /folder-import.
 */
import { NextResponse } from "next/server";

import { toUserError } from "@/lib/errors";
import { scanLinkedFolder } from "@/server/services/folder-sync-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  try {
    const scan = await scanLinkedFolder(projectId);
    return NextResponse.json({ scan });
  } catch (error) {
    const { code, message } = toUserError(error);
    const status =
      code === "NOT_FOUND" ? 404 : code === "VALIDATION_ERROR" ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
