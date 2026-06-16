/**
 * Anthropic tools for the design-review agent.
 *
 * Two groups:
 *   calcTools       — deterministic EE math (reactance, parallel R, dividers, value
 *                     parsing) so quantitative findings are computed, not guessed.
 *   submitReviewTool — the structured-output channel: the model calls this exactly
 *                     once at the end to emit findings in a known shape.
 *
 * Data-access tools (get_net, get_component, …) are reused from board-tools.ts;
 * the review service concatenates all three groups.
 */
import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import {
  capacitiveReactance,
  inductiveReactance,
  parallelResistance,
  parseEngineeringValue,
  voltageDivider,
} from "@/lib/ee-calcs";
import { SEVERITIES } from "@/lib/review-types";

// ── deterministic calculation tools ────────────────────────────────────────────

export const calcTools: Anthropic.Messages.Tool[] = [
  {
    name: "parse_value",
    description:
      "Convert an engineering-notation value string to an SI base-unit number (farads/henries/ohms). Handles '100nF', '4k7', '1.8pF', '150'. Returns null for ranges like '4-6nH' or unparseable text. Always use this before a reactance calc — do not convert units yourself.",
    input_schema: {
      type: "object" as const,
      properties: {
        value: { type: "string", description: "e.g. '100nF', '4k7', '1.8pF'." },
      },
      required: ["value"],
    },
  },
  {
    name: "capacitive_reactance",
    description:
      "Capacitive reactance Xc = 1/(2πfC) in ohms. Use to check whether an AC-coupling/DC-block cap is low-impedance, or a bypass cap effective, at the signal frequency.",
    input_schema: {
      type: "object" as const,
      properties: {
        capacitance_farads: {
          type: "number",
          description: "Capacitance in farads.",
        },
        frequency_hz: { type: "number", description: "Frequency in hertz." },
      },
      required: ["capacitance_farads", "frequency_hz"],
    },
  },
  {
    name: "inductive_reactance",
    description:
      "Inductive reactance Xl = 2πfL in ohms. Use to check choke/ferrite/shunt-inductor impedance at frequency.",
    input_schema: {
      type: "object" as const,
      properties: {
        inductance_henries: {
          type: "number",
          description: "Inductance in henries.",
        },
        frequency_hz: { type: "number", description: "Frequency in hertz." },
      },
      required: ["inductance_henries", "frequency_hz"],
    },
  },
  {
    name: "parallel_resistance",
    description:
      "Parallel resistance (R1·R2)/(R1+R2) in ohms. Use to compute the Thevenin/parallel impedance of a termination network and compare it to the line impedance (e.g. 50Ω).",
    input_schema: {
      type: "object" as const,
      properties: {
        r1_ohms: { type: "number", description: "First resistor in ohms." },
        r2_ohms: { type: "number", description: "Second resistor in ohms." },
      },
      required: ["r1_ohms", "r2_ohms"],
    },
  },
  {
    name: "voltage_divider",
    description:
      "Resistive divider output Vout = Vin·Rbottom/(Rtop+Rbottom). Use to verify bias points, feedback set-points, and Thevenin termination voltages.",
    input_schema: {
      type: "object" as const,
      properties: {
        vin_volts: { type: "number", description: "Input/supply voltage." },
        r_top_ohms: {
          type: "number",
          description: "Top (to Vin) resistor in ohms.",
        },
        r_bottom_ohms: {
          type: "number",
          description: "Bottom (to GND) resistor in ohms.",
        },
      },
      required: ["vin_volts", "r_top_ohms", "r_bottom_ohms"],
    },
  },
];

/** Execute a calc tool. Never throws — returns { error } on bad input. */
export function executeCalcTool(
  name: string,
  input: Record<string, unknown>
): Record<string, unknown> {
  const num = (key: string): number | null =>
    typeof input[key] === "number" && Number.isFinite(input[key])
      ? (input[key] as number)
      : null;

  try {
    switch (name) {
      case "parse_value": {
        const value = typeof input.value === "string" ? input.value : "";
        return { value_si: parseEngineeringValue(value) };
      }
      case "capacitive_reactance": {
        const c = num("capacitance_farads");
        const f = num("frequency_hz");
        if (c === null || f === null)
          return { error: "numeric inputs required" };
        return { reactance_ohms: capacitiveReactance(c, f) };
      }
      case "inductive_reactance": {
        const l = num("inductance_henries");
        const f = num("frequency_hz");
        if (l === null || f === null)
          return { error: "numeric inputs required" };
        return { reactance_ohms: inductiveReactance(l, f) };
      }
      case "parallel_resistance": {
        const r1 = num("r1_ohms");
        const r2 = num("r2_ohms");
        if (r1 === null || r2 === null)
          return { error: "numeric inputs required" };
        return { resistance_ohms: parallelResistance(r1, r2) };
      }
      case "voltage_divider": {
        const v = num("vin_volts");
        const rt = num("r_top_ohms");
        const rb = num("r_bottom_ohms");
        if (v === null || rt === null || rb === null)
          return { error: "numeric inputs required" };
        return { vout_volts: voltageDivider(v, rt, rb) };
      }
      default:
        return { error: `Unknown calc tool: ${name}` };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "calc failed" };
  }
}

// ── structured-output tool ──────────────────────────────────────────────────────

export const SUBMIT_REVIEW_TOOL_NAME = "submit_review";

export const submitReviewTool: Anthropic.Messages.Tool = {
  name: SUBMIT_REVIEW_TOOL_NAME,
  description:
    "Submit the completed design review. Call this EXACTLY ONCE, last, after all analysis. Every finding must name the refdes it concerns and give a concrete rationale (cite computed values where relevant).",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description:
          "2-4 sentence overview: what was reviewed and the headline risks.",
      },
      findings: {
        type: "array",
        description: "All findings. May be empty if nothing of note was found.",
        items: {
          type: "object",
          properties: {
            block: {
              type: "string",
              description:
                "Functional block name, e.g. 'LO Synthesizer', 'LNA Chain', 'Power'.",
            },
            severity: {
              type: "string",
              enum: SEVERITIES as unknown as string[],
              description:
                "possible_bug (likely defect) | verify (needs human/datasheet confirmation) | watch | minor | cosmetic | ok.",
            },
            title: { type: "string", description: "Short 'what to look at'." },
            rationale: {
              type: "string",
              description:
                "Why it's flagged, with quantitative detail where possible.",
            },
            refdes: {
              type: "array",
              items: { type: "string" },
              description: "Reference designators involved, e.g. ['U7','R12'].",
            },
            hw_review_required: {
              type: "boolean",
              description:
                "true if a human hardware engineer must review this; false if informational.",
            },
          },
          required: [
            "block",
            "severity",
            "title",
            "rationale",
            "refdes",
            "hw_review_required",
          ],
        },
      },
    },
    required: ["summary", "findings"],
  },
};
