/**
 * EE-aware queries over a ConnectivityGraph, shaped for the AI assistant's
 * tool results. Pure (no DB, no LLM) so they're unit-testable; the server-only
 * tool layer (ee-assistant-tools.ts) wraps these with DB access.
 *
 * These add the *electrical* layer on top of the raw netlist tools: net roles
 * and voltage tiers, fan-out warnings, 0Ω/DNP jumpers, decoupling caps, etc.
 */
import {
  classifyGraph,
  FANOUT_WARN_THRESHOLD,
  TIER_LABEL,
  type NetTier,
} from "@/lib/ee-graph-semantics";
import {
  componentsForNet,
  netsForComponent,
  type ConnectivityGraph,
} from "@/types/connectivity";

const TIER_ORDER_LIST: NetTier[] = [
  "high_power",
  "regulated",
  "intermediate",
  "signal",
  "ground",
];

/** Resolve a net name tolerantly: exact → case-insensitive → normalized. */
function resolveNetName(graph: ConnectivityGraph, query: string): string | null {
  const q = query.trim();
  const exact = graph.nets.find((n) => n.name === q);
  if (exact) return exact.name;
  const lower = q.toLowerCase();
  const ci = graph.nets.find((n) => n.name.toLowerCase() === lower);
  if (ci) return ci.name;
  const norm = (s: string) => s.replace(/[\s.+\-_]/g, "").toLowerCase();
  const nq = norm(q);
  const fz = graph.nets.find((n) => norm(n.name) === nq);
  return fz ? fz.name : null;
}

function resolveRefDes(graph: ConnectivityGraph, query: string): string | null {
  const q = query.trim();
  const exact = graph.components.find((c) => c.refDes === q);
  if (exact) return exact.refDes;
  const lower = q.toLowerCase();
  const ci = graph.components.find((c) => c.refDes.toLowerCase() === lower);
  return ci ? ci.refDes : null;
}

/** Board-wide EE structural overview. */
export function summarizeTopology(graph: ConnectivityGraph) {
  const cg = classifyGraph(graph);
  const comps = [...cg.components.values()];

  const netsByTier: Record<string, { net: string; fanout: number }[]> = {};
  for (const tier of TIER_ORDER_LIST) netsByTier[TIER_LABEL[tier]] = [];
  for (const n of cg.nets.values()) {
    netsByTier[TIER_LABEL[n.tier]].push({ net: n.name, fanout: n.fanout });
  }
  // Drop empty tiers to keep the payload tight.
  for (const k of Object.keys(netsByTier)) {
    if (netsByTier[k].length === 0) delete netsByTier[k];
  }

  return {
    counts: {
      components: graph.components.length,
      nets: graph.nets.length,
      connections: graph.connections.length,
    },
    netsByTier,
    highFanoutNets: [...cg.nets.values()]
      .filter((n) => n.highFanout)
      .map((n) => ({ net: n.name, fanout: n.fanout }))
      .sort((a, b) => b.fanout - a.fanout),
    intermediateNets: [...cg.intermediateNets],
    flagged: {
      jumpers: comps
        .filter((c) => c.isJumper)
        .map((c) => ({ refDes: c.refDes, isolates: c.nets })),
      decouplingCaps: comps
        .filter((c) => c.isDecoupling)
        .map((c) => ({ refDes: c.refDes, rail: c.railNet })),
      fuses: comps.filter((c) => c.type === "fuse").map((c) => c.refDes),
      connectors: comps
        .filter((c) => c.type === "connector")
        .map((c) => c.refDes),
    },
    fanoutWarnThreshold: FANOUT_WARN_THRESHOLD,
  };
}

/** EE classification of a single net, or null if not found. */
export function analyzeNet(graph: ConnectivityGraph, netQuery: string) {
  const name = resolveNetName(graph, netQuery);
  if (!name) return null;
  const cg = classifyGraph(graph);
  const nc = cg.nets.get(name)!;
  const bypassCaps = [...cg.components.values()]
    .filter((c) => c.isDecoupling && c.railNet === name)
    .map((c) => c.refDes);

  return {
    net: name,
    tier: nc.tier,
    tierLabel: TIER_LABEL[nc.tier],
    role: nc.role,
    fanout: nc.fanout,
    highFanout: nc.highFanout,
    fanoutWarning: nc.highFanout
      ? "High fan-out net — verify star-point routing to avoid shared impedance"
      : null,
    components: componentsForNet(graph, name),
    bypassCaps,
  };
}

/** EE classification of a single component, or null if not found. */
export function analyzeComponent(graph: ConnectivityGraph, refQuery: string) {
  const refDes = resolveRefDes(graph, refQuery);
  if (!refDes) return null;
  const cg = classifyGraph(graph);
  const cc = cg.components.get(refDes)!;

  return {
    refDes,
    type: cc.type,
    role: cc.role,
    isJumper: cc.isJumper,
    isDecoupling: cc.isDecoupling,
    railNet: cc.railNet,
    jumperIsolates: cc.isJumper ? cc.nets : null,
    nets: netsForComponent(graph, refDes),
  };
}
