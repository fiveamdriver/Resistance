/**
 * Project domain service.
 *
 * Owns all project read/write business logic and is the only place the rest of
 * the app touches the `Project` table. Server actions and pages call these
 * functions; they never embed Prisma queries directly.
 */
import "server-only";

import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/errors";
import { createProjectSchema, parseOrThrow } from "@/lib/validation";

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
      bomItems: { orderBy: { refDesRaw: "asc" }, include: { components: true } },
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
