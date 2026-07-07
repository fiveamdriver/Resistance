/**
 * Datasheet enrichment service.
 *
 * For each unique MPN in a project's components, searches for the part's
 * datasheet using Claude with web search, extracts key compliance specs
 * (voltage ratings, current ratings, temperature range), and caches the
 * result in MpnCache so the same part is never fetched twice across any
 * project.
 *
 * Call enrichProjectMpns(projectId) before running a design review to
 * ensure get_component_specs has data to return.
 */
import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { WebSearchTool20250305 } from "@anthropic-ai/sdk/resources/messages/messages";

import { prisma } from "@/lib/prisma";

import { getSettings } from "./settings-service";

export interface DatasheetSpecs {
  maxVoltageV: number | null;
  maxCurrentA: number | null;
  tempRangeMinC: number | null;
  tempRangeMaxC: number | null;
  componentType: string | null;
  notes: string | null;
  /**
   * Where the numbers came from (audit #2). "web_search" = Claude's reply
   * after a hosted search — unverified. "verified_pdf" = re-extracted from
   * the verified datasheet on file, with page citations. Absent on legacy
   * cache rows (treat as web_search).
   */
  specsSource?: "web_search" | "verified_pdf";
  /** 1-based pages of the verified PDF the extraction cited. */
  specPages?: number[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function makeClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "Datasheet lookup is not configured: add your Anthropic API key in Settings."
    );
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

/**
 * Use Claude with web search to find the datasheet for an MPN and extract
 * the key compliance specs. Returns null if no datasheet can be found.
 */
async function fetchSpecsFromWeb(
  client: Anthropic,
  mpn: string
): Promise<{ datasheetUrl: string | null; specs: DatasheetSpecs } | null> {
  const prompt = `Find the official datasheet for the electronic component with MPN (manufacturer part number): ${mpn}

Search for the datasheet and extract the following information. Return ONLY a JSON object with these exact fields (use null for any field you cannot find):

{
  "datasheetUrl": "the URL of the datasheet — prefer the direct PDF link over a product page",
  "maxVoltageV": <absolute maximum voltage rating in volts, as a number>,
  "maxCurrentA": <absolute maximum current rating in amps, as a number>,
  "tempRangeMinC": <minimum operating temperature in Celsius, as a number>,
  "tempRangeMaxC": <maximum operating temperature in Celsius, as a number>,
  "componentType": "<e.g. buck_regulator, capacitor, resistor, mosfet, ldo, op_amp, mcu>",
  "notes": "<any important derating notes or warnings, 1 sentence max>"
}

Return only the JSON object, no other text.`;

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      tools: [{ type: "web_search_20250305", name: "web_search" } satisfies WebSearchTool20250305],
      messages: [{ role: "user", content: prompt }],
    });
  } catch {
    return null;
  }

  // Extract the final text block — Claude will have used web search then replied
  const textBlock = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  if (!textBlock) return null;

  // Parse the JSON response
  try {
    const jsonMatch = textBlock.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    return {
      datasheetUrl: typeof parsed.datasheetUrl === "string" ? parsed.datasheetUrl : null,
      specs: {
        maxVoltageV: typeof parsed.maxVoltageV === "number" ? parsed.maxVoltageV : null,
        maxCurrentA: typeof parsed.maxCurrentA === "number" ? parsed.maxCurrentA : null,
        tempRangeMinC: typeof parsed.tempRangeMinC === "number" ? parsed.tempRangeMinC : null,
        tempRangeMaxC: typeof parsed.tempRangeMaxC === "number" ? parsed.tempRangeMaxC : null,
        componentType: typeof parsed.componentType === "string" ? parsed.componentType : null,
        notes: typeof parsed.notes === "string" ? parsed.notes : null,
        specsSource: "web_search",
      },
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Verified-PDF spec refinement (audit #2)
// ---------------------------------------------------------------------------
//
// Web-search specs are whatever the model said — unverified numbers that the
// review then treats as fact. Once a verified datasheet PDF is on file (its
// text already chunked by the ingest pipeline), re-extract the specs from
// that text with page citations and overwrite the cache. Confidence-gated:
// the extraction must confirm the document covers the MPN and produce at
// least one numeric rating, otherwise the web values stand.

/** Pages beyond this rarely hold absolute-maximum tables; cap the context. */
const REFINE_MAX_PAGE = 12;
const REFINE_MAX_CHARS = 24_000;

export interface SpecExtraction {
  specs: DatasheetSpecs;
  mpnConfirmed: boolean;
}

/**
 * Parse the extraction model's JSON reply. Pure — exported for unit tests.
 * Returns null when the reply is not usable (no JSON, wrong shapes).
 */
export function parseSpecExtraction(text: string): SpecExtraction | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    const citedPages = Array.isArray(parsed.citedPages)
      ? parsed.citedPages.filter((p): p is number => typeof p === "number" && p > 0)
      : [];

    return {
      mpnConfirmed: parsed.mpnConfirmed === true,
      specs: {
        maxVoltageV: typeof parsed.maxVoltageV === "number" ? parsed.maxVoltageV : null,
        maxCurrentA: typeof parsed.maxCurrentA === "number" ? parsed.maxCurrentA : null,
        tempRangeMinC: typeof parsed.tempRangeMinC === "number" ? parsed.tempRangeMinC : null,
        tempRangeMaxC: typeof parsed.tempRangeMaxC === "number" ? parsed.tempRangeMaxC : null,
        componentType: typeof parsed.componentType === "string" ? parsed.componentType : null,
        notes: typeof parsed.notes === "string" ? parsed.notes : null,
        specsSource: "verified_pdf",
        specPages: citedPages,
      },
    };
  } catch {
    return null;
  }
}

/** The confidence gate: only verified-MPN extractions with a number count. */
export function extractionIsConfident(extraction: SpecExtraction): boolean {
  const s = extraction.specs;
  const hasNumber =
    s.maxVoltageV != null ||
    s.maxCurrentA != null ||
    s.tempRangeMinC != null ||
    s.tempRangeMaxC != null;
  return extraction.mpnConfirmed && hasNumber;
}

/**
 * Re-extract specs for an MPN from its verified datasheet PDF and, when the
 * extraction is confident, overwrite the MpnCache entry with page-cited
 * values. Returns true when the cache was upgraded. Never throws — a failed
 * refinement leaves the existing (web-search) specs untouched.
 */
export async function refineSpecsFromVerifiedPdf(mpn: string): Promise<boolean> {
  try {
    // AI gate only: this call sends locally stored, already-verified public
    // datasheet text to the API — it performs no fetching.
    if (!(await getSettings()).aiEnabled) return false;
    if (!process.env.ANTHROPIC_API_KEY) return false;

    // Already upgraded? Done.
    const cached = await prisma.mpnCache.findUnique({ where: { mpn } });
    if (cached?.specs) {
      try {
        const specs = JSON.parse(cached.specs) as DatasheetSpecs;
        if (specs.specsSource === "verified_pdf") return false;
      } catch {
        // Unreadable specs JSON — refinement can only improve things.
      }
    }

    // Newest verified datasheet for this MPN, with early-page chunks.
    const file = await prisma.projectFile.findFirst({
      where: { mpn, verifyStatus: "verified", category: "pdf" },
      orderBy: { uploadedAt: "desc" },
      select: { id: true },
    });
    if (!file) return false;

    const chunks = await prisma.documentChunk.findMany({
      where: {
        fileId: file.id,
        OR: [{ page: null }, { page: { lte: REFINE_MAX_PAGE } }],
      },
      orderBy: { chunkIndex: "asc" },
      select: { page: true, content: true },
    });
    if (chunks.length === 0) return false;

    let text = "";
    for (const chunk of chunks) {
      const block = `[page ${chunk.page ?? "?"}]\n${chunk.content}\n\n`;
      if (text.length + block.length > REFINE_MAX_CHARS) break;
      text += block;
    }

    const client = makeClient();
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `The following is text extracted from a verified electronic component datasheet, with [page N] markers. Extract the compliance specs for MPN: ${mpn}

Return ONLY a JSON object with these exact fields (null for anything not stated in the text — do NOT guess or use outside knowledge):

{
  "mpnConfirmed": <true only if this document clearly covers ${mpn} (exact part or its family/series)>,
  "maxVoltageV": <absolute maximum voltage rating in volts, as a number>,
  "maxCurrentA": <absolute maximum current rating in amps, as a number>,
  "tempRangeMinC": <minimum operating temperature in Celsius, as a number>,
  "tempRangeMaxC": <maximum operating temperature in Celsius, as a number>,
  "componentType": "<e.g. buck_regulator, capacitor, resistor, mosfet, ldo, op_amp, mcu>",
  "notes": "<any important derating notes or warnings, 1 sentence max>",
  "citedPages": [<the page numbers the values above came from>]
}

Datasheet text:
${text}`,
        },
      ],
    });

    const reply = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const extraction = parseSpecExtraction(reply);
    if (!extraction || !extractionIsConfident(extraction)) return false;

    await prisma.mpnCache.upsert({
      where: { mpn },
      update: {
        status: "complete",
        specs: JSON.stringify(extraction.specs),
        error: null,
        fetchedAt: new Date(),
      },
      create: {
        mpn,
        status: "complete",
        specs: JSON.stringify(extraction.specs),
        fetchedAt: new Date(),
      },
    });
    return true;
  } catch (err) {
    console.error(`[datasheet] verified-PDF refinement failed for ${mpn}:`, err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch and cache datasheet specs for a single MPN.
 * Safe to call concurrently — checks cache first, writes atomically.
 * Returns the cache row after completion.
 */
export async function enrichMpn(mpn: string): Promise<void> {
  // Enrichment sends the MPN to the Anthropic API and performs hosted web
  // searches — both settings toggles must allow it.
  const { aiEnabled, datasheetFetchEnabled } = await getSettings();
  if (!aiEnabled || !datasheetFetchEnabled) return;

  // Skip if already complete
  const existing = await prisma.mpnCache.findUnique({ where: { mpn } });
  if (existing?.status === "complete") return;

  const client = makeClient();
  const result = await fetchSpecsFromWeb(client, mpn);

  if (!result) {
    await prisma.mpnCache.upsert({
      where: { mpn },
      update: { status: "missing_datasheet", error: "No datasheet found", fetchedAt: new Date() },
      create: { mpn, status: "missing_datasheet", error: "No datasheet found", fetchedAt: new Date() },
    });
    return;
  }

  await prisma.mpnCache.upsert({
    where: { mpn },
    update: {
      status: "complete",
      datasheetUrl: result.datasheetUrl,
      specs: JSON.stringify(result.specs),
      error: null,
      fetchedAt: new Date(),
    },
    create: {
      mpn,
      status: "complete",
      datasheetUrl: result.datasheetUrl,
      specs: JSON.stringify(result.specs),
      fetchedAt: new Date(),
    },
  });

  // A verified PDF for this part may already be on file (tier-2 design-link
  // ingestion at upload time). If so, immediately upgrade the fresh
  // web-search numbers to page-cited values. Cheap no-op when there is no
  // verified document. Fresh-fetch path only — cache hits above never retry,
  // so a failed refinement costs at most one attempt per fetch/ingest event.
  await refineSpecsFromVerifiedPdf(mpn);
}

/**
 * Enrich all un-cached MPNs found in a project's components.
 * Runs sequentially to avoid parallel API hammering. Already-complete
 * entries are skipped in < 1ms (single DB lookup).
 */
export async function enrichProjectMpns(projectId: string): Promise<void> {
  const components = await prisma.component.findMany({
    where: { projectId, mpn: { not: null } },
    select: { mpn: true },
  });

  const uniqueMpns = [
    ...new Set(components.map((c) => c.mpn).filter((m): m is string => m !== null)),
  ];

  for (const mpn of uniqueMpns) {
    await enrichMpn(mpn);
  }
}

/**
 * Look up cached specs for a single MPN. Returns null if the MPN has not
 * been enriched yet or if enrichment failed.
 */
export async function getCachedSpecs(
  mpn: string
): Promise<{ datasheetUrl: string | null; specs: DatasheetSpecs } | null> {
  const entry = await prisma.mpnCache.findUnique({ where: { mpn } });
  if (!entry || entry.status !== "complete" || !entry.specs) return null;

  try {
    return {
      datasheetUrl: entry.datasheetUrl ?? null,
      specs: JSON.parse(entry.specs) as DatasheetSpecs,
    };
  } catch {
    return null;
  }
}
