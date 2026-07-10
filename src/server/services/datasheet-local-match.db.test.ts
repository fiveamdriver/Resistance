/**
 * Local datasheet matching (matchLocalDatasheets): folder-imported or
 * uploaded PDFs whose filename carries a component's MPN become that part's
 * verified datasheet — after the content gate — and outrank downloaded docs.
 */
import { mkdirSync, writeFileSync } from "fs";
import path from "path";

import { beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { makePdf, PDF_FILLER } from "@/test/pdf-fixture";

import { matchLocalDatasheets } from "./ingest-service";

function storePdf(name: string, pageTexts: string[]): string {
  const uploads = process.env.UPLOADS_DIR!;
  mkdirSync(uploads, { recursive: true });
  writeFileSync(path.join(uploads, name), makePdf(pageTexts));
  return name; // ProjectFile.path is relative to the uploads root
}

async function makeProject(name: string, mpns: string[]): Promise<string> {
  const project = await prisma.project.create({ data: { name } });
  for (let i = 0; i < mpns.length; i++) {
    await prisma.component.create({
      data: { projectId: project.id, refDes: `U${i + 1}`, mpn: mpns[i] },
    });
  }
  return project.id;
}

async function makePdfFile(
  projectId: string,
  originalName: string,
  pageTexts: string[],
  overrides: Partial<{ provenance: string; mpn: string | null; verifyStatus: string }> = {}
): Promise<string> {
  const rel = storePdf(`${projectId}-${originalName}`, pageTexts);
  const file = await prisma.projectFile.create({
    data: {
      projectId,
      originalName,
      storedName: rel,
      path: rel,
      fileType: "application/pdf",
      category: "pdf",
      parseStatus: "parsed",
      provenance: overrides.provenance ?? "project_folder",
      verifyStatus: overrides.verifyStatus ?? "verified",
      mpn: overrides.mpn ?? null,
    },
  });
  return file.id;
}

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
});

describe("matchLocalDatasheets", () => {
  it("stamps a folder PDF as the part's datasheet when filename and content match", async () => {
    const projectId = await makeProject("local-match-happy", ["LM317-N"]);
    const fileId = await makePdfFile(projectId, "lm317-n.pdf", [
      `LM317-N three terminal adjustable regulator. ${PDF_FILLER}`,
    ]);

    const results = await matchLocalDatasheets(projectId);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: "verified", fileId });

    const file = await prisma.projectFile.findUniqueOrThrow({ where: { id: fileId } });
    expect(file.mpn).toBe("LM317-N");
    expect(file.verifyStatus).toBe("verified");
  });

  it("matches MPN despite packaging suffix and case differences", async () => {
    const projectId = await makeProject("local-match-suffix", ["LM317-NOPB"]);
    const fileId = await makePdfFile(projectId, "LM317 Datasheet.pdf", [
      `LM317 adjustable regulator datasheet. ${PDF_FILLER}`,
    ]);

    const results = await matchLocalDatasheets(projectId);
    expect(results[0]).toMatchObject({ status: "verified", fileId });
  });

  it("leaves the file a plain document when content fails the gate", async () => {
    const projectId = await makeProject("local-match-wrong", ["LM317-N"]);
    const fileId = await makePdfFile(projectId, "lm317-n.pdf", [
      `NE555 precision timer datasheet. ${PDF_FILLER}`,
    ]);

    const results = await matchLocalDatasheets(projectId);
    expect(results[0].status).toBe("failed");

    const file = await prisma.projectFile.findUniqueOrThrow({ where: { id: fileId } });
    expect(file.mpn).toBeNull();
    expect(file.verifyStatus).toBe("verified"); // still an indexed general doc
  });

  it("supersedes a lower-tier web_fetch doc for the same part", async () => {
    const projectId = await makeProject("local-match-supersede", ["LM317-N"]);
    const webId = await makePdfFile(projectId, "LM317-N-datasheet.pdf", [
      `LM317-N regulator. ${PDF_FILLER}`,
    ], { provenance: "web_fetch", mpn: "LM317-N" });
    const localId = await makePdfFile(projectId, "lm317-n.pdf", [
      `LM317-N three terminal adjustable regulator. ${PDF_FILLER}`,
    ]);

    const results = await matchLocalDatasheets(projectId);
    expect(results[0]).toMatchObject({ status: "verified", fileId: localId });

    const web = await prisma.projectFile.findUniqueOrThrow({ where: { id: webId } });
    expect(web.verifyStatus).toBe("superseded");
  });

  it("skips when an equal-tier doc already covers the part, and ignores unrelated names", async () => {
    const projectId = await makeProject("local-match-skip", ["LM317-N"]);
    await makePdfFile(projectId, "lm317-n rev A.pdf", [
      `LM317-N regulator. ${PDF_FILLER}`,
    ], { provenance: "upload", mpn: "LM317-N" });
    const dupId = await makePdfFile(projectId, "lm317-n rev B.pdf", [
      `LM317-N regulator. ${PDF_FILLER}`,
    ]);
    await makePdfFile(projectId, "assembly-instructions.pdf", [
      `How to build the board. ${PDF_FILLER}`,
    ]);

    const results = await matchLocalDatasheets(projectId);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: "skipped", fileId: dupId });
  });
});
