/**
 * Deterministic electrical-engineering calculations for the design-review engine.
 *
 * These are exposed to the LLM reviewer as tools so quantitative findings (e.g.
 * "this AC-coupling cap has Xc = 227 Ω at 700 MHz") are computed exactly, never
 * hallucinated. Everything here is pure, unit-tested, and free of any board/LLM
 * dependency.
 *
 * Convention: all functions operate in SI base units (farads, henries, hertz,
 * ohms, volts). Use parseEngineeringValue() to turn "100nF" / "4k7" into a number.
 */

const SI_PREFIX: Record<string, number> = {
  f: 1e-15,
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  µ: 1e-6,
  m: 1e-3,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
};

/**
 * Parse an engineering-notation value into an SI base-unit number.
 *
 * Handles:
 *   - SI suffix:        "100nF" → 1e-7, "10k" → 10000, "1.8pF" → 1.8e-12
 *   - infix notation:   "4k7" → 4700, "2R2" → 2.2 (the prefix replaces the dot)
 *   - bare numbers:     "150" → 150
 *
 * Returns null for ranges ("4-6nH"), empty, or unparseable input — callers must
 * treat null as "not a single determinate value" rather than guessing.
 */
export function parseEngineeringValue(raw: string): number | null {
  if (typeof raw !== "string") return null;
  // Strip a trailing unit letter (F, H, Ω, ohm) but keep SI prefixes.
  const text = raw.trim().replace(/(ohm|Ω|F|H)\b/gi, "");
  if (!text) return null;

  // Reject ranges like "4-6nH" — ambiguous, not a single value.
  if (/\d\s*[-–]\s*\d/.test(text)) return null;

  // Infix SI notation: digit + prefix + digit, e.g. "4k7", "2R2" (R = no prefix).
  const infix = text.match(/^(\d+)([fpnuµmkKMGTR])(\d+)$/);
  if (infix) {
    const [, whole, prefix, frac] = infix;
    const mult = prefix === "R" ? 1 : SI_PREFIX[prefix];
    if (mult === undefined) return null;
    return parseFloat(`${whole}.${frac}`) * mult;
  }

  // Standard: number then optional SI prefix, e.g. "1.8p", "10k", "150".
  const std = text.match(/^([\d.]+)\s*([fpnuµmkKMGT]?)$/);
  if (std) {
    const [, num, prefix] = std;
    const value = parseFloat(num);
    if (Number.isNaN(value)) return null;
    return prefix ? value * SI_PREFIX[prefix] : value;
  }

  return null;
}

/** Capacitive reactance Xc = 1 / (2πfC), in ohms. */
export function capacitiveReactance(
  capacitanceFarads: number,
  frequencyHz: number
): number {
  if (capacitanceFarads <= 0 || frequencyHz <= 0) {
    throw new Error("capacitance and frequency must be positive");
  }
  return 1 / (2 * Math.PI * frequencyHz * capacitanceFarads);
}

/** Inductive reactance Xl = 2πfL, in ohms. */
export function inductiveReactance(
  inductanceHenries: number,
  frequencyHz: number
): number {
  if (inductanceHenries < 0 || frequencyHz <= 0) {
    throw new Error("inductance must be ≥ 0 and frequency must be positive");
  }
  return 2 * Math.PI * frequencyHz * inductanceHenries;
}

/** Parallel resistance of two resistors: (R1·R2)/(R1+R2), in ohms. */
export function parallelResistance(r1: number, r2: number): number {
  if (r1 <= 0 || r2 <= 0) {
    throw new Error("resistances must be positive");
  }
  return (r1 * r2) / (r1 + r2);
}

/** Resistive voltage divider output: Vout = Vin · Rbottom / (Rtop + Rbottom). */
export function voltageDivider(
  vin: number,
  rTop: number,
  rBottom: number
): number {
  if (rTop < 0 || rBottom < 0 || rTop + rBottom === 0) {
    throw new Error("invalid divider resistances");
  }
  return (vin * rBottom) / (rTop + rBottom);
}
