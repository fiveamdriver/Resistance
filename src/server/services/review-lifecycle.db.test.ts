/**
 * Review run lifecycle (audit finding #7): one live run per project, stale
 * "running" rows are reaped, and failed runs persist with their error instead
 * of vanishing.
 *
 * Uses a bogus ANTHROPIC_API_KEY so the first real API call fails — that
 * exercises the failure-persistence path end-to-end without network access.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

import { runReview } from "./review-service";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
});

async function makeProject(): Promise<string> {
  const project = await prisma.project.create({
    data: { name: `test-${Math.random().toString(36).slice(2)}` },
  });
  return project.id;
}

describe("review run lifecycle", () => {
  it("rejects a second run while one is live", async () => {
    const projectId = await makeProject();
    await prisma.reviewRun.create({
      data: { projectId, status: "running", model: "test" },
    });

    await expect(runReview(projectId)).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "REVIEW_IN_PROGRESS"
    );
    // The live row was not touched.
    const runs = await prisma.reviewRun.findMany({ where: { projectId } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("running");
  });

  it("reaps a stale running row and persists the new run's failure", async () => {
    const projectId = await makeProject();
    const stale = await prisma.reviewRun.create({
      data: {
        projectId,
        status: "running",
        model: "test",
        createdAt: new Date(Date.now() - 20 * 60 * 1000),
      },
    });

    // Proceeds past the lock (stale row reaped), then fails at the API call
    // because the key is bogus — the failure must persist on the new row.
    await expect(runReview(projectId)).rejects.toThrow();

    const reaped = await prisma.reviewRun.findUniqueOrThrow({
      where: { id: stale.id },
    });
    expect(reaped.status).toBe("failed");
    expect(reaped.error).toMatch(/interrupted/);

    const runs = await prisma.reviewRun.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
    expect(runs).toHaveLength(2);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].error).toBeTruthy();
  });
});
