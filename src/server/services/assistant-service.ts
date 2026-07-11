/**
 * AI-assistant domain service: persistent conversations + server-side turns.
 *
 * Chat history lives in the database (Conversation / ChatMessage), so it
 * survives tab switches and app restarts and populates the sidebar. A reply
 * is generated inside the POST that sent the message: the assistant row is
 * created as "pending", the tool-use loop runs server-side, and the row
 * flips to "complete"/"failed" when it settles. The UI polls the
 * conversation, so navigating away never loses a reply in flight.
 *
 * The grounding contract lives in SYSTEM_PROMPT — moved verbatim from the
 * old route, which previously held both the prompt and the loop.
 */
import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { boardTools, executeBoardTool } from "@/lib/board-tools";
import {
  executeFetchTool,
  FETCH_TOOL_NAMES,
  fetchTools,
} from "@/lib/datasheet-fetch-tool";
import {
  EE_TOOL_NAMES,
  eeTools,
  executeEeTool,
} from "@/lib/ee-assistant-tools";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/server/services/settings-service";

const MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ROUNDS = 6;

/**
 * Cap the history forwarded to the API (~12 turns). Without this, long chats
 * grow input cost linearly and without bound. The window must still start
 * with a user turn, so leading assistant messages left by the slice drop.
 */
const MAX_HISTORY_MESSAGES = 24;

/** A pending reply older than this with no live progress is a crashed run. */
const PENDING_STALE_MS = 10 * 60 * 1000;

/** Sidebar label: the first user message, truncated. */
const TITLE_MAX_CHARS = 64;

// ── system prompt — grounding contract ──────────────────────────────────────

const SYSTEM_PROMPT = `\
You are a board-level EE query engine for a specific PCB project. \
The reader is a staff or principal engineer. Be terse, accurate, and technical. \
Lead with the answer. Report refdes and net names verbatim, uppercase.

FORMAT. Answers render as GitHub-flavored markdown. When reporting three or \
more parallel facts (components on a rail, pin connections, BOM rows, \
placements, zone lists), use a GFM table with concise headers. Use plain \
sentences for single facts. Never draw ASCII-art diagrams with box-drawing \
characters or arrows — use a table or a nested list instead.

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
Distinguish three different "nothing found" cases — never conflate them: \
(1) SEARCH MISSED: a search_documents call returned zero results. That means \
no keyword match, not that the information is absent — the document may word \
it differently. Retry with alternative technical terms or synonyms. \
(2) DATASHEET NOT INGESTED: if reworded searches still find nothing for a \
part-specific question, call fetch_datasheet(refdes or mpn) to retrieve and \
index the part's datasheet, then re-run search_documents. If it returns \
'quarantined', tell the user the datasheet is on file awaiting their one-click \
approval in the Files tab — that is NOT the same as "not on file". \
(3) SEARCHED AND ABSENT: only after reworded searches AND a fetch_datasheet \
attempt come up empty may you say the information is not on file — then say \
so plainly and suggest uploading the datasheet. Do not fill the gap from \
memory in any case.

I. PHYSICAL LAYOUT. Placement and board-geometry facts come ONLY from \
get_board_dimensions, get_placement, and nearest_components (parsed from the \
.kicad_pcb). Report positions in mm with the layer (F.Cu = top, B.Cu = bottom) \
and distances in mm. The netlist has no layout — never infer placement, board \
size, spacing, or plane coverage from the schematic. If a layout tool returns \
{ available: false }, say no board layout has been parsed and suggest syncing a \
KiCad project that includes a .kicad_pcb.`;

// ── Live progress (in-memory, per conversation) ─────────────────────────────
// Same pattern as review-service: the UI polls GET for this so it can show
// what the assistant is doing and re-attach after a tab switch.

export interface AssistantProgress {
  phase: string;
  toolCalls: number;
  startedAt: number;
}

const progressByConversation = new Map<string, AssistantProgress>();

export function getAssistantProgress(
  conversationId: string
): AssistantProgress | null {
  return progressByConversation.get(conversationId) ?? null;
}

function phaseForTools(names: string[]): string {
  if (names.some((n) => FETCH_TOOL_NAMES.has(n))) return "Fetching a datasheet";
  if (names.some((n) => n === "search_documents"))
    return "Searching project documents";
  if (names.some((n) => n === "get_component_specs"))
    return "Checking component specs";
  if (names.some((n) => EE_TOOL_NAMES.has(n))) return "Running EE calculations";
  return "Inspecting the board data";
}

// ── Conversation queries ─────────────────────────────────────────────────────

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string; // ISO
}

export async function listConversations(
  projectId: string
): Promise<ConversationSummary[]> {
  const rows = await prisma.conversation.findMany({
    where: { projectId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, updatedAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export interface ChatMessageVM {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "complete" | "pending" | "failed";
  error: string | null;
  createdAt: string; // ISO
}

export interface ConversationDetail {
  id: string;
  title: string;
  messages: ChatMessageVM[];
  /** True while an assistant reply is generating server-side. */
  pending: boolean;
  progress: AssistantProgress | null;
}

export async function getConversation(
  projectId: string,
  conversationId: string
): Promise<ConversationDetail> {
  const convo = await prisma.conversation.findFirst({
    where: { id: conversationId, projectId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!convo) throw new AppError("NOT_FOUND", "Conversation not found");

  // Reap a pending reply whose run died with the server: old row, no live
  // progress entry. Without this the UI would show "thinking" forever.
  for (const m of convo.messages) {
    if (
      m.status === "pending" &&
      !progressByConversation.has(conversationId) &&
      Date.now() - m.createdAt.getTime() > PENDING_STALE_MS
    ) {
      await prisma.chatMessage.update({
        where: { id: m.id },
        data: {
          status: "failed",
          error:
            "Reply was interrupted (server stopped mid-answer). Ask again.",
        },
      });
      m.status = "failed";
      m.error = "Reply was interrupted (server stopped mid-answer). Ask again.";
    }
  }

  const pending = convo.messages.some((m) => m.status === "pending");
  return {
    id: convo.id,
    title: convo.title,
    messages: convo.messages.map((m) => ({
      id: m.id,
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
      status:
        m.status === "pending" || m.status === "failed" ? m.status : "complete",
      error: m.error,
      createdAt: m.createdAt.toISOString(),
    })),
    pending,
    progress: pending ? getAssistantProgress(conversationId) : null,
  };
}

export async function deleteConversation(
  projectId: string,
  conversationId: string
): Promise<void> {
  // deleteMany so a stale id (or wrong project) is a no-op, not a crash.
  await prisma.conversation.deleteMany({
    where: { id: conversationId, projectId },
  });
}

// ── Sending a message ────────────────────────────────────────────────────────

function capHistory(
  messages: Anthropic.Messages.MessageParam[]
): Anthropic.Messages.MessageParam[] {
  const recent = messages.slice(-MAX_HISTORY_MESSAGES);
  const firstUser = recent.findIndex((m) => m.role === "user");
  return firstUser === -1 ? [] : recent.slice(firstUser);
}

export interface SendResult {
  conversationId: string;
  reply: ChatMessageVM;
}

/**
 * Append a user message (creating the conversation on first send) and
 * generate the assistant reply server-side. The reply row is "pending" for
 * the duration, so pollers see the turn regardless of what the client does.
 */
export async function sendMessage(
  projectId: string,
  conversationId: string | null,
  text: string
): Promise<SendResult> {
  const question = text.trim();
  if (!question) throw new AppError("VALIDATION_ERROR", "Message is empty");

  if (!(await getSettings()).aiEnabled) {
    throw new AppError(
      "FEATURE_DISABLED",
      "AI features are turned off in Settings. Enable them to use the assistant."
    );
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AppError(
      "PARSE_ERROR",
      "The AI assistant is not configured: add your Anthropic API key in Settings."
    );
  }

  // Find-or-create the thread, append the user turn, and claim the pending
  // assistant row in one transaction so concurrent sends can't interleave.
  const { convoId, replyId } = await prisma.$transaction(async (tx) => {
    let convoIdInner = conversationId;
    if (convoIdInner) {
      const exists = await tx.conversation.findFirst({
        where: { id: convoIdInner, projectId },
        select: { id: true },
      });
      if (!exists) throw new AppError("NOT_FOUND", "Conversation not found");
      const live = await tx.chatMessage.findFirst({
        where: { conversationId: convoIdInner, status: "pending" },
        select: { id: true },
      });
      if (live) {
        throw new AppError(
          "CHAT_BUSY",
          "The assistant is still answering the previous message."
        );
      }
    } else {
      const created = await tx.conversation.create({
        data: {
          projectId,
          title:
            question.length > TITLE_MAX_CHARS
              ? `${question.slice(0, TITLE_MAX_CHARS - 1)}…`
              : question,
        },
      });
      convoIdInner = created.id;
    }

    await tx.chatMessage.create({
      data: { conversationId: convoIdInner, role: "user", content: question },
    });
    const reply = await tx.chatMessage.create({
      data: {
        conversationId: convoIdInner,
        role: "assistant",
        content: "",
        status: "pending",
      },
    });
    // Bump the thread so the sidebar sorts by recent activity.
    await tx.conversation.update({
      where: { id: convoIdInner },
      data: { updatedAt: new Date() },
    });
    return { convoId: convoIdInner, replyId: reply.id };
  });

  const progress: AssistantProgress = {
    phase: "Thinking",
    toolCalls: 0,
    startedAt: Date.now(),
  };
  progressByConversation.set(convoId, progress);

  try {
    const answer = await generateReply(projectId, convoId, progress);
    const updated = await prisma.chatMessage.update({
      where: { id: replyId },
      data: { content: answer, status: "complete" },
    });
    return {
      conversationId: convoId,
      reply: {
        id: updated.id,
        role: "assistant",
        content: updated.content,
        status: "complete",
        error: null,
        createdAt: updated.createdAt.toISOString(),
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected assistant error";
    await prisma.chatMessage
      .update({
        where: { id: replyId },
        data: { status: "failed", error: message },
      })
      .catch(() => {});
    throw error;
  } finally {
    progressByConversation.delete(convoId);
  }
}

/** The grounded tool-use loop — unchanged behavior from the old route. */
async function generateReply(
  projectId: string,
  conversationId: string,
  progress: AssistantProgress
): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // History = completed turns of this conversation, including the user
  // message just written (its reply row is pending and carries no content).
  const rows = await prisma.chatMessage.findMany({
    where: { conversationId, status: "complete" },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });
  const history = capHistory(
    rows.map((m) => ({
      role: m.role === "user" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }))
  );
  if (history.length === 0) {
    throw new AppError("VALIDATION_ERROR", "Conversation has no user message");
  }

  const msgs: Anthropic.Messages.MessageParam[] = [...history];
  let rounds = 0;

  while (true) {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      // C1: cache the static prefix. Tools render before system, so a
      // single breakpoint on the system block caches the tool schemas
      // AND the prompt — ~90% off those input tokens on every round
      // after the first (5-min TTL).
      system: [
        {
          type: "text" as const,
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      tools: [...boardTools, ...eeTools, ...fetchTools],
      messages: msgs,
    });

    // end_turn, max_tokens, or round cap: extract the text answer.
    if (resp.stop_reason !== "tool_use" || rounds >= MAX_TOOL_ROUNDS) {
      return resp.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
    }

    const toolBlocks = resp.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
    );
    progress.phase = phaseForTools(toolBlocks.map((b) => b.name));
    progress.toolCalls += toolBlocks.length;

    const toolResults = await Promise.all(
      toolBlocks.map(async (block) => {
        const input = block.input as Record<string, unknown>;
        const result = FETCH_TOOL_NAMES.has(block.name)
          ? await executeFetchTool(projectId, block.name, input)
          : EE_TOOL_NAMES.has(block.name)
            ? await executeEeTool(projectId, block.name, input)
            : await executeBoardTool(projectId, block.name, input);
        return {
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: JSON.stringify(result),
        };
      })
    );

    msgs.push({ role: "assistant", content: resp.content });
    msgs.push({
      role: "user",
      content: toolResults as Anthropic.Messages.ToolResultBlockParam[],
    });
    progress.phase = "Thinking";
    rounds++;
  }
}
