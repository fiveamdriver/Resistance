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

import { prisma } from "@/lib/prisma";

export interface DatasheetSpecs {
  maxVoltageV: number | null;
  maxCurrentA: number | null;
  tempRangeMinC: number | null;
  tempRangeMaxC: number | null;
  componentType: string | null;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function makeClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
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
  "datasheetUrl": "the URL of the datasheet PDF or product page",
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
      tools: [{ type: "web_search_20250305" as never, name: "web_search" }],
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
      },
    };
  } catch {
    return null;
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
