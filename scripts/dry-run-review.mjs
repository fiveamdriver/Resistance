/**
 * Dry run for the AI Design Review — estimates token usage and cost WITHOUT
 * calling the LLM (mirrors `analyze.py --dry-run`).
 *
 * Usage:
 *   npm run review:dry-run                 # estimates against the first project
 *   npm run review:dry-run -- <projectId>  # estimates a specific project
 *
 * The estimate is approximate (~4 chars/token). For an exact count use the
 * Anthropic count_tokens endpoint (needs ANTHROPIC_API_KEY).
 */
import { readFileSync } from "fs";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Sonnet 4.6 pricing (USD per token). Keep in sync with the review model.
const MODEL = "claude-sonnet-4-6";
const IN_RATE = 3.0 / 1e6;
const OUT_RATE = 15.0 / 1e6;
const ROUNDS = 6; // typical tool-use rounds: orient → inspect → verify → submit

const tok = (s) => Math.ceil(s.length / 4);

function staticPromptTokens() {
  // System prompt + tool schemas are resent every round (no prompt caching yet).
  const sys = readFileSync("src/server/services/review-service.ts", "utf8");
  const sysPrompt = sys.split("const SYSTEM_PROMPT = `\\\n")[1]?.split("`;")[0] ?? "";
  const boardTools = readFileSync("src/lib/board-tools.ts", "utf8");
  const reviewTools = readFileSync("src/lib/review-tools.ts", "utf8");
  // Tool *definitions* (descriptions + schemas) are roughly half the source text.
  const toolChars = Math.round(boardTools.length * 0.45 + reviewTools.length * 0.55);
  return { sysTok: tok(sysPrompt), toolsTok: Math.ceil(toolChars / 4) };
}

async function main() {
  const argId = process.argv[2];
  const project = argId
    ? await prisma.project.findUnique({ where: { id: argId } })
    : await prisma.project.findFirst({ orderBy: { createdAt: "asc" } });

  if (!project) {
    console.error(
      argId ? `No project with id ${argId}` : "No projects found. Run `npm run db:seed`."
    );
    process.exit(1);
  }

  const [components, nets, bom] = await Promise.all([
    prisma.component.findMany({ where: { projectId: project.id }, include: { pins: true } }),
    prisma.net.findMany({
      where: { projectId: project.id },
      include: { connections: { include: { pin: { include: { component: true } } } } },
    }),
    prisma.bomItem.findMany({ where: { projectId: project.id } }),
  ]);

  if (components.length === 0 && nets.length === 0) {
    console.error(
      `Project "${project.name}" has no parsed netlist/BOM yet — nothing to review. Upload a .net/.csv first.`
    );
    process.exit(1);
  }

  // Data the reviewer pulls via tools (project summary, lists, per-net/comp lookups, BOM).
  const dataPayload = JSON.stringify({
    summary: { components: components.length, nets: nets.length, bom: bom.length, netNames: nets.map((n) => n.name) },
    components: components.map((c) => ({ refdes: c.refDes, value: c.value, pins: c.pins.length })),
    nets: nets.map((n) => ({ net: n.name, pins: n.connections.map((x) => `${x.pin.component.refDes}.${x.pin.number}`) })),
    bom: bom.map((b) => ({ refdes: b.refDesRaw, mpn: b.mpn })),
  });
  const dataTok = tok(dataPayload);

  const { sysTok, toolsTok } = staticPromptTokens();
  const fixedPerRound = sysTok + toolsTok;
  const history = dataTok + 800; // tool results + assistant tool_use/reasoning

  // Input grows: fixed prompt each round + a triangular ramp of accumulated history.
  let inputTok = 0;
  for (let r = 1; r <= ROUNDS; r++) {
    inputTok += fixedPerRound + Math.round(history * (r / ROUNDS));
  }
  const outputTok = 250 * ROUNDS + 1200; // per-round tool calls + final findings JSON
  const cost = inputTok * IN_RATE + outputTok * OUT_RATE;
  const f = (n) => n.toLocaleString();

  console.log("");
  console.log("  DRY RUN — AI Design Review (no API call)");
  console.log("  ─────────────────────────────────────────");
  console.log(`  Project:   ${project.name}`);
  console.log(`  Parsed:    ${components.length} components · ${nets.length} nets · ${bom.length} BOM rows`);
  console.log(`  Model:     ${MODEL}  ($3.00/1M in · $15.00/1M out)`);
  console.log(`  Loop:      ~${ROUNDS} tool-use rounds`);
  console.log("");
  console.log(`  Static prompt + tools (per round): ~${f(fixedPerRound)} tok`);
  console.log(`  Board data pulled via tools:        ~${f(dataTok)} tok`);
  console.log("");
  console.log(`  Est. input tokens:   ~${f(inputTok)}`);
  console.log(`  Est. output tokens:  ~${f(outputTok)}`);
  console.log(`  ESTIMATED COST:      ~$${cost.toFixed(4)}`);
  console.log("");
  console.log("  Approximate (~4 chars/token). No tokens spent — this made no API call.");
  console.log("");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
