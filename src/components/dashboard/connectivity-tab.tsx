"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { EmptyState } from "@/components/ui/empty-state";
import {
  classifyGraph,
  COMP_TYPE_BADGE,
  TIER_COLOR,
  TIER_LABEL,
  TIER_ORDER,
  type ClassifiedComponent,
  type ClassifiedGraph,
  type CompType,
  type NetTier,
} from "@/lib/ee-graph-semantics";
import {
  componentsForNet,
  netsForComponent,
  type ConnectivityGraph,
} from "@/types/connectivity";

// ── Layout constants ──────────────────────────────────────────────────────────

const COMP_X = 40; // primary components (left column)
const SAT_X = 250; // decoupling caps (satellites, near their rail)
const NET_X = 380; // nets (right column), sorted by voltage tier
const V_GAP = 80;
const PAD_Y = 30;

// ── Color helpers ───────────────────────────────────────────────────────────────

/** Append a 2-digit hex alpha to a #rrggbb color. */
function alpha(hex: string, a2: string): string {
  return `${hex}${a2}`;
}

const COMP_ACCENT: Record<CompType, string> = {
  ic: "#60a5fa", // blue — primary devices
  capacitor: "#94a3b8",
  resistor: "#94a3b8",
  diode: "#94a3b8",
  inductor: "#94a3b8",
  fuse: "#ef4444", // red — protection device
  connector: "#f0abfc", // fuchsia — board interface
  led: "#a3e635", // lime
  other: "#94a3b8",
};

const JUMPER_ACCENT = "#f59e0b"; // amber
const DECOUP_ACCENT = "#64748b"; // muted slate

// ── Node data ───────────────────────────────────────────────────────────────────

type CompData = {
  label: string;
  sub: string | null;
  badge: string;
  accent: string;
  dashed: boolean;
  small: boolean;
  pins: number;
  focused: boolean;
  dim: boolean;
  tooltip?: string;
};

type NetData = {
  label: string;
  color: string;
  fanout: number;
  highFanout: boolean;
  subtitle: string | null;
  focused: boolean;
  dim: boolean;
  tooltip?: string;
};

// ── Custom node renderers ────────────────────────────────────────────────────────

function ComponentNode({ data }: NodeProps) {
  const d = data as CompData;
  const fontScale = d.small ? 0.85 : 1;
  return (
    <div
      title={d.tooltip}
      style={{
        minWidth: d.small ? 64 : 104,
        padding: d.small ? "5px 8px" : "8px 12px",
        borderRadius: 6,
        border: `1px ${d.dashed ? "dashed" : "solid"} ${
          d.focused ? d.accent : alpha(d.accent, "55")
        }`,
        background: d.focused ? alpha(d.accent, "22") : alpha(d.accent, "0d"),
        opacity: d.dim ? 0.2 : d.small ? 0.7 : 1,
        transition: "opacity 0.14s, border-color 0.14s, background 0.14s",
        fontFamily: "monospace",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
      {/* a left target handle too, so reversed (net→load) edges can attach */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            fontSize: 8 * fontScale,
            fontWeight: 700,
            letterSpacing: 0.4,
            color: d.accent,
            border: `1px solid ${alpha(d.accent, "55")}`,
            borderRadius: 3,
            padding: "0 3px",
          }}
        >
          {d.badge}
        </span>
        <span
          style={{
            fontSize: 13 * fontScale,
            fontWeight: 700,
            color: d.focused ? "#f1f5f9" : "#e2e8f0",
          }}
        >
          {d.label}
        </span>
      </div>
      {d.sub && (
        <div
          style={{
            fontSize: 9.5 * fontScale,
            color: d.dashed ? JUMPER_ACCENT : "#64748b",
            marginTop: 2,
          }}
        >
          {d.sub}
        </div>
      )}
      {!d.small && (
        <div style={{ fontSize: 9, color: "#334155", marginTop: 3 }}>
          {d.pins} {d.pins === 1 ? "pin" : "pins"}
        </div>
      )}
    </div>
  );
}

function NetNode({ data }: NodeProps) {
  const d = data as NetData;
  return (
    <div
      title={d.tooltip}
      style={{
        minWidth: 80,
        padding: "7px 16px",
        borderRadius: 20,
        border: `1px solid ${d.focused ? d.color : alpha(d.color, "66")}`,
        background: d.focused ? alpha(d.color, "26") : alpha(d.color, "12"),
        opacity: d.dim ? 0.2 : 1,
        transition: "opacity 0.14s, border-color 0.14s, background 0.14s",
        fontFamily: "monospace",
        textAlign: "center",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
      {/* a right source handle so net→load edges can leave toward a load */}
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: d.color }}>
          {d.label}
        </span>
        {/* fan-out badge */}
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            minWidth: 14,
            padding: "0 4px",
            borderRadius: 8,
            color: d.highFanout ? "#0a0a0a" : "#94a3b8",
            background: d.highFanout ? "#f59e0b" : "rgba(255,255,255,0.06)",
          }}
        >
          {d.fanout}
        </span>
      </div>
      {d.subtitle && (
        <div
          style={{ fontSize: 8.5, color: alpha(d.color, "cc"), marginTop: 2 }}
        >
          {d.subtitle}
        </div>
      )}
    </div>
  );
}

const NODE_TYPES: NodeTypes = {
  component: ComponentNode,
  net: NetNode,
};

const CONTROLS_STYLE = {
  boxShadow: "none",
  "--xy-controls-button-background-color-default": "rgba(8,8,8,0.95)",
  "--xy-controls-button-background-color-hover-default":
    "rgba(255,255,255,0.06)",
  "--xy-controls-button-color-default": "#64748b",
  "--xy-controls-button-color-hover-default": "#e2e8f0",
  "--xy-controls-button-border-color-default": "rgba(255,255,255,0.07)",
  "--xy-controls-box-shadow-default": "none",
} as CSSProperties;

// ── Graph builder ─────────────────────────────────────────────────────────────

function buildFlowElements(
  graph: ConnectivityGraph,
  classified: ClassifiedGraph,
  focusedId: string | null,
  hideJumpers: boolean
): { nodes: Node[]; edges: Edge[] } {
  const {
    nets: netClass,
    components: compClass,
    intermediateNets,
  } = classified;

  // Visible components (optionally hide jumpers)
  const visibleComps = graph.components.filter((c) => {
    const cc = compClass.get(c.refDes);
    return !(hideJumpers && cc?.isJumper);
  });
  const visibleCompSet = new Set(visibleComps.map((c) => c.refDes));

  // 1. Nets sorted by voltage tier (top = high potential), then name.
  const sortedNets = [...graph.nets].sort((a, b) => {
    const ta = netClass.get(a.name)!.tier;
    const tb = netClass.get(b.name)!.tier;
    if (TIER_ORDER[ta] !== TIER_ORDER[tb])
      return TIER_ORDER[ta] - TIER_ORDER[tb];
    return a.name.localeCompare(b.name);
  });
  const netY = new Map<string, number>();
  const netHeight = Math.max(0, sortedNets.length - 1) * V_GAP;

  // 2. Split components: decoupling caps become satellites near their rail.
  const decoupling = visibleComps.filter(
    (c) => compClass.get(c.refDes)?.isDecoupling
  );
  const mainComps = visibleComps.filter(
    (c) => !compClass.get(c.refDes)?.isDecoupling
  );

  // 3. Order main components by the Y-centroid of their nets (crossing-min).
  //    Nets are placed first (provisionally) so centroids resolve.
  sortedNets.forEach((n, i) => netY.set(n.name, i)); // provisional index space
  const centroid = (refDes: string): number => {
    const ns = netsForComponent(graph, refDes).filter((n) => netY.has(n));
    if (ns.length === 0) return Number.MAX_SAFE_INTEGER;
    return ns.reduce((s, n) => s + (netY.get(n) ?? 0), 0) / ns.length;
  };
  mainComps.sort((a, b) => centroid(a.refDes) - centroid(b.refDes));
  const mainHeight = Math.max(0, mainComps.length - 1) * V_GAP;

  // Vertical centering of the two main columns
  const maxH = Math.max(netHeight, mainHeight);
  const netY0 = PAD_Y + (maxH - netHeight) / 2;
  const mainY0 = PAD_Y + (maxH - mainHeight) / 2;

  // Final net Y in pixels
  sortedNets.forEach((n, i) => netY.set(n.name, netY0 + i * V_GAP));

  // Focus neighborhood
  const fComps = new Set<string>();
  const fNets = new Set<string>();
  if (focusedId?.startsWith("c:")) {
    const r = focusedId.slice(2);
    fComps.add(r);
    netsForComponent(graph, r).forEach((n) => fNets.add(n));
  } else if (focusedId?.startsWith("n:")) {
    const n = focusedId.slice(2);
    fNets.add(n);
    componentsForNet(graph, n).forEach((r) => fComps.add(r));
  }
  const hasFocus = focusedId !== null;

  const nodes: Node[] = [];

  // Net nodes
  for (const net of sortedNets) {
    const cc = netClass.get(net.name)!;
    nodes.push({
      id: `n:${net.name}`,
      type: "net",
      position: { x: NET_X, y: netY.get(net.name)! },
      data: {
        label: net.name,
        color: TIER_COLOR[cc.tier],
        fanout: cc.fanout,
        highFanout: cc.highFanout,
        subtitle:
          cc.tier === "intermediate"
            ? "intermediate"
            : cc.tier === "ground"
              ? null
              : TIER_LABEL[cc.tier],
        focused: fNets.has(net.name),
        dim: hasFocus && !fNets.has(net.name),
        tooltip: cc.highFanout
          ? "High fan-out net — verify star-point routing to avoid shared impedance"
          : `${cc.role}`,
      } satisfies NetData,
      draggable: false,
      selectable: false,
    });
  }

  // Main component nodes
  mainComps.forEach((c, i) => {
    const cc = compClass.get(c.refDes)!;
    nodes.push({
      id: `c:${c.refDes}`,
      type: "component",
      position: { x: COMP_X, y: mainY0 + i * V_GAP },
      data: compNodeData(cc, false, fComps, hasFocus),
      draggable: false,
      selectable: false,
    });
  });

  // Decoupling satellite nodes — attached near their associated rail net.
  const railTally = new Map<string, number>();
  for (const c of decoupling) {
    const cc = compClass.get(c.refDes)!;
    const rail = cc.railNet;
    const baseY = rail && netY.has(rail) ? netY.get(rail)! : mainY0;
    const k = railTally.get(rail ?? "") ?? 0;
    railTally.set(rail ?? "", k + 1);
    nodes.push({
      id: `c:${c.refDes}`,
      type: "component",
      position: { x: SAT_X - k * 6, y: baseY + k * 26 - 8 },
      data: compNodeData(cc, true, fComps, hasFocus),
      draggable: false,
      selectable: false,
    });
  }

  // Edges (one per component→net pair), skipping hidden jumpers.
  const seen = new Set<string>();
  const edges: Edge[] = [];
  for (const conn of graph.connections) {
    if (!visibleCompSet.has(conn.componentRefDes)) continue;
    const key = `${conn.componentRefDes}→${conn.netName}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const cc = compClass.get(conn.componentRefDes);
    const isIntermediate = intermediateNets.has(conn.netName);
    const isActive =
      hasFocus && fComps.has(conn.componentRefDes) && fNets.has(conn.netName);
    const isDim = hasFocus && !isActive;
    const isDecoupEdge = cc?.isDecoupling ?? false;

    // Direction marker for intermediate nets: source→net (arrow at net) vs
    // load→net (arrow back at the load), so flow reads source → net → load.
    const sourceLike =
      cc?.type === "ic" || cc?.type === "connector" || cc?.type === "fuse";
    const marker = isIntermediate
      ? sourceLike
        ? {
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: "#2dd4bf",
              width: 14,
              height: 14,
            },
          }
        : {
            markerStart: {
              type: MarkerType.ArrowClosed,
              color: "#2dd4bf",
              width: 14,
              height: 14,
            },
          }
      : {};

    const baseColor = isIntermediate ? "#2dd4bf" : "#60a5fa";
    edges.push({
      id: key,
      source: `c:${conn.componentRefDes}`,
      target: `n:${conn.netName}`,
      animated: isActive,
      ...marker,
      style: {
        stroke: isActive
          ? alpha(baseColor, "cc")
          : isDim
            ? "rgba(255,255,255,0.04)"
            : alpha(baseColor, isDecoupEdge ? "1f" : "3a"),
        strokeWidth: isActive ? 2 : 1.2,
        strokeDasharray: cc?.isJumper ? "4 3" : undefined,
        transition: "stroke 0.14s, stroke-width 0.14s",
      },
    });
  }

  return { nodes, edges };
}

function compNodeData(
  cc: ClassifiedComponent,
  small: boolean,
  fComps: Set<string>,
  hasFocus: boolean
): CompData {
  let accent = COMP_ACCENT[cc.type];
  let dashed = false;
  let sub = cc.sub;
  let tooltip: string | undefined;

  if (cc.isJumper) {
    accent = JUMPER_ACCENT;
    dashed = true;
    sub = "0Ω jumper";
    const [a, b] = cc.nets;
    tooltip =
      a && b ? `Remove to isolate ${a} from ${b}` : "Depopulation / DNP option";
  } else if (cc.isDecoupling) {
    accent = DECOUP_ACCENT;
    sub = "bypass cap";
  } else if (cc.type === "fuse") {
    tooltip = "Protection device";
  } else if (cc.type === "connector") {
    tooltip = "Board interface / connector";
  }

  return {
    label: cc.refDes,
    sub,
    badge: COMP_TYPE_BADGE[cc.type],
    accent,
    dashed,
    small,
    pins: cc.pins,
    focused: fComps.has(cc.refDes),
    dim: hasFocus && !fComps.has(cc.refDes),
    tooltip,
  };
}

// ── Legend ───────────────────────────────────────────────────────────────────────

const TIER_LEGEND: { tier: NetTier; label: string }[] = [
  { tier: "high_power", label: "power" },
  { tier: "regulated", label: "regulated" },
  { tier: "intermediate", label: "intermediate" },
  { tier: "signal", label: "signal" },
  { tier: "ground", label: "ground" },
];

// ── Tab component ─────────────────────────────────────────────────────────────

export function ConnectivityTab({ graph }: { graph: ConnectivityGraph }) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hideJumpers, setHideJumpers] = useState(false);

  const classified = useMemo(() => classifyGraph(graph), [graph]);

  useEffect(() => {
    document.body.classList.toggle("graph-fullscreen", isFullscreen);
    return () => document.body.classList.remove("graph-fullscreen");
  }, [isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  const { nodes, edges } = useMemo(
    () => buildFlowElements(graph, classified, focusedId, hideJumpers),
    [graph, classified, focusedId, hideJumpers]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setFocusedId((prev) => (prev === node.id ? null : node.id));
  }, []);
  const onPaneClick = useCallback(() => setFocusedId(null), []);

  if (graph.connections.length === 0) {
    return (
      <EmptyState
        title="No connectivity data yet"
        hint="Upload and parse a netlist to explore the connectivity graph."
      />
    );
  }

  const jumperCount = [...classified.components.values()].filter(
    (c) => c.isJumper
  ).length;

  // Info panel content for the focused node
  let info: {
    title: string;
    role: string;
    rows: { k: string; v: string }[];
  } | null = null;
  if (focusedId?.startsWith("n:")) {
    const name = focusedId.slice(2);
    const cc = classified.nets.get(name);
    const comps = componentsForNet(graph, name);
    if (cc) {
      info = {
        title: name,
        role: cc.role,
        rows: [
          { k: "tier", v: TIER_LABEL[cc.tier] },
          { k: "fan-out", v: `${cc.fanout}${cc.highFanout ? " ⚠ high" : ""}` },
          { k: "components", v: comps.join(", ") || "—" },
        ],
      };
    }
  } else if (focusedId?.startsWith("c:")) {
    const refDes = focusedId.slice(2);
    const cc = classified.components.get(refDes);
    const nets = netsForComponent(graph, refDes);
    if (cc) {
      info = {
        title: refDes,
        role: cc.role,
        rows: [
          { k: "pins", v: String(cc.pins) },
          { k: "nets", v: nets.join(", ") || "—" },
        ],
      };
    }
  }

  const uniqueEdgeCount = new Set(
    graph.connections
      .filter(
        (c) =>
          !(
            hideJumpers &&
            classified.components.get(c.componentRefDes)?.isJumper
          )
      )
      .map((c) => `${c.componentRefDes}→${c.netName}`)
  ).size;
  const visibleCompCount = graph.components.filter(
    (c) => !(hideJumpers && classified.components.get(c.refDes)?.isJumper)
  ).length;

  const inner = (
    <div className={isFullscreen ? "flex h-full flex-col gap-2" : "space-y-2"}>
      {/* Legend + controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#4a5568]">
        <div className="flex flex-wrap items-center gap-3">
          {TIER_LEGEND.map((t) => (
            <span key={t.tier} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{
                  background: alpha(TIER_COLOR[t.tier], "33"),
                  border: `1px solid ${TIER_COLOR[t.tier]}`,
                }}
              />
              {t.label}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {jumperCount > 0 && (
            <button
              onClick={() => setHideJumpers((v) => !v)}
              title="Hide 0Ω jumpers / DNP options to see the clean topology"
              className={`rounded border px-2 py-1 font-medium transition-colors ${
                hideJumpers
                  ? "border-[rgba(245,158,11,0.5)] bg-[rgba(245,158,11,0.12)] text-[#fbbf24]"
                  : "border-[rgba(255,255,255,0.08)] bg-[rgba(8,8,8,0.95)] text-[#64748b] hover:text-[#e2e8f0]"
              }`}
            >
              {hideJumpers ? "Show jumpers" : "Hide jumpers/DNP"}
            </button>
          )}
          <button
            onClick={() => setIsFullscreen((v) => !v)}
            title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
            className="rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(8,8,8,0.95)] p-1.5 text-[#64748b] transition-colors hover:border-[rgba(255,255,255,0.15)] hover:text-[#e2e8f0]"
          >
            {isFullscreen ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M6 2L2 2L2 6M10 2L14 2L14 6M6 14L2 14L2 10M10 14L14 14L14 10" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Graph */}
      <div
        className="relative overflow-hidden rounded-lg border border-[rgba(255,255,255,0.08)]"
        style={isFullscreen ? { flex: 1 } : { height: 480 }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          style={{ background: "#050505" }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={0.75}
            color="rgba(255,255,255,0.04)"
          />
          <Controls
            showInteractive={false}
            style={CONTROLS_STYLE}
            className="overflow-hidden rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(8,8,8,0.95)]"
          />
        </ReactFlow>

        {/* Info panel (feature 8) */}
        {info && (
          <div className="pointer-events-none absolute right-3 top-3 w-56 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(10,10,12,0.92)] p-3 text-xs backdrop-blur">
            <div className="font-mono text-sm font-bold text-[#f1f5f9]">
              {info.title}
            </div>
            <div className="mt-0.5 text-[#94a3b8]">{info.role}</div>
            <div className="mt-2 space-y-1">
              {info.rows.map((r) => (
                <div key={r.k} className="flex gap-2">
                  <span className="w-16 shrink-0 text-[#4a5568]">{r.k}</span>
                  <span className="font-mono text-[#cbd5e1]">{r.v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Stats */}
      <p className="text-xs text-[#2a2a35]">
        {visibleCompCount} components · {graph.nets.length} nets ·{" "}
        {uniqueEdgeCount} connections
        {hideJumpers && jumperCount > 0 && (
          <span className="text-[#b45309]">
            {" "}
            · {jumperCount} DNP component{jumperCount > 1 ? "s" : ""} hidden
          </span>
        )}
      </p>
    </div>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col bg-[#050505] p-4">
        {inner}
      </div>
    );
  }
  return inner;
}
