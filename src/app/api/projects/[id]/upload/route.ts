/**
 * POST /api/projects/[id]/upload
 *
 * Accepts a multipart/form-data upload with a single `file` field. Pipeline:
 *   1. Assert the project exists
 *   2. Validate file type + size via the shared Zod schema
 *   3. Write bytes to uploads/<projectId>/<uuid>.<ext> on disk
 *   4. Create a ProjectFile record (parseStatus: "pending")
 *   5. Dispatch to the appropriate parser (netlist or BOM)
 *   6. Update ProjectFile.parseStatus ("parsed" | "failed")
 *   7. Return { success, projectFileId, summary }
 *
 * Errors before the file lands on disk are returned as 4xx with no DB record.
 * Parse failures are returned as 200 with success: false — the file was still
 * stored and the ProjectFile record reflects the failure.
 */
import { NextResponse } from "next/server";

import { assertAltiumBinary } from "@/lib/parsers/altiumParser";
import { parseBomFile } from "@/lib/parsers/bomParser";
import { parseNetlistFile } from "@/lib/parsers/netlistParser";
import { prisma } from "@/lib/prisma";
import { AppError, NotFoundError, toUserError } from "@/lib/errors";
import { categorizeFile } from "@/lib/fileTypes";
import { saveUploadedFile } from "@/lib/storage";
import { parseOrThrow, uploadFileMetaSchema } from "@/lib/validation";
import { assertProjectExists } from "@/server/services/project-service";

// Raise the body size limit for this route to match the server-action limit.
export const maxDuration = 60;

type ParseSummary =
  | Awaited<ReturnType<typeof parseNetlistFile>>
  | Awaited<ReturnType<typeof parseBomFile>>
  | { message: string };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;

  // ── 1. Assert project exists ──────────────────────────────────────────────
  try {
    await assertProjectExists(projectId);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    throw err;
  }

  // ── 2. Extract file from multipart form ───────────────────────────────────
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

  // ── 3. Validate type + size ────────────────────────────────────────────────
  try {
    parseOrThrow(
      uploadFileMetaSchema,
      { name: fileEntry.name, size: fileEntry.size },
      `"${fileEntry.name}" cannot be uploaded`
    );
  } catch (err) {
    const { message, details } = toUserError(err);
    return NextResponse.json({ error: message, details }, { status: 400 });
  }

  // ── 4. Persist bytes to disk ──────────────────────────────────────────────
  let stored: Awaited<ReturnType<typeof saveUploadedFile>>;
  try {
    stored = await saveUploadedFile(projectId, fileEntry);
  } catch (err) {
    const { message } = toUserError(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const category = categorizeFile(fileEntry.name);

  // ── 5. Create ProjectFile record ──────────────────────────────────────────
  const projectFile = await prisma.projectFile.create({
    data: {
      projectId,
      originalName: fileEntry.name,
      storedName: stored.storedName,
      path: stored.relativePath,
      fileType: fileEntry.type || category,
      category,
      sizeBytes: stored.sizeBytes,
      parseStatus: "pending",
    },
  });

  // ── 6. Parse ──────────────────────────────────────────────────────────────
  let summary: ParseSummary;
  let parseStatus: "pending" | "parsed" | "failed" = "parsed";
  let parseError: string | null = null;

  try {
    if (category === "netlist") {
      summary = await parseNetlistFile(projectId, stored.absolutePath);
    } else if (category === "bom") {
      summary = await parseBomFile(projectId, stored.absolutePath);
    } else if (category === "altium") {
      // Validate the upload is a genuine Altium binary, then leave it "pending":
      // imported and stored, with connectivity extraction deferred.
      await assertAltiumBinary(stored.absolutePath);
      parseStatus = "pending";
      summary = {
        message:
          "Altium document imported and stored. Connectivity extraction from the binary is not implemented yet — export a netlist (.net) for nets/components.",
      };
    } else {
      summary = {
        message: `File stored as category "${category}". No parser implemented for this type yet.`,
      };
    }
  } catch (err) {
    parseStatus = "failed";
    parseError =
      err instanceof AppError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unexpected parse error";
    summary = { message: parseError };
  }

  // ── 7. Update parse status ────────────────────────────────────────────────
  await prisma.projectFile.update({
    where: { id: projectFile.id },
    data: { parseStatus, parseError },
  });

  return NextResponse.json(
    {
      success: parseStatus !== "failed",
      projectFileId: projectFile.id,
      summary,
    },
    { status: 201 }
  );
}
