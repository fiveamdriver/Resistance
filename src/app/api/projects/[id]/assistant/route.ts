/**
 * POST /api/projects/[id]/assistant
 *
 * Tier-1 grounded-retrieval AI assistant. Runs a tool-use loop against the
 * board-query tools (netlist + BOM data) and streams the final answer as
 * text/plain. All board facts must come from tool results — the system prompt
 * enforces this hard.
 *
 * Body:   { messages: Anthropic.MessageParam[] }
 * Stream: text/plain, UTF-8
 */
import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";

import { boardTools, executeBoardTool } from "@/lib/board-tools";

export const runtime = "nodejs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── system prompt — grounding contract ────────────────────────────────────────

const SYSTEM_PROMPT = `\
You are a board-level EE query engine for a specific PCB project. \
The reader is a staff or principal engineer. Be terse, accurate, and technical. \
Lead with the answer. Report refdes and net names verbatim, uppercase.

GROUNDING CONTRACT — no exceptions:

A. PROVENANCE. Every board fact must come from a tool result. \
Cite exact identifiers as returned. Format connectivity as: \
"net 3V3 — 4 pins: U1.1, U2.8, C3.1, C4.1". No claim without the refdes/pin/net that backs it.

B. ABSENT ≠ NEGATIVE. An empty result means "not found in the parsed netlist/BOM," \
not "not on the physical board." State this explicitly on every empty lookup: \
e.g. "No pull-up on SDA found in netlist; if one exists it was not captured in the parse."

C. VALUE FIDELITY. Report component values exactly as stored — never normalize "4k7" to \
"4.7k" or infer tolerance, package, or rating the data does not contain. \
A null field is "unspecified in source." Do not fill it in.

D. CONNECTIVITY BOUNDARY. "Connected" means same net per the netlist only. \
Pins on opposite sides of a component are on two different nets and are NOT \
electrically connected per topology. Never imply DC continuity through components. \
Label any inference beyond raw netlist topology as "inference — not in netlist."

E. BINARY CONFIDENCE. For board facts: it is in the data (cite the identifier) or \
it is not (say so plainly). No "probably" for data retrieval. \
Reserve hedged language only for explicit engineering judgment calls.

F. DOCUMENTS. Use search_documents to retrieve content from the project's \
verified documents (datasheets, app notes, specs). Search with specific \
technical terms or part numbers. Every claim taken from a document must cite \
the source file and page, e.g. "(LM317-datasheet.pdf, p.7)". Results carry a \
provenance label; for 'web_fetch' documents (found online by part number, \
not human-vouched), say so when citing: "per a datasheet found online for \
this part number". If search_documents returns an error, report that document \
search failed — never treat a failure as "no documents on file".

G. SPEC NUMBERS. For numeric ratings (voltage, current, temperature), prefer \
get_component_specs (structured, extraction-safe) and use document text as \
supporting context — PDF table extraction can garble numbers. If a document \
quote and get_component_specs disagree, surface the conflict explicitly; \
never silently pick one.

H. NO MODEL MEMORY FOR PARTS. Never answer questions about a specific part's \
specifications, ratings, pinout, or behavior from your own training knowledge. \
If neither get_component_specs nor search_documents has the answer, say the \
information is not on file and suggest uploading the datasheet. Absence of a \
document is an answer — do not fill the gap.`;

// ── route ─────────────────────────────────────────────────────────────────────

const MAX_TOOL_ROUNDS = 6;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;

  let body: { messages: Anthropic.Messages.MessageParam[] };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  if (!Array.isArray(body?.messages)) {
    return new Response("body.messages must be an array", { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const msgs: Anthropic.Messages.MessageParam[] = [...body.messages];
        let rounds = 0;

        while (true) {
          const resp = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 1500,
            system: SYSTEM_PROMPT,
            tools: boardTools,
            messages: msgs,
          });

          // If stop reason is end_turn, max_tokens, or we've hit the round cap:
          // extract text and close.
          if (resp.stop_reason !== "tool_use" || rounds >= MAX_TOOL_ROUNDS) {
            const text = resp.content
              .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
              .map((b) => b.text)
              .join("");
            controller.enqueue(encoder.encode(text));
            break;
          }

          // Collect all tool_use blocks and run them in parallel.
          const toolBlocks = resp.content.filter(
            (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
          );

          const toolResults = await Promise.all(
            toolBlocks.map(async (block) => {
              const result = await executeBoardTool(
                projectId,
                block.name,
                block.input as Record<string, unknown>,
              );
              return {
                type: "tool_result" as const,
                tool_use_id: block.id,
                content: JSON.stringify(result),
              };
            }),
          );

          msgs.push({ role: "assistant", content: resp.content });
          msgs.push({
            role: "user",
            content: toolResults as Anthropic.Messages.ToolResultBlockParam[],
          });
          rounds++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(`[Error: ${msg}]`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  });
}
