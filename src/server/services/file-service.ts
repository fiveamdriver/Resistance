/**
 * File domain service.
 *
 * Orchestrates the upload pipeline: validate -> store on disk -> record in DB
 * -> parse (netlist / BOM) -> update parseStatus.
 */
import "server-only";

import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { categorizeFile } from "@/lib/fileTypes";
import { assertAltiumBinary } from "@/lib/parsers/altiumParser";
import { parseBomFile } from "@/lib/parsers/bomParser";
import { parseNetlistFile } from "@/lib/parsers/netlistParser";
import { saveUploadedFile } from "@/lib/storage";
import { parseOrThrow, uploadFileMetaSchema } from "@/lib/validation";

import { assertProjectExists } from "./project-service";

export interface UploadOutcome {
  fileName: string;
  ok: boolean;
  error?: string;
}

/**
 * Validate and store a batch of uploaded files for a project, then parse any
 * netlist or BOM files. Each file is handled independently so one failure
 * doesn't abort the rest. The caller gets a per-file outcome for the UI.
 *
 * Storage failures → ok: false (file not stored, no DB record).
 * Parse failures   → ok: true (file stored, parseStatus: "failed" in DB).
 */
export async function uploadFiles(
  projectId: string,
  files: File[]
): Promise<UploadOutcome[]> {
  await assertProjectExists(projectId);

  const outcomes: UploadOutcome[] = [];

  for (const file of files) {
    const category = categorizeFile(file.name);

    // ── Step 1: validate + store + create DB record ───────────────────────
    let projectFileId: string;
    let absolutePath: string;

    try {
      parseOrThrow(
        uploadFileMetaSchema,
        { name: file.name, size: file.size },
        `"${file.name}" could not be uploaded`
      );

      const stored = await saveUploadedFile(projectId, file);
      absolutePath = stored.absolutePath;

      const record = await prisma.projectFile.create({
        data: {
          projectId,
          originalName: file.name,
          storedName: stored.storedName,
          path: stored.relativePath,
          fileType: file.type || category,
          category,
          sizeBytes: stored.sizeBytes,
          parseStatus: "pending",
        },
      });
      projectFileId = record.id;
    } catch (error) {
      outcomes.push({
        fileName: file.name,
        ok: false,
        error:
          error instanceof AppError
            ? error.message
            : "Upload failed unexpectedly",
      });
      continue;
    }

    outcomes.push({ fileName: file.name, ok: true });

    // ── Step 2: parse / validate by category ──────────────────────────────
    // Failures update parseStatus in the DB but don't fail the upload outcome;
    // the parse status badge in the files table communicates the result.
    if (category === "netlist" || category === "bom") {
      try {
        if (category === "netlist") {
          await parseNetlistFile(projectId, absolutePath);
        } else {
          await parseBomFile(projectId, absolutePath);
        }
        await prisma.projectFile.update({
          where: { id: projectFileId },
          data: { parseStatus: "parsed" },
        });
      } catch (err) {
        await prisma.projectFile.update({
          where: { id: projectFileId },
          data: {
            parseStatus: "failed",
            parseError:
              err instanceof Error ? err.message : "Unexpected parse error",
          },
        });
      }
    } else if (category === "altium") {
      // Altium .SchDoc/.PcbDoc are imported and stored; we validate that the
      // upload is a genuine Altium binary but do not extract connectivity yet
      // (see altiumParser). Valid files remain "pending"; invalid ones fail.
      try {
        await assertAltiumBinary(absolutePath);
      } catch (err) {
        await prisma.projectFile.update({
          where: { id: projectFileId },
          data: {
            parseStatus: "failed",
            parseError:
              err instanceof Error ? err.message : "Invalid Altium file",
          },
        });
      }
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
