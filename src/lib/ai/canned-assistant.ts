/**
 * Placeholder AI assistant logic (Phase 1).
 *
 * No LLM is called. This module maps a user question to a canned response and,
 * where possible, names the future agent tool that would handle it. Keeping the
 * routing here (not in the component) makes it unit-testable and makes the seam
 * for a real LLM provider obvious: replace `getCannedResponse` with a call to
 * the agent runtime, reusing the same tool names.
 */

/** Tool names the future AI agent will expose. */
export const FUTURE_TOOLS = [
  "search_component",
  "search_net",
  "get_connected_components",
  "match_bom_rows",
  "find_datasheets",
  "review_design_risks",
] as const;

export type FutureTool = (typeof FUTURE_TOOLS)[number];

export interface AssistantReply {
  text: string;
  suggestedTool?: FutureTool;
}

const NOT_CONNECTED =
  "AI assistant not connected yet. This is a Phase 1 placeholder — no LLM is wired up.";

/** Heuristically map a question to the tool that will eventually answer it. */
function routeToTool(question: string): FutureTool | undefined {
  const q = question.toLowerCase();
  if (/\bconnect|connected|connects\b/.test(q))
    return "get_connected_components";
  if (/\bnet|rail|signal|gnd|\bv\b|voltage\b/.test(q)) return "search_net";
  if (/\b[ujrcd]\d+\b|component|ic\b|part\b/.test(q)) return "search_component";
  if (/\bbom|bill of materials\b/.test(q)) return "match_bom_rows";
  if (/\bdatasheet|spec\b/.test(q)) return "find_datasheets";
  if (/\brisk|review|check\b/.test(q)) return "review_design_risks";
  return undefined;
}

export function getCannedResponse(question: string): AssistantReply {
  const trimmed = question.trim();
  if (!trimmed) {
    return { text: "Ask a question about your project to get started." };
  }

  const suggestedTool = routeToTool(trimmed);
  if (suggestedTool) {
    return {
      text: `${NOT_CONNECTED}\n\nFuture tool: ${suggestedTool}`,
      suggestedTool,
    };
  }
  return { text: NOT_CONNECTED };
}
