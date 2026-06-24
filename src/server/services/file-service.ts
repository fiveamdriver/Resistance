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
import { isKicadNetlist, parseKicadNetlistFile } from "@/lib/parsers/kicadNetlistParser";
import { parseNetlistFile } from "@/lib/parsers/netlistParser";
import { saveUploadedFile } from "@/lib/storage";
import { parseOrThrow, uploadFileMetaSchema } from "@/lib/validation";

import { indexDocumentFile } from "./document-service";
import { assertProjectExists } from "./project-service";

export interface UploadOutcome {
  fileName: string;
  ok: boolean;
  error?: string;
  /** true when the failure was an I/O/storage error rather than a validation error. */
  isStorageError?: boolean;
  /** Validation error field details (e.g. Zod issues), safe to surface to the user. */
  details?: Record<string, string[] | undefined>;
  /** The created ProjectFile record ID. Present when ok === true. */
  projectFileId?: string;
  /** Final parse status. Present when ok === true. */
  parseStatus?: "pending" | "parsed" | "failed";
  /** The parser's result summary. Present when ok === true and parseStatus === "parsed". */
  summary?: unknown;
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
        isStorageError: !(error instanceof AppError),
        error:
          error instanceof AppError
            ? error.message
            : "Upload failed unexpectedly",
        details: error instanceof AppError ? error.details : undefined,
      });
      continue;
    }

    // ── Step 2: parse / validate by category ──────────────────────────────
    // Parse failures update parseStatus in the DB but don't fail the upload
    // outcome — the parse status badge in the files table shows the result.
    let parseStatus: "pending" | "parsed" | "failed" = "pending";
    let summary: unknown;

    if (category === "netlist") {
      try {
        const header = (await file.slice(0, 128).text()).trimStart();
        const result = isKicadNetlist(header)
          ? await parseKicadNetlistFile(projectId, absolutePath)
          : await parseNetlistFile(projectId, absolutePath);
        parseStatus = "parsed";
        summary = result;
        await prisma.projectFile.update({
          where: { id: projectFileId },
          data: { parseStatus: "parsed" },
        });
      } catch (err) {
        parseStatus = "failed";
        await prisma.projectFile.update({
          where: { id: projectFileId },
          data: {
            parseStatus: "failed",
            parseError:
              err instanceof Error ? err.message : "Unexpected parse error",
          },
        });
      }
    } else if (category === "bom") {
      try {
        const result = await parseBomFile(projectId, absolutePath);
        parseStatus = "parsed";
        summary = result;
        await prisma.projectFile.update({
          where: { id: projectFileId },
          data: { parseStatus: "parsed" },
        });
      } catch (err) {
        parseStatus = "failed";
        await prisma.projectFile.update({
          where: { id: projectFileId },
          data: {
            parseStatus: "failed",
            parseError:
              err instanceof Error ? err.message : "Unexpected parse error",
          },
        });
      }
    } else if (category === "pdf" || category === "document") {
      try {
        const result = await indexDocumentFile(projectId, projectFileId, absolutePath, category);
        parseStatus = "parsed";
        summary = result;
        await prisma.projectFile.update({
          where: { id: projectFileId },
          data: { parseStatus: "parsed" },
        });
      } catch (err) {
        parseStatus = "failed";
        await prisma.projectFile.update({
          where: { id: projectFileId },
          data: {
            parseStatus: "failed",
            parseError: err instanceof Error ? err.message : "Document parse error",
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
        parseStatus = "failed";
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

    outcomes.push({ fileName: file.name, ok: true, projectFileId, parseStatus, summary });
  }

  return outcomes;
}

export async function listProjectFiles(projectId: string) {
  return prisma.projectFile.findMany({
    where: { projectId },
    orderBy: { uploadedAt: "desc" },
  });
}
