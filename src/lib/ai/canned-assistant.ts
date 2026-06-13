/**
 * AI assistant stub.
 *
 * Routes questions to their intended agent tool before the LLM is wired up.
 * Replace getCannedResponse() with a call to the agent runtime when ready —
 * the tool names and AssistantReply interface stay the same.
 */

/** Tool names the AI agent will expose. */
export const AGENT_TOOLS = [
  "search_component",
  "search_net",
  "get_connected_components",
  "match_bom_rows",
  "find_datasheets",
  "review_design_risks",
] as const;

export type AgentTool = (typeof AGENT_TOOLS)[number];

export interface AssistantReply {
  text: string;
  suggestedTool?: AgentTool;
}

const RESPONSE_NOT_CONFIGURED =
  "The AI assistant is not yet configured. Live answers from your design data will appear here once the LLM integration is complete.";

/** Heuristically map a question to the tool that will eventually answer it. */
function routeToTool(question: string): AgentTool | undefined {
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
  return { text: RESPONSE_NOT_CONFIGURED, suggestedTool };
}
