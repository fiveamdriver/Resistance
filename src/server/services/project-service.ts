/**
 * Project domain service.
 *
 * Owns all project read/write business logic and is the only place the rest of
 * the app touches the `Project` table. Server actions and pages call these
 * functions; they never embed Prisma queries directly.
 */
import "server-only";

import { prisma } from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  createProjectSchema,
  parseOrThrow,
  updateProjectSchema,
} from "@/lib/validation";

export async function listProjects() {
  return prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { files: true, components: true } } },
  });
}

export async function createProject(input: unknown) {
  const data = parseOrThrow(
    createProjectSchema,
    input,
    "Please correct the highlighted fields"
  );
  return prisma.project.create({
    data: { name: data.name, description: data.description ?? null },
  });
}

/** Full project with everything the dashboard renders. Throws if not found. */
export async function getProjectDashboard(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      files: { orderBy: { uploadedAt: "desc" } },
      components: {
        orderBy: { refDes: "asc" },
        include: { pins: true, bomItems: true },
      },
      nets: {
        orderBy: { name: "asc" },
        include: { _count: { select: { connections: true } } },
      },
      bomItems: {
        orderBy: { refDesRaw: "asc" },
        include: { components: true },
      },
      // Only the most recent review run is needed for the Reports tab.
      reviewRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { findings: true },
      },
      _count: { select: { documentChunks: true } },
    },
  });

  if (!project) {
    throw new NotFoundError("Project not found");
  }
  return project;
}

export type ProjectDashboard = Awaited<ReturnType<typeof getProjectDashboard>>;

/** Lightweight existence check used by the upload service. */
export async function assertProjectExists(projectId: string) {
  const exists = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!exists) throw new NotFoundError("Project not found");
}

/**
 * Delete a project and everything it owns. DB rows cascade from the Project
 * row; stored bytes under uploads/<projectId>/ are removed best-effort.
 * Shared library datasheets (uploads/library/, content-addressed, referenced
 * across projects) are intentionally left alone.
 */
export async function deleteProject(projectId: string) {
  await assertProjectExists(projectId);
  await prisma.project.delete({ where: { id: projectId } });

  const { rm } = await import("fs/promises");
  const path = await import("path");
  const { getUploadsRoot } = await import("@/lib/storage");
  await rm(path.join(getUploadsRoot(), projectId), {
    recursive: true,
    force: true,
  }).catch((err) =>
    console.error(`[project] could not remove uploads for ${projectId}:`, err)
  );

  // A deleted project must not keep its auto-sync file watcher alive.
  const { reconcileWatchers } = await import("./watcher-service");
  await reconcileWatchers().catch((err) =>
    console.error("[auto-sync] watcher reconcile failed:", err)
  );
}

/**
 * Partial project update: syncMeta (stamped after a sync; JSON string because
 * the SQLite connector has no Json type), the linked KiCad folder, and the
 * auto-sync flag.
 */
export async function updateProject(projectId: string, input: unknown) {
  const data = parseOrThrow(
    updateProjectSchema,
    input,
    "Invalid project update payload"
  );
  await assertProjectExists(projectId);

  if (typeof data.kicadProjectPath === "string") {
    const { statSync } = await import("fs");
    const path = await import("path");
    if (!path.isAbsolute(data.kicadProjectPath)) {
      throw new ValidationError("Folder path must be absolute");
    }
    let isDir = false;
    try {
      isDir = statSync(data.kicadProjectPath).isDirectory();
    } catch {
      // fall through to the error below
    }
    if (!isDir) {
      throw new ValidationError(
        `Not a folder on this machine: ${data.kicadProjectPath}`
      );
    }
  }

  const project = await prisma.project.update({
    where: { id: projectId },
    data: {
      ...(data.syncMeta !== undefined && {
        syncMeta: JSON.stringify(data.syncMeta),
      }),
      ...(data.kicadProjectPath !== undefined && {
        kicadProjectPath: data.kicadProjectPath,
        // Unlinking the folder turns auto-sync off with it.
        ...(data.kicadProjectPath === null && { autoSyncEnabled: false }),
      }),
      ...(data.autoSyncEnabled !== undefined && {
        autoSyncEnabled: data.autoSyncEnabled,
      }),
    },
  });

  // Folder link / auto-sync changes affect the running file watchers.
  // Dynamic import to keep the watcher module out of pages that only read.
  if (data.kicadProjectPath !== undefined || data.autoSyncEnabled !== undefined) {
    const { reconcileWatchers } = await import("./watcher-service");
    await reconcileWatchers().catch((err) =>
      console.error("[auto-sync] watcher reconcile failed:", err)
    );
  }

  return project;
}
