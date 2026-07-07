/**
 * POST /api/projects/[id]/folder-import
 *
 * Imports from the linked KiCad folder: fresh kicad-cli exports
 * (runExports: true → netlist + BOM, `kicad_sync` provenance, stamps
 * syncMeta) and/or selected documents by scan-relative path
 * (`project_folder` provenance). The sync button posts
 * { runExports: true, files: [] }.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { toUserError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation";
import { importFromFolder } from "@/server/services/folder-sync-service";

const importSchema = z.object({
  runExports: z.boolean().optional(),
  files: z.array(z.string().min(1).max(1000)).max(200).optional(),
});

export async function POST(
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
    const parsed = parseOrThrow(importSchema, body, "Invalid import request");
    const result = await importFromFolder(projectId, {
      runExports: parsed.runExports ?? false,
      files: parsed.files ?? [],
    });
    return NextResponse.json({ result });
  } catch (error) {
    const { code, message, details } = toUserError(error);
    const status =
      code === "NOT_FOUND"
        ? 404
        : code === "VALIDATION_ERROR"
          ? 400
          : code === "FEATURE_DISABLED"
            ? 409
            : 500;
    return NextResponse.json({ error: message, details }, { status });
  }
}
