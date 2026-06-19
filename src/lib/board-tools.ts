/**
 * Anthropic tool definitions and executor for board-level queries.
 *
 * boardTools     — Tool[] to pass to messages.create({ tools })
 * executeBoardTool — dispatches a tool_use block to the matching query and
 *                    returns a plain object; never throws (returns { error }).
 */
import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import {
  getComponent,
  getNet,
  getProjectSummary,
  listComponents,
  listNets,
  searchBom,
  tracePin,
} from "@/lib/board-queries";
import { getCachedSpecs } from "@/server/services/datasheet-service";
import { prisma } from "@/lib/prisma";

// ── tool definitions ──────────────────────────────────────────────────────────

export const boardTools: Anthropic.Messages.Tool[] = [
  {
    name: "get_project_summary",
    description:
      "Return component count, net count, BOM line count, and the full net name list for the project. Use this to orient before drilling into specifics.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "list_nets",
    description:
      "Return all net names in the parsed netlist, sorted alphabetically. Use to enumerate power rails, signals, and buses.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "list_components",
    description:
      "Return all component RefDes and value fields from the parsed netlist. Value is exactly as stored; may be null if not captured in parse.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_net",
    description:
      "Look up a net by name and return every pin connected to it (refdes, pin number, component name). Accepts case-insensitive and fuzzy variants: '3.3V' matches '3V3'. Returns null if no matching net exists in the parsed data.",
    input_schema: {
      type: "object" as const,
      properties: {
        net_name: {
          type: "string",
          description: "Net name to look up, e.g. '3V3', 'GND', 'SPI_CLK'.",
        },
      },
      required: ["net_name"],
    },
  },
  {
    name: "get_component",
    description:
      "Look up a component by RefDes. Returns value, footprint, MPN (from linked BOM row if present), and every pin with its assigned net. All fields are verbatim from source; null means not present in parsed data.",
    input_schema: {
      type: "object" as const,
      properties: {
        refdes: {
          type: "string",
          description: "Reference designator, e.g. 'U1', 'R12', 'J3'.",
        },
      },
      required: ["refdes"],
    },
  },
  {
    name: "trace_pin",
    description:
      "Return the net a specific pin is on, plus all OTHER pins that share that net. Use to trace signal flow from a single pin. 'connectedTo' lists pins on the same net — not DC-continuous paths through components.",
    input_schema: {
      type: "object" as const,
      properties: {
        refdes: {
          type: "string",
          description: "Component RefDes, e.g. 'U1'.",
        },
        pin: {
          type: "string",
          description: "Pin number as a string, e.g. '1', '14', 'A3'.",
        },
      },
      required: ["refdes", "pin"],
    },
  },
  {
    name: "search_bom",
    description:
      "Search BOM rows by substring across manufacturer, MPN, RefDes, and description. Omit filter to return the full BOM. Returned values are verbatim from source.",
    input_schema: {
      type: "object" as const,
      properties: {
        filter: {
          type: "string",
          description:
            "Optional substring to match against manufacturer, MPN, RefDes, or description.",
        },
      },
    },
  },
  {
    name: "get_component_specs",
    description:
      "Return cached datasheet specs for a component's MPN: absolute max voltage (V), max current (A), operating temperature range (°C), component type, and derating notes. Returns { available: false } if no MPN is known for this component or the datasheet has not been fetched yet. Use this to ground voltage-derating, current-rating, and thermal compliance findings.",
    input_schema: {
      type: "object" as const,
      properties: {
        refdes: {
          type: "string",
          description: "Reference designator of the component, e.g. 'U1', 'C5'.",
        },
      },
      required: ["refdes"],
    },
  },
];

// ── executor ──────────────────────────────────────────────────────────────────

export async function executeBoardTool(
  projectId: string,
  name: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (name) {
    case "get_project_summary": {
      const summary = await getProjectSummary(projectId);
      return summary as unknown as Record<string, unknown>;
    }

    case "list_nets": {
      const nets = await listNets(projectId);
      return { nets, count: nets.length };
    }

    case "list_components": {
      const components = await listComponents(projectId);
      return { components, count: components.length };
    }

    case "get_net": {
      const netName = input.net_name;
      if (typeof netName !== "string" || !netName.trim()) {
        return { error: "net_name is required" };
      }
      const result = await getNet(projectId, netName);
      if (!result) {
        return {
          error: `Net "${netName}" not found in parsed netlist. The net may not exist or was not captured in the parse.`,
        };
      }
      return result as unknown as Record<string, unknown>;
    }

    case "get_component": {
      const refdes = input.refdes;
      if (typeof refdes !== "string" || !refdes.trim()) {
        return { error: "refdes is required" };
      }
      const result = await getComponent(projectId, refdes);
      if (!result) {
        return {
          error: `Component "${refdes}" not found in parsed netlist. The RefDes may not exist or was not captured in the parse.`,
        };
      }
      return result as unknown as Record<string, unknown>;
    }

    case "trace_pin": {
      const refdes = input.refdes;
      const pin = input.pin;
      if (typeof refdes !== "string" || !refdes.trim()) {
        return { error: "refdes is required" };
      }
      if (typeof pin !== "string" || !pin.trim()) {
        return { error: "pin is required" };
      }
      const result = await tracePin(projectId, refdes, pin);
      if (!result) {
        return {
          error: `Pin ${refdes}.${pin} not found in parsed netlist. Verify the RefDes and pin number.`,
        };
      }
      return result as unknown as Record<string, unknown>;
    }

    case "search_bom": {
      const filter =
        typeof input.filter === "string" && input.filter.trim()
          ? input.filter.trim()
          : undefined;
      const rows = await searchBom(projectId, filter);
      return { rows, count: rows.length };
    }

    case "get_component_specs": {
      const refdes = input.refdes;
      if (typeof refdes !== "string" || !refdes.trim()) {
        return { error: "refdes is required" };
      }
      const comp = await prisma.component.findUnique({
        where: { projectId_refDes: { projectId, refDes: refdes.trim() } },
        select: { mpn: true },
      });
      if (!comp?.mpn) {
        return { available: false, reason: "No MPN recorded for this component" };
      }
      const cached = await getCachedSpecs(comp.mpn);
      if (!cached) {
        return { available: false, reason: "Datasheet not yet fetched for MPN " + comp.mpn };
      }
      return { available: true, mpn: comp.mpn, ...cached };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
