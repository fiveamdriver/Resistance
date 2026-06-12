/**
 * File domain service.
 *
 * Orchestrates the upload pipeline: validate -> store on disk -> record in DB.
 * Parsing is intentionally decoupled (see `parsers/`) and only dispatched as a
 * placeholder in Phase 1.
 */
import "server-only";

import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { categorizeFile } from "@/lib/fileTypes";
import { saveUploadedFile } from "@/lib/storage";
import { parseOrThrow, uploadFileMetaSchema } from "@/lib/validation";

import { assertProjectExists } from "./project-service";

export interface UploadOutcome {
  fileName: string;
  ok: boolean;
  error?: string;
}

/**
 * Validate and store a batch of uploaded files for a project. Each file is
 * handled independently so one bad file doesn't abort the rest; the caller gets
 * a per-file outcome to surface in the UI.
 */
export async function uploadFiles(
  projectId: string,
  files: File[]
): Promise<UploadOutcome[]> {
  await assertProjectExists(projectId);

  const outcomes: UploadOutcome[] = [];

  for (const file of files) {
    try {
      // 1. Validate type + size before touching disk.
      parseOrThrow(
        uploadFileMetaSchema,
        { name: file.name, size: file.size },
        `"${file.name}" could not be uploaded`
      );

      // 2. Persist bytes under a server-generated, collision-safe name.
      const stored = await saveUploadedFile(projectId, file);

      // 3. Record metadata. parseStatus starts "pending" — real parsing is a
      //    Phase 2 background job (see parsers/index.ts::dispatchParse).
      await prisma.projectFile.create({
        data: {
          projectId,
          originalName: file.name,
          storedName: stored.storedName,
          path: stored.relativePath,
          fileType: file.type || categorizeFile(file.name),
          category: categorizeFile(file.name),
          sizeBytes: stored.sizeBytes,
          parseStatus: "pending",
        },
      });

      outcomes.push({ fileName: file.name, ok: true });
    } catch (error) {
      outcomes.push({
        fileName: file.name,
        ok: false,
        error:
          error instanceof AppError
            ? error.message
            : "Upload failed unexpectedly",
      });
    }
  }

  return outcomes;
}

export async function listProjectFiles(projectId: string) {
  return prisma.projectFile.findMany({
    where: { projectId },
    orderBy: { uploadedAt: "desc" },
  });
}
