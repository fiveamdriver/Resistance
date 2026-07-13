/**
 * File domain service.
 *
 * Orchestrates the upload pipeline: validate -> store on disk -> record in DB
 * -> parse (netlist / BOM) -> update parseStatus.
 */
import "server-only";

import { unlink } from "fs/promises";

import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { categorizeFile } from "@/lib/fileTypes";
import { assertAltiumBinary } from "@/lib/parsers/altiumParser";
import { csvFileLooksLikeBom, parseBomFile } from "@/lib/parsers/bomParser";
import {
  parseBoardConnectivityFile,
  parsePcbLayoutFile,
  type PcbLayoutSummary,
} from "@/lib/parsers/kicadPcbParser";
import { isKicadNetlist, parseKicadNetlistFile } from "@/lib/parsers/kicadNetlistParser";
import { parseNetlistFile } from "@/lib/parsers/netlistParser";
import { resolveStoredPath, saveUploadedFile } from "@/lib/storage";
import { parseOrThrow, uploadFileMetaSchema } from "@/lib/validation";

import { deleteDocumentChunks, indexDocumentFile } from "./document-service";
import { runDatasheetPasses } from "./ingest-service";
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
  files: File[],
  opts?: {
    /**
     * How the files arrived. "kicad_sync" marks fresh EDA exports (MCP server
     * or in-app folder sync); "project_folder" marks loose documents imported
     * from a linked folder — present there, but not produced by the EDA tool.
     */
    provenance?: "upload" | "kicad_sync" | "project_folder";
  }
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

      // Re-uploading a file the project already has (the app's file identity
      // is originalName — the folder scan's "already imported" badge keys on
      // it too) refreshes it in place: adopt the existing record so parsers
      // that scope row ownership to the fileId (BOM rows, document chunks)
      // supersede the old rows instead of duplicating them.
      const provenance = opts?.provenance ?? "upload";
      const existing = await prisma.projectFile.findFirst({
        where: { projectId, originalName: file.name, provenance },
        orderBy: { uploadedAt: "desc" },
      });

      if (existing) {
        await deleteDocumentChunks(existing.id);
        await unlink(resolveStoredPath(existing.path)).catch(() => {});
        const record = await prisma.projectFile.update({
          where: { id: existing.id },
          data: {
            storedName: stored.storedName,
            path: stored.relativePath,
            fileType: file.type || category,
            category,
            sizeBytes: stored.sizeBytes,
            parseStatus: "pending",
            parseError: null,
            uploadedAt: new Date(),
          },
        });
        projectFileId = record.id;
      } else {
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
            provenance,
          },
        });
        projectFileId = record.id;
      }
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
        // A kicad_sync netlist is a fresh full-design export — authoritative,
        // so nets/pins absent from it are pruned. Manual uploads stay additive.
        const prune = opts?.provenance === "kicad_sync";
        const header = (await file.slice(0, 128).text()).trimStart();
        const result = isKicadNetlist(header)
          ? await parseKicadNetlistFile(projectId, absolutePath, { prune })
          : await parseNetlistFile(projectId, absolutePath, { prune });
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
      // .csv is "bom" by extension only. Content-sniff the headers: a real
      // BOM goes to the BOM parser; telemetry/calibration/measurement CSVs
      // become searchable "data" documents instead of garbage BOM rows.
      const isCsv = absolutePath.toLowerCase().endsWith(".csv");
      if (isCsv && !(await csvFileLooksLikeBom(absolutePath))) {
        try {
          const result = await indexDocumentFile(
            projectId,
            projectFileId,
            absolutePath,
            "data"
          );
          parseStatus = "parsed";
          summary = result;
          await prisma.projectFile.update({
            where: { id: projectFileId },
            data: { category: "data", parseStatus: "parsed" },
          });
        } catch (err) {
          parseStatus = "failed";
          await prisma.projectFile.update({
            where: { id: projectFileId },
            data: {
              category: "data",
              parseStatus: "failed",
              parseError:
                err instanceof Error ? err.message : "Document parse error",
            },
          });
        }
      } else {
        try {
          // The file owns its BOM rows (re-parse supersedes them); sync exports
          // are authoritative for MPN write-back, loose uploads only fill blanks.
          const result = await parseBomFile(projectId, absolutePath, {
            fileId: projectFileId,
            authoritative: opts?.provenance === "kicad_sync",
          });
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
    } else if (category === "board") {
      // .kicad_pcb: components + pad→net connectivity (additive — never
      // deletes what a netlist established), then layout facts. The board
      // path exists so legacy/schematic-less designs import without KiCad.
      try {
        const conn = await parseBoardConnectivityFile(projectId, absolutePath);
        let layout: PcbLayoutSummary | null = null;
        try {
          layout = await parsePcbLayoutFile(projectId, absolutePath, file.name);
        } catch {
          // Connectivity landed; missing layout facts shouldn't fail the file.
        }
        parseStatus = "parsed";
        summary = { ...conn, layout };
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

  // Datasheet passes, fire-and-forget so the upload response never waits on
  // them. Local matching runs first: a PDF already in the project (upload or
  // folder import) whose filename carries a component's MPN becomes that
  // part's verified datasheet, and the design_link/web_fetch tiers then skip
  // the covered MPN instead of downloading. Serialized per project — parallel
  // upload batches must not race each other into duplicate downloads.
  const parsedDesignData = outcomes.some(
    (o) => o.ok && o.parseStatus === "parsed"
  );
  if (parsedDesignData) {
    void runDatasheetPasses(projectId);
  }

  return outcomes;
}

export async function listProjectFiles(projectId: string) {
  return prisma.projectFile.findMany({
    where: { projectId },
    orderBy: { uploadedAt: "desc" },
  });
}
