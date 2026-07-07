/**
 * EE-semantics tools for the AI assistant.
 *
 * These add the *electrical* layer on top of the raw netlist/BOM tools in
 * board-tools.ts: net roles & voltage tiers, fan-out warnings, 0Ω/DNP jumpers,
 * decoupling caps, fuses, connectors, intermediate nets. Each call builds the
 * connectivity graph for the project and answers from the shared classifier.
 *
 *   eeTools        — Tool[] to concat onto the assistant's tool list
 *   EE_TOOL_NAMES  — Set used by the route to dispatch to executeEeTool
 *   executeEeTool  — runs a tool; never throws (returns { error } on failure)
 */
import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import {
  analyzeComponent,
  analyzeNet,
  summarizeTopology,
} from "@/lib/ee-graph-queries";
import { getConnectivityGraph } from "@/server/services/connectivity-service";

// ── tool definitions ──────────────────────────────────────────────────────────

export const eeTools: Anthropic.Messages.Tool[] = [
  {
    name: "get_board_topology",
    description:
      "Structural electrical overview of the board: nets grouped by role/voltage tier (high-side power, regulated rail, intermediate, signal, ground) with fan-out counts; high-fan-out nets; intermediate nets; and flagged components — 0Ω/DNP jumpers, decoupling/bypass caps, fuses, connectors. Call this first to understand the power architecture before answering design questions.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "analyze_net",
    description:
      "Electrical classification of one net: its role/voltage tier, fan-out (with a shared-impedance warning if high), the components on it, and any bypass caps. Use for questions like 'is 3V3 a power rail', 'what kind of net is SW', 'is GND high fan-out'. For the raw pin list, use get_net instead.",
    input_schema: {
      type: "object" as const,
      properties: {
        net_name: {
          type: "string",
          description: "Net name, e.g. '3V3', 'VIN', 'SW' (fuzzy-matched).",
        },
      },
      required: ["net_name"],
    },
  },
  {
    name: "analyze_component",
    description:
      "Electrical classification of one component: type (IC/capacitor/resistor/diode/fuse/connector/LED/inductor), role, whether it is a 0Ω/DNP jumper or a decoupling cap, the rail it bypasses, and its nets. Use for 'what is R7', 'is C3 a bypass cap', 'is F1 a fuse'. For raw value/footprint/MPN, use get_component instead.",
    input_schema: {
      type: "object" as const,
      properties: {
        refdes: {
          type: "string",
          description: "Reference designator, e.g. 'U1', 'R7', 'C3'.",
        },
      },
      required: ["refdes"],
    },
  },
];

export const EE_TOOL_NAMES = new Set(eeTools.map((t) => t.name));

// ── executor ──────────────────────────────────────────────────────────────────

export async function executeEeTool(
  projectId: string,
  name: string,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  try {
    const graph = await getConnectivityGraph(projectId);

    switch (name) {
      case "get_board_topology":
        return summarizeTopology(graph) as unknown as Record<string, unknown>;

      case "analyze_net": {
        const netName = input.net_name;
        if (typeof netName !== "string" || !netName.trim()) {
          return { error: "net_name is required" };
        }
        const result = analyzeNet(graph, netName);
        return result
          ? (result as unknown as Record<string, unknown>)
          : {
              error: `Net "${netName}" not found in the parsed netlist. It may not exist or was not captured in the parse.`,
            };
      }

      case "analyze_component": {
        const refdes = input.refdes;
        if (typeof refdes !== "string" || !refdes.trim()) {
          return { error: "refdes is required" };
        }
        const result = analyzeComponent(graph, refdes);
        return result
          ? (result as unknown as Record<string, unknown>)
          : {
              error: `Component "${refdes}" not found in the parsed netlist.`,
            };
      }

      default:
        return { error: `Unknown EE tool: ${name}` };
    }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "EE tool failed unexpectedly",
    };
  }
}
