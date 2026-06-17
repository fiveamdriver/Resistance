/**
 * Electrical-engineering semantics for the connectivity graph.
 *
 * Pure, dependency-free classification of nets and components from a parsed
 * netlist, used to drive the connectivity visualization (voltage-hierarchy
 * layout, role colors, jumper/decoupling/fuse flagging, fan-out warnings).
 *
 * Everything here is name/topology heuristics only — it degrades gracefully:
 * an unrecognized net is treated as a mid-tier signal net, an unrecognized
 * component as "other".
 */
import type { ConnectivityGraph } from "@/types/connectivity";

// ── Net tiers (Y-axis = electrical potential) ───────────────────────────────────

/** Vertical tiers, ordered top (high potential) → bottom (ground). */
export type NetTier =
  | "high_power"
  | "regulated"
  | "intermediate"
  | "signal"
  | "ground";

/** Row order for layout — lower number = higher on screen. */
export const TIER_ORDER: Record<NetTier, number> = {
  high_power: 0,
  regulated: 1,
  intermediate: 2,
  signal: 3,
  ground: 4,
};

/** Role color per tier (dark-theme accents). */
export const TIER_COLOR: Record<NetTier, string> = {
  high_power: "#fb7185", // coral / warm
  regulated: "#60a5fa", // blue
  intermediate: "#2dd4bf", // teal
  signal: "#a78bfa", // purple
  ground: "#6b7280", // dark gray
};

export const TIER_LABEL: Record<NetTier, string> = {
  high_power: "high-side power",
  regulated: "regulated rail",
  intermediate: "intermediate",
  signal: "signal",
  ground: "ground",
};

const RE_GROUND = /GND|AGND|PGND|VSS/i;
const RE_INTERMEDIATE_NAME = /SENSE|ISENSE|VSENSE|FB|FEEDBACK/i;
const RE_HIGH_POWER = /VIN|VRAW|VBAT|VCC|V\d+V/i;
const RE_REGULATED = /3V3|5V|VOUT|VBUS/i;
const RE_SIGNAL = /LED|PWM|UART|SDA|SCL|\bEN\b|FAULT|GPIO|CLK|MISO|MOSI|CS/i;

/**
 * Base tier for a net from its name alone. Topological promotion to
 * "intermediate" happens later in classifyGraph(). Precedence is most-specific
 * first so e.g. "DGND" lands in ground, not signal.
 */
export function classifyNetByName(name: string): NetTier {
  if (RE_GROUND.test(name)) return "ground";
  if (RE_INTERMEDIATE_NAME.test(name)) return "intermediate";
  if (RE_HIGH_POWER.test(name)) return "high_power";
  if (RE_REGULATED.test(name)) return "regulated";
  if (RE_SIGNAL.test(name)) return "signal";
  return "signal"; // graceful default: mid-tier signal
}

/** True for tiers that carry power (used in decoupling-cap detection). */
export function isPowerTier(tier: NetTier): boolean {
  return (
    tier === "high_power" || tier === "regulated" || tier === "intermediate"
  );
}

// ── Component types ─────────────────────────────────────────────────────────────

export type CompType =
  | "ic"
  | "capacitor"
  | "resistor"
  | "diode"
  | "fuse"
  | "connector"
  | "led"
  | "inductor"
  | "other";

export const COMP_TYPE_BADGE: Record<CompType, string> = {
  ic: "IC",
  capacitor: "C",
  resistor: "R",
  diode: "D",
  fuse: "FUSE",
  connector: "CONN",
  led: "LED",
  inductor: "L",
  other: "·",
};

/** Classify a component from its reference designator prefix. */
export function classifyComponentType(refDes: string): CompType {
  const rd = refDes.toUpperCase();
  // Multi-letter prefixes first so they win over their single-letter cousins.
  if (rd.startsWith("LED")) return "led";
  if (rd.startsWith("CN")) return "connector";
  if (rd.startsWith("U") || rd.startsWith("IC")) return "ic";
  if (rd.startsWith("C")) return "capacitor";
  if (rd.startsWith("R")) return "resistor";
  if (rd.startsWith("D")) return "diode";
  if (rd.startsWith("F")) return "fuse";
  if (rd.startsWith("J") || rd.startsWith("P")) return "connector";
  if (rd.startsWith("L")) return "inductor";
  return "other";
}

/** True if a value string represents 0 ohms (a jumper). */
export function isZeroOhmValue(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value
    .trim()
    .toUpperCase()
    .replace(/Ω|OHMS?|R$/g, "");
  return v === "0" || v === "0.0" || v === "00" || value.trim() === "0R";
}

/** True if name/value/refdes marks a depopulation (do-not-populate) option.
 *  Treats `_`/`-` as separators so "R_DNP" matches, but not "VDNPX". */
export function isDnpMarked(
  ...fields: Array<string | null | undefined>
): boolean {
  return fields.some(
    (f) =>
      !!f && /(?:^|[^a-z0-9])dnp(?:[^a-z0-9]|$)|do[\s_-]?not[\s_-]?pop/i.test(f)
  );
}

// ── Whole-graph classification ──────────────────────────────────────────────────

export interface ClassifiedNet {
  name: string;
  tier: NetTier;
  /** Degree (connection count). */
  fanout: number;
  /** True when degree exceeds the shared-impedance warning threshold. */
  highFanout: boolean;
  /** Plain-language role guess for the info panel. */
  role: string;
}

export interface ClassifiedComponent {
  refDes: string;
  type: CompType;
  sub: string | null;
  pins: number;
  /** 0Ω / DNP jumper. */
  isJumper: boolean;
  /** 2-pin cap bridging a power rail and ground. */
  isDecoupling: boolean;
  /** Net names this component connects to. */
  nets: string[];
  /** Power rail a decoupling cap is associated with (for satellite placement). */
  railNet: string | null;
  role: string;
}

export interface ClassifiedGraph {
  nets: Map<string, ClassifiedNet>;
  components: Map<string, ClassifiedComponent>;
  /** Net names that sit topologically between a source and a load. */
  intermediateNets: Set<string>;
}

export const FANOUT_WARN_THRESHOLD = 4;

/** Components considered active "sources" for current-flow direction. */
function isSourceType(type: CompType): boolean {
  return type === "ic" || type === "connector" || type === "fuse";
}

/**
 * Classify every net and component in the graph, resolving topology-dependent
 * roles (intermediate nets, decoupling caps, current-flow direction).
 */
export function classifyGraph(graph: ConnectivityGraph): ClassifiedGraph {
  // Adjacency: net -> component refdes, component -> net names.
  const netToComps = new Map<string, string[]>();
  const compToNets = new Map<string, string[]>();
  for (const c of graph.connections) {
    if (!netToComps.has(c.netName)) netToComps.set(c.netName, []);
    if (!netToComps.get(c.netName)!.includes(c.componentRefDes)) {
      netToComps.get(c.netName)!.push(c.componentRefDes);
    }
    if (!compToNets.has(c.componentRefDes))
      compToNets.set(c.componentRefDes, []);
    if (!compToNets.get(c.componentRefDes)!.includes(c.netName)) {
      compToNets.get(c.componentRefDes)!.push(c.netName);
    }
  }

  const types = new Map<string, CompType>();
  for (const c of graph.components) {
    types.set(c.refDes, classifyComponentType(c.refDes));
  }

  // Intermediate nets: name-flagged (SENSE/FB), OR an *unrecognized* net wedged
  // between a source and a load. Named rails/grounds keep their tier — they ARE
  // the rail, not "between" things. Bypass caps are ignored when judging the
  // source→load topology so a decoupling cap doesn't disqualify the net.
  const intermediateNets = new Set<string>();
  for (const net of graph.nets) {
    const base = classifyNetByName(net.name);
    if (base === "intermediate") {
      intermediateNets.add(net.name);
      continue;
    }
    if (base !== "signal") continue; // only promote unrecognized nets
    const comps = (netToComps.get(net.name) ?? []).filter(
      (r) => (types.get(r) ?? "other") !== "capacitor"
    );
    if (comps.length === 2) {
      const someSource = comps.some((r) =>
        isSourceType(types.get(r) ?? "other")
      );
      const someLoad = comps.some(
        (r) => !isSourceType(types.get(r) ?? "other")
      );
      if (someSource && someLoad) intermediateNets.add(net.name);
    }
  }

  // Nets
  const nets = new Map<string, ClassifiedNet>();
  for (const net of graph.nets) {
    const tier = intermediateNets.has(net.name)
      ? "intermediate"
      : classifyNetByName(net.name);
    const fanout = net.pinCount;
    nets.set(net.name, {
      name: net.name,
      tier,
      fanout,
      highFanout: fanout > FANOUT_WARN_THRESHOLD,
      role: describeNet(net.name, tier),
    });
  }

  // Components
  const components = new Map<string, ClassifiedComponent>();
  for (const c of graph.components) {
    const type = types.get(c.refDes) ?? "other";
    const connectedNets = compToNets.get(c.refDes) ?? [];
    const value = c.value ?? null;
    const sub = c.name ?? c.value ?? null;

    // Protel netlists carry the value in the component comment (→ c.name), so
    // check both the value field and the comment for "0Ω"/DNP markers.
    const jumper =
      type === "resistor" &&
      (isZeroOhmValue(value) ||
        isZeroOhmValue(c.name) ||
        isDnpMarked(c.refDes, c.name, value));

    // Decoupling cap: 2-pin capacitor with one power-tier net and one ground.
    let decoupling = false;
    let railNet: string | null = null;
    if (type === "capacitor" && connectedNets.length === 2) {
      const tiers = connectedNets.map((n) => nets.get(n)?.tier ?? "signal");
      const hasGnd = tiers.includes("ground");
      const powerIdx = tiers.findIndex(isPowerTier);
      if (hasGnd && powerIdx !== -1) {
        decoupling = true;
        railNet = connectedNets[powerIdx];
      }
    }

    components.set(c.refDes, {
      refDes: c.refDes,
      type,
      sub,
      pins: c.pinNumbers.length,
      isJumper: jumper,
      isDecoupling: decoupling,
      nets: connectedNets,
      railNet,
      role: describeComponent(type, jumper, decoupling),
    });
  }

  return { nets, components, intermediateNets };
}

// ── Plain-language role descriptions (info panel) ────────────────────────────────

function describeNet(name: string, tier: NetTier): string {
  switch (tier) {
    case "high_power":
      return "High-side power input rail";
    case "regulated":
      return "Regulated supply rail";
    case "intermediate":
      return /SENSE|FB|FEEDBACK/i.test(name)
        ? "Sense / feedback net"
        : "Intermediate net (source → load)";
    case "ground":
      return "Ground / return reference";
    case "signal":
      return "Functional signal / control net";
  }
}

function describeComponent(
  type: CompType,
  jumper: boolean,
  decoupling: boolean
): string {
  if (jumper) return "0Ω jumper / DNP option";
  if (decoupling) return "Decoupling / bypass capacitor";
  switch (type) {
    case "ic":
      return "IC / regulator";
    case "capacitor":
      return "Capacitor";
    case "resistor":
      return "Resistor";
    case "diode":
      return "Diode";
    case "fuse":
      return "Protection fuse";
    case "connector":
      return "Connector / board interface";
    case "led":
      return "LED";
    case "inductor":
      return "Inductor";
    default:
      return "Component";
  }
}
