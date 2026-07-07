/**
 * Verified-PDF spec refinement (audit finding #2): extraction parsing, the
 * confidence gate, and refineSpecsFromVerifiedPdf's guard rails. The happy
 * path's LLM call needs the network; everything up to and around it is
 * covered here, including "API failure leaves web specs untouched".
 */
import { beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import {
  extractionIsConfident,
  parseSpecExtraction,
  refineSpecsFromVerifiedPdf,
} from "./datasheet-service";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
});

describe("parseSpecExtraction", () => {
  it("parses a well-formed extraction with page citations", () => {
    const parsed = parseSpecExtraction(
      `Here you go:\n{"mpnConfirmed": true, "maxVoltageV": 6.5, "maxCurrentA": null, "tempRangeMinC": -40, "tempRangeMaxC": 125, "componentType": "ldo", "notes": "Derate above 85C", "citedPages": [1, 3]}`
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.mpnConfirmed).toBe(true);
    expect(parsed!.specs.maxVoltageV).toBe(6.5);
    expect(parsed!.specs.specsSource).toBe("verified_pdf");
    expect(parsed!.specs.specPages).toEqual([1, 3]);
  });

  it("rejects garbage and wrong shapes", () => {
    expect(parseSpecExtraction("no json here")).toBeNull();
    const wrongTypes = parseSpecExtraction(
      `{"mpnConfirmed": "yes", "maxVoltageV": "6.5V", "citedPages": ["one"]}`
    );
    expect(wrongTypes!.mpnConfirmed).toBe(false);
    expect(wrongTypes!.specs.maxVoltageV).toBeNull();
    expect(wrongTypes!.specs.specPages).toEqual([]);
  });
});

describe("extractionIsConfident", () => {
  const base = {
    maxVoltageV: null,
    maxCurrentA: null,
    tempRangeMinC: null,
    tempRangeMaxC: null,
    componentType: null,
    notes: null,
  };

  it("requires a confirmed MPN AND at least one numeric rating", () => {
    expect(
      extractionIsConfident({ mpnConfirmed: true, specs: { ...base, maxVoltageV: 6 } })
    ).toBe(true);
    expect(
      extractionIsConfident({ mpnConfirmed: false, specs: { ...base, maxVoltageV: 6 } })
    ).toBe(false);
    expect(
      extractionIsConfident({ mpnConfirmed: true, specs: { ...base, componentType: "ldo" } })
    ).toBe(false);
  });
});

describe("refineSpecsFromVerifiedPdf guard rails", () => {
  it("returns false when no verified datasheet exists for the MPN", async () => {
    expect(await refineSpecsFromVerifiedPdf("NO-SUCH-PART-1")).toBe(false);
  });

  it("returns false and leaves web specs untouched when the API call fails", async () => {
    const project = await prisma.project.create({ data: { name: "refine-test" } });
    const mpn = "TEST-PART-42";

    const webSpecs = JSON.stringify({
      maxVoltageV: 99,
      maxCurrentA: null,
      tempRangeMinC: null,
      tempRangeMaxC: null,
      componentType: "ldo",
      notes: null,
      specsSource: "web_search",
    });
    await prisma.mpnCache.create({
      data: { mpn, status: "complete", specs: webSpecs, fetchedAt: new Date() },
    });

    // A verified datasheet with indexed chunks — the refine call gets all the
    // way to the API, which rejects the bogus key.
    const file = await prisma.projectFile.create({
      data: {
        projectId: project.id,
        originalName: `${mpn}-datasheet.pdf`,
        storedName: "x.pdf",
        path: "x.pdf",
        fileType: "application/pdf",
        category: "pdf",
        verifyStatus: "verified",
        mpn,
      },
    });
    await prisma.documentChunk.create({
      data: {
        projectId: project.id,
        fileId: file.id,
        chunkIndex: 0,
        page: 1,
        content: "Absolute maximum supply voltage: 6.5 V",
      },
    });

    expect(await refineSpecsFromVerifiedPdf(mpn)).toBe(false);
    const cache = await prisma.mpnCache.findUniqueOrThrow({ where: { mpn } });
    expect(cache.specs).toBe(webSpecs);
  });

  it("returns false without an API attempt when specs are already verified_pdf", async () => {
    const mpn = "ALREADY-VERIFIED-7";
    await prisma.mpnCache.create({
      data: {
        mpn,
        status: "complete",
        specs: JSON.stringify({ maxVoltageV: 6.5, specsSource: "verified_pdf" }),
        fetchedAt: new Date(),
      },
    });
    expect(await refineSpecsFromVerifiedPdf(mpn)).toBe(false);
  });

  it("returns false when AI features are disabled", async () => {
    await prisma.appSetting.upsert({
      where: { key: "aiEnabled" },
      update: { value: "false" },
      create: { key: "aiEnabled", value: "false" },
    });
    try {
      expect(await refineSpecsFromVerifiedPdf("ANY-PART")).toBe(false);
    } finally {
      await prisma.appSetting.update({
        where: { key: "aiEnabled" },
        data: { value: "true" },
      });
    }
  });
});
