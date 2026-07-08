/**
 * Retrieval eval set (EMBEDDINGS_FOR_RAG.md W3).
 *
 * Question → expected-chunk pairs over realistic datasheet prose, run against
 * the real FTS5 index + searchDocuments pipeline. Covers both directions:
 *
 *  - RECALL: the false-negative classes W2/W5/W6/W1 target — stemming
 *    ("limiting" vs "limit"), qualifier words breaking AND ("maximum dropout
 *    voltage"), and vocabulary gaps (IQ vs quiescent current).
 *  - PRECISION: queries that must NOT match — nonsense terms, other parts'
 *    chunks, quarantined documents, other projects.
 *
 * This suite gates every retrieval change and is the evidence for/against
 * W4 (local embeddings). Grow it from the RetrievalLog miss log.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { ensureFtsSchema } from "@/lib/fts";
import { executeBoardTool } from "@/lib/board-tools";
import { prisma } from "@/lib/prisma";

import { searchDocuments } from "./document-service";

let projectId: string;
let otherProjectId: string;

/** Realistic datasheet prose, one retrieval target per chunk. */
const LM317_CHUNKS: Array<{ page: number; content: string }> = [
  {
    page: 1,
    content:
      "Absolute maximum ratings: input-to-output voltage differential 40 V. " +
      "Operating junction temperature range: -40°C to +125°C.",
  },
  {
    page: 2,
    content: "Dropout voltage is 1.5 V at 1 A load current.",
  },
  {
    page: 3,
    content:
      "Internal current limit: the overcurrent protection threshold is set to " +
      "2.2 A typical. Protection circuitry limits the output current during " +
      "overload conditions.",
  },
  {
    page: 4,
    content: "Quiescent current: 55 uA over the full input voltage range.",
  },
  {
    page: 5,
    content:
      "Thermal shutdown engages at a junction temperature of 165°C with 10°C " +
      "of hysteresis.",
  },
  {
    page: 6,
    content:
      "Ripple rejection is 80 dB at 120 Hz with a 10 uF adjust pin bypass " +
      "capacitor.",
  },
  {
    page: 7,
    content:
      "Inrush limiting at power-up is provided by the internal pass element " +
      "ramp.",
  },
  {
    page: 8,
    content:
      "The undervoltage lockout (UVLO) threshold is 3.8 V rising, with 200 mV " +
      "of hysteresis.",
  },
];

beforeAll(async () => {
  // Idempotent; prisma.ts kicks this off async on import, so await it here to
  // guarantee the FTS table + triggers exist before chunks are inserted.
  await ensureFtsSchema(prisma);

  const project = await prisma.project.create({ data: { name: "eval-A" } });
  projectId = project.id;
  const other = await prisma.project.create({ data: { name: "eval-B" } });
  otherProjectId = other.id;

  const lm317 = await prisma.projectFile.create({
    data: {
      projectId,
      originalName: "LM317-datasheet.pdf",
      storedName: "lm317.pdf",
      path: "lm317.pdf",
      fileType: "application/pdf",
      category: "pdf",
      provenance: "upload",
      verifyStatus: "verified",
    },
  });
  const max232 = await prisma.projectFile.create({
    data: {
      projectId,
      originalName: "MAX232-datasheet.pdf",
      storedName: "max232.pdf",
      path: "max232.pdf",
      fileType: "application/pdf",
      category: "pdf",
      provenance: "web_fetch",
      verifyStatus: "verified",
    },
  });
  const quarantined = await prisma.projectFile.create({
    data: {
      projectId,
      originalName: "unverified.pdf",
      storedName: "unverified.pdf",
      path: "unverified.pdf",
      fileType: "application/pdf",
      category: "pdf",
      provenance: "web_fetch",
      verifyStatus: "quarantined",
    },
  });

  await prisma.documentChunk.createMany({
    data: [
      ...LM317_CHUNKS.map((c, i) => ({
        projectId,
        fileId: lm317.id,
        chunkIndex: i,
        page: c.page,
        content: c.content,
      })),
      {
        projectId,
        fileId: max232.id,
        chunkIndex: 0,
        page: 1,
        content:
          "The MAX232 operates from a single 5V supply and includes dual " +
          "charge pumps.",
      },
      // Quarantined content must never be retrievable (trust gate).
      {
        projectId,
        fileId: quarantined.id,
        chunkIndex: 0,
        page: 1,
        content: "The zorbtrap-spec parameter is 42 units.",
      },
      // Another project's content must never leak across projects.
      {
        projectId: otherProjectId,
        fileId: null,
        chunkIndex: 0,
        page: null,
        content: "The crossproject-secret coefficient is 7.",
      },
    ],
  });
});

const contents = (r: Awaited<ReturnType<typeof searchDocuments>>) =>
  r.results.map((x) => x.content).join(" | ");

// ── Recall: exact wording (baseline — must stay strict) ─────────────────────

describe("strict matching (baseline)", () => {
  it("finds an exact phrase", async () => {
    const r = await searchDocuments(projectId, "thermal shutdown");
    expect(r.strategy).toBe("strict");
    expect(r.results[0].content).toContain("Thermal shutdown");
    expect(r.results[0].page).toBe(5);
  });

  it("finds a part number", async () => {
    const r = await searchDocuments(projectId, "MAX232");
    expect(r.strategy).toBe("strict");
    expect(r.results).toHaveLength(1);
    expect(r.results[0].fileName).toBe("MAX232-datasheet.pdf");
  });

  it("carries citation fields: file, page, provenance", async () => {
    const r = await searchDocuments(projectId, "UVLO");
    expect(r.results[0].fileName).toBe("LM317-datasheet.pdf");
    expect(r.results[0].page).toBe(8);
    expect(r.results[0].provenance).toBe("upload");
  });
});

// ── Recall: W5 (porter stemming) ─────────────────────────────────────────────

describe("stemming (W5)", () => {
  it("matches 'inrush limit' against 'Inrush limiting' — strict", async () => {
    const r = await searchDocuments(projectId, "inrush limit");
    expect(r.strategy).toBe("strict");
    expect(contents(r)).toContain("Inrush limiting");
  });

  it("matches 'current limiting' against 'current limit'", async () => {
    const r = await searchDocuments(projectId, "current limiting");
    expect(r.strategy).toBe("strict");
    expect(contents(r)).toContain("overcurrent protection threshold");
  });
});

// ── Recall: W6 (qualifier words must not break the match) ────────────────────

describe("relaxed OR fallback (W6)", () => {
  it("'maximum dropout voltage' finds the dropout chunk (no 'maximum' in it)", async () => {
    const r = await searchDocuments(projectId, "maximum dropout voltage");
    expect(r.strategy).toBe("relaxed");
    expect(contents(r)).toContain("Dropout voltage is 1.5 V");
  });

  it("'typical quiescent current' finds the IQ chunk (no 'typical' in it)", async () => {
    const r = await searchDocuments(projectId, "typical quiescent current");
    expect(r.strategy).toBe("relaxed");
    expect(contents(r)).toContain("Quiescent current: 55 uA");
  });

  it("'OCP threshold' reaches the overcurrent chunk via the shared term", async () => {
    const r = await searchDocuments(projectId, "OCP threshold");
    expect(r.results.length).toBeGreaterThan(0);
    expect(contents(r)).toContain("overcurrent protection threshold");
  });
});

// ── Recall: W1 (synonym fallback) ────────────────────────────────────────────

describe("synonym fallback (W1)", () => {
  it("'IQ' finds the quiescent-current chunk", async () => {
    const r = await searchDocuments(projectId, "IQ");
    expect(r.strategy).toBe("synonyms");
    expect(contents(r)).toContain("Quiescent current");
  });

  it("'TSD' finds the thermal-shutdown chunk", async () => {
    const r = await searchDocuments(projectId, "TSD");
    expect(r.strategy).toBe("synonyms");
    expect(contents(r)).toContain("Thermal shutdown");
  });

  it("'PSRR' finds the ripple-rejection chunk", async () => {
    const r = await searchDocuments(projectId, "PSRR");
    expect(r.strategy).toBe("synonyms");
    expect(contents(r)).toContain("Ripple rejection");
  });
});

// ── Precision: what must NOT match ───────────────────────────────────────────

describe("precision", () => {
  it("nonsense query returns nothing even after every fallback", async () => {
    const r = await searchDocuments(projectId, "blockchain consensus");
    expect(r.results).toHaveLength(0);
  });

  it("a part-number query does not drag in other parts' chunks", async () => {
    const r = await searchDocuments(projectId, "MAX232 supply");
    expect(r.strategy).toBe("strict");
    expect(r.results.every((x) => x.fileName === "MAX232-datasheet.pdf")).toBe(
      true,
    );
  });

  it("quarantined documents are never searchable (trust gate)", async () => {
    const r = await searchDocuments(projectId, "zorbtrap-spec");
    expect(r.results).toHaveLength(0);
  });

  it("other projects' chunks never leak in", async () => {
    const missed = await searchDocuments(projectId, "crossproject-secret");
    expect(missed.results).toHaveLength(0);
    const hit = await searchDocuments(otherProjectId, "crossproject-secret");
    expect(hit.results).toHaveLength(1);
  });
});

// ── Tool contract (W2): what the model actually sees ─────────────────────────

describe("search_documents tool contract (W2)", () => {
  it("empty results carry the retry hint, never a bare empty list", async () => {
    const out = (await executeBoardTool(projectId, "search_documents", {
      query: "flux hoverboard gigawatts",
    })) as Record<string, unknown>;
    expect(out.count).toBe(0);
    expect(String(out.hint)).toMatch(/different wording|wording may differ/i);
    expect(String(out.hint)).toMatch(/NOT evidence/);
  });

  it("successful results report which match strategy was used", async () => {
    const out = (await executeBoardTool(projectId, "search_documents", {
      query: "thermal shutdown",
    })) as Record<string, unknown>;
    expect(out.count).toBeGreaterThan(0);
    expect(out.searchStrategy).toBe("strict");
  });
});

// ── W1 feedback loop: misses are logged locally ──────────────────────────────

describe("retrieval miss log (W1)", () => {
  it("zero-hit searches land in RetrievalLog", async () => {
    const query = `unmatched-${Date.now()}`;
    await searchDocuments(projectId, query);
    // The log write is fire-and-forget; poll briefly.
    let row = null;
    for (let i = 0; i < 20 && !row; i++) {
      row = await prisma.retrievalLog.findFirst({ where: { query } });
      if (!row) await new Promise((res) => setTimeout(res, 50));
    }
    expect(row).not.toBeNull();
    expect(row!.hits).toBe(0);
    expect(row!.projectId).toBe(projectId);
  });
});
