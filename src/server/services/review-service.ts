/**
 * Design-review domain service.
 *
 * Runs an LLM tool-use loop over a project's parsed netlist/BOM (via board-tools)
 * plus deterministic EE calc tools, then persists the structured findings as a
 * ReviewRun. This is the generic, non-proprietary core of an automated schematic
 * review: discover functional blocks, identify topologies, verify passive values
 * quantitatively, and report action items with severities.
 *
 * Note: findings about connectivity/values are grounded in tool results. Findings
 * that rely on part knowledge not present in the data are required to be marked
 * "verify" (see system prompt) — the engine never asserts unverified specs as fact.
 */
import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { boardTools, executeBoardTool } from "@/lib/board-tools";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { parseSubmitReview } from "@/lib/review-parse";
import {
  calcTools,
  executeCalcTool,
  SUBMIT_REVIEW_TOOL_NAME,
  submitReviewTool,
} from "@/lib/review-tools";
import type { ReviewResult } from "@/lib/review-types";

import { assertProjectExists } from "./project-service";
import { enrichProjectMpns } from "./datasheet-service";
import { ingestWebFetchedDatasheets } from "./ingest-service";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_ROUNDS = 10;

const CALC_TOOL_NAMES = new Set(calcTools.map((t) => t.name));

const SYSTEM_PROMPT = `\
You are an automated schematic design-review engine for a single PCB project. \
You produce an action-item report for a staff/principal EE to act on.

WORKFLOW:
1. Orient with get_project_summary, then list_nets / list_components.
2. Group components into functional blocks (e.g. "Power", "LO Synthesizer", \
"LNA Chain", "Clock Distribution") from connectivity and part types.
3. For each block, identify interface topologies (LVPECL/LVDS Thevenin termination, \
AC-coupled single-ended, bias networks, filters) and VERIFY passive values using the \
calc tools: AC-coupling cap reactance at the signal frequency, termination parallel \
impedance vs the line impedance (assume 50Ω unless data says otherwise), divider/bias \
set-points. Always parse_value before a reactance calc; never do unit math yourself.
4. For ICs, regulators, MOSFETs, capacitors, and diodes: call get_component_specs(refdes) \
to retrieve datasheet-sourced ratings. When specs are available, perform compliance checks:
   - Voltage derating: flag if a net voltage exceeds 80% of the component's maxVoltageV \
(possible_bug if quantitative evidence; verify if net voltage is inferred).
   - Current derating: flag if estimated current exceeds 80% of maxCurrentA.
   - Temperature: flag if the board's operating range falls outside the component's \
tempRangeMinC–tempRangeMaxC.
   When get_component_specs returns { available: false }, fall back to marking the finding \
"verify" and noting that datasheet confirmation is needed.
5. Check common issues: missing decoupling/bypass on supply pins, unconnected/floating \
pins, single-point-of-failure parts, BOM/netlist mismatches.

GROUNDING RULES — no exceptions:
- Every board fact (refdes, net, value) must come from a tool result, cited verbatim.
- An empty/absent result means "not in the parsed data," NOT "absent on the board." \
Flag such cases as severity "verify", never "possible_bug".
- Datasheet specs from get_component_specs are sourced from web search and may contain \
errors — always cite the spec value and flag high-stakes findings (possible_bug) for \
human hardware review (set hwReviewRequired: true).
- If an operating frequency is needed but not determinable from the data, state the \
assumption you used (or mark "verify").

SEVERITY: possible_bug (quantitative evidence of a likely defect) | verify (needs human \
or datasheet confirmation) | watch (worth monitoring) | minor | cosmetic | ok.

Finish by calling submit_review EXACTLY ONCE with all findings. Each finding names the \
refdes it concerns and gives a concrete, quantitative rationale where possible.`;

export interface RunReviewOptions {
  model?: string;
}

/**
 * Run a design review and persist it. Returns the saved run id and the result.
 * Throws AppError on misconfiguration (missing API key) so the route can map it.
 */
export async function runReview(
  projectId: string,
  options: RunReviewOptions = {}
): Promise<{ reviewRunId: string; result: ReviewResult }> {
  await assertProjectExists(projectId);

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AppError(
      "PARSE_ERROR",
      "AI review is not configured: set ANTHROPIC_API_KEY in your environment."
    );
  }

  // Pre-fetch datasheets for all MPNs in the project so get_component_specs
  // has data to return. Skips already-cached entries (< 1ms each). Errors
  // inside enrichProjectMpns are swallowed per-MPN — the review proceeds with
  // whatever specs are available, falling back to "verify" severity for parts
  // whose datasheets could not be fetched.
  await enrichProjectMpns(projectId).catch(() => {});

  // Tier-3 document ingestion: the enrichment pass just found datasheet URLs;
  // pull the full PDFs into the searchable library in the background so
  // search_documents can ground this and future reviews. Never blocks or
  // fails the review.
  void ingestWebFetchedDatasheets(projectId).catch(() => {});

  const model = options.model || DEFAULT_MODEL;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const tools = [...boardTools, ...calcTools, submitReviewTool];

  const messages: Anthropic.Messages.MessageParam[] = [
    {
      role: "user",
      content:
        "Review this project's schematic for design risks. Use the tools to inspect the netlist and BOM, verify passive values, then submit your findings.",
    },
  ];

  let result: ReviewResult | null = null;

  for (let round = 0; round < MAX_ROUNDS && !result; round++) {
    // On the last allowed round, force the model to submit what it has.
    const forceSubmit = round === MAX_ROUNDS - 1;

    const resp = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      tool_choice: forceSubmit
        ? { type: "tool", name: SUBMIT_REVIEW_TOOL_NAME }
        : { type: "auto" },
      messages,
    });

    const toolUses = resp.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
    );

    // Model replied with prose but no tool call — nudge it toward submitting.
    if (toolUses.length === 0) {
      messages.push({ role: "assistant", content: resp.content });
      messages.push({
        role: "user",
        content: "Call submit_review now to record your findings.",
      });
      continue;
    }

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const block of toolUses) {
      if (block.name === SUBMIT_REVIEW_TOOL_NAME) {
        result = parseSubmitReview(block.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: "Review recorded.",
        });
        continue;
      }

      const output = CALC_TOOL_NAMES.has(block.name)
        ? executeCalcTool(block.name, block.input as Record<string, unknown>)
        : await executeBoardTool(
            projectId,
            block.name,
            block.input as Record<string, unknown>
          );

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(output),
      });
    }

    messages.push({ role: "assistant", content: resp.content });
    messages.push({ role: "user", content: toolResults });
  }

  if (!result) {
    throw new AppError(
      "PARSE_ERROR",
      "The reviewer did not return findings. Please try again."
    );
  }

  // Persist the run and its findings in one transaction-like create.
  const run = await prisma.reviewRun.create({
    data: {
      projectId,
      status: "completed",
      model,
      summary: result.summary || null,
      findings: {
        create: result.findings.map((f) => ({
          block: f.block,
          severity: f.severity,
          title: f.title,
          rationale: f.rationale,
          refDes: f.refDes.join(", "),
          hwReviewRequired: f.hwReviewRequired,
        })),
      },
    },
  });

  return { reviewRunId: run.id, result };
}

/** The most recent review run for a project, with its findings. */
export async function getLatestReview(projectId: string) {
  return prisma.reviewRun.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: { findings: true },
  });
}
