/**
 * fetch_datasheet guard branches — everything that must hold WITHOUT network:
 * the settings gate, refdes/MPN resolution, and the on-file short-circuits
 * (verified / quarantined). The live fetch path is exercised through
 * ingestRemotePdf, which has its own coverage.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { updateSettings } from "@/server/services/settings-service";

import { executeFetchTool } from "./datasheet-fetch-tool";

let projectId: string;

beforeAll(async () => {
  const project = await prisma.project.create({ data: { name: "fetch-tool" } });
  projectId = project.id;

  await prisma.component.createMany({
    data: [
      { projectId, refDes: "U1", mpn: "AP64501SP-13" },
      { projectId, refDes: "J1", mpn: null }, // connector, no MPN
      { projectId, refDes: "U2", mpn: "QUARANTINED-PART-1" },
      { projectId, refDes: "U3", mpn: "VERIFIED-PART-1" },
    ],
  });

  await prisma.projectFile.createMany({
    data: [
      {
        projectId,
        originalName: "QUARANTINED-PART-1-datasheet.pdf",
        storedName: "q.pdf",
        path: "q.pdf",
        fileType: "application/pdf",
        category: "pdf",
        provenance: "web_fetch",
        verifyStatus: "quarantined",
        parseError: "Part number not found in the first 5 pages",
        mpn: "QUARANTINED-PART-1",
      },
      {
        projectId,
        originalName: "VERIFIED-PART-1-datasheet.pdf",
        storedName: "v.pdf",
        path: "v.pdf",
        fileType: "application/pdf",
        category: "pdf",
        provenance: "upload",
        verifyStatus: "verified",
        mpn: "VERIFIED-PART-1",
      },
    ],
  });
});

describe("fetch_datasheet guards", () => {
  it("refuses when the Settings web-fetch toggle is off", async () => {
    await updateSettings({ datasheetFetchEnabled: false });
    const out = await executeFetchTool(projectId, "fetch_datasheet", {
      refdes: "U1",
    });
    expect(out.status).toBe("disabled");
    expect(String(out.message)).toMatch(/Settings/);
    await updateSettings({ datasheetFetchEnabled: true });
  });

  it("errors on a refdes not in the netlist", async () => {
    const out = await executeFetchTool(projectId, "fetch_datasheet", {
      refdes: "U99",
    });
    expect(String(out.error)).toMatch(/not found/);
  });

  it("reports no_mpn for parts without a part number", async () => {
    const out = await executeFetchTool(projectId, "fetch_datasheet", {
      refdes: "J1",
    });
    expect(out.status).toBe("no_mpn");
  });

  it("requires a refdes or mpn", async () => {
    const out = await executeFetchTool(projectId, "fetch_datasheet", {});
    expect(String(out.error)).toMatch(/refdes or an mpn/);
  });

  it("short-circuits to 'quarantined' when the doc awaits approval", async () => {
    const out = await executeFetchTool(projectId, "fetch_datasheet", {
      refdes: "U2",
    });
    expect(out.status).toBe("quarantined");
    expect(String(out.message)).toMatch(/Files tab/);
    expect(String(out.message)).toMatch(/different from 'not on file'/);
  });

  it("short-circuits to 'already_available' for verified docs", async () => {
    const out = await executeFetchTool(projectId, "fetch_datasheet", {
      mpn: "VERIFIED-PART-1",
    });
    expect(out.status).toBe("already_available");
  });

  it("is case-insensitive on refdes", async () => {
    const out = await executeFetchTool(projectId, "fetch_datasheet", {
      refdes: "u2",
    });
    expect(out.status).toBe("quarantined");
  });
});
