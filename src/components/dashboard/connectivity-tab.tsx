"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import dagre from "@dagrejs/dagre";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
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
  type ClassifiedGraph,
  type CompType,
  type NetTier,
} from "@/lib/ee-graph-semantics";
import {
  buildFocusModel,
  buildOverviewModel,
  buildPowerTreeModel,
  type ComponentFocusModel,
  type FocusModel,
  type NetFocusModel,
  type OverviewLink,
  type OverviewModel,
  type PowerTreeModel,
} from "@/lib/ee-graph-views";
import type { ConnectivityGraph } from "@/types/connectivity";

// ── Modes ───────────────────────────────────────────────────────────────────────

type ViewMode = "overview" | "focus" | "power";

const MODE_LABEL: Record<ViewMode, string> = {
  overview: "Overview",
  focus: "Focus",
  power: "Power tree",
};

// ── Node size estimates (for centering / radial math) ──────────────────────────

const COMP_W = 132;
const COMP_H = 64;
const NET_W = 136;
const NET_H = 44;
const CHIP_W = 120;
const CHIP_H = 26;

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
const EDGE_BLUE = "#60a5fa";

// ── Node data ───────────────────────────────────────────────────────────────────

type RailDot = { color: string; label: string };

type CompData = {
  label: string;
  sub: string | null;
  badge: string;
  accent: string;
  dashed: boolean;
  small: boolean;
  pins: number;
  focused: boolean;
  rails?: RailDot[];
  tooltip?: string;
};

type NetData = {
  label: string;
  color: string;
  fanout: number;
  highFanout: boolean;
  subtitle: string | null;
  focused: boolean;
  tooltip?: string;
};

type ChipData = { label: string; tooltip?: string };

// ── Handles ──────────────────────────────────────────────────────────────────────

const HANDLE_SIDES = [
  { id: "l", position: Position.Left },
  { id: "r", position: Position.Right },
  { id: "t", position: Position.Top },
  { id: "b", position: Position.Bottom },
] as const;

/** Invisible source+target handles on all four sides, so edges can leave a
 *  node in whichever direction the layout points (radial, LR, columns). */
function FourSideHandles() {
  return (
    <>
      {HANDLE_SIDES.map((h) => (
        <Handle
          key={`s-${h.id}`}
          id={`s-${h.id}`}
          type="source"
          position={h.position}
          style={{ opacity: 0, pointerEvents: "none" }}
        />
      ))}
      {HANDLE_SIDES.map((h) => (
        <Handle
          key={`t-${h.id}`}
          id={`t-${h.id}`}
          type="target"
          position={h.position}
          style={{ opacity: 0, pointerEvents: "none" }}
        />
      ))}
    </>
  );
}

type Pt = { x: number; y: number };

/** Choose the handle pair matching the dominant direction between centers. */
function pickHandles(
  s: Pt,
  t: Pt
): { sourceHandle: string; targetHandle: string } {
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceHandle: "s-r", targetHandle: "t-l" }
      : { sourceHandle: "s-l", targetHandle: "t-r" };
  }
  return dy >= 0
    ? { sourceHandle: "s-b", targetHandle: "t-t" }
    : { sourceHandle: "s-t", targetHandle: "t-b" };
}

function assignHandles(edges: Edge[], centers: Map<string, Pt>): Edge[] {
  return edges.map((e) => {
    const s = centers.get(e.source);
    const t = centers.get(e.target);
    return s && t ? { ...e, ...pickHandles(s, t) } : e;
  });
}

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
        opacity: d.small ? 0.75 : 1,
        fontFamily: "monospace",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <FourSideHandles />
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
        {d.rails && d.rails.length > 0 && (
          <span style={{ display: "flex", gap: 3, marginLeft: "auto" }}>
            {d.rails.map((r) => (
              <span
                key={r.label}
                title={r.label}
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: alpha(r.color, "44"),
                  border: `1px solid ${r.color}`,
                }}
              />
            ))}
          </span>
        )}
      </div>
      {d.sub && (
        <div
          style={{
            fontSize: 9.5 * fontScale,
            color: d.dashed ? JUMPER_ACCENT : "#64748b",
            marginTop: 2,
            maxWidth: 140,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
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
        maxWidth: 180,
        padding: "7px 16px",
        borderRadius: 20,
        border: `1px solid ${d.focused ? d.color : alpha(d.color, "66")}`,
        background: d.focused ? alpha(d.color, "26") : alpha(d.color, "12"),
        fontFamily: "monospace",
        textAlign: "center",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <FourSideHandles />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: d.color,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {d.label}
        </span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            minWidth: 14,
            padding: "0 4px",
            borderRadius: 8,
            color: d.highFanout ? "#0a0a0a" : "#94a3b8",
            background: d.highFanout ? "#f59e0b" : "rgba(var(--overlay-rgb),0.06)",
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

/** Small non-node chip: "+4 more", "3 power/GND nets hidden", …. */
function ChipNode({ data }: NodeProps) {
  const d = data as ChipData;
  return (
    <div
      title={d.tooltip}
      style={{
        padding: "4px 10px",
        borderRadius: 13,
        border: "1px dashed rgba(var(--overlay-rgb),0.18)",
        background: "rgba(var(--overlay-rgb),0.03)",
        color: "#64748b",
        fontFamily: "monospace",
        fontSize: 10,
        whiteSpace: "nowrap",
        cursor: d.tooltip ? "pointer" : "default",
        userSelect: "none",
      }}
    >
      <FourSideHandles />
      {d.label}
    </div>
  );
}

const NODE_TYPES: NodeTypes = {
  component: ComponentNode,
  net: NetNode,
  chip: ChipNode,
};

const CONTROLS_STYLE = {
  boxShadow: "none",
  "--xy-controls-button-background-color-default": "rgba(8,8,8,0.95)",
  "--xy-controls-button-background-color-hover-default":
    "rgba(var(--overlay-rgb),0.06)",
  "--xy-controls-button-color-default": "#64748b",
  "--xy-controls-button-color-hover-default": "#e2e8f0",
  "--xy-controls-button-border-color-default": "rgba(var(--overlay-rgb),0.07)",
  "--xy-controls-box-shadow-default": "none",
} as CSSProperties;

// ── Node factories ───────────────────────────────────────────────────────────────

function compNode(
  id: string,
  pos: Pt,
  classified: ClassifiedGraph,
  refDes: string,
  opts?: { focused?: boolean; small?: boolean; rails?: RailDot[] }
): Node {
  const cc = classified.components.get(refDes);
  let accent = cc ? COMP_ACCENT[cc.type] : COMP_ACCENT.other;
  let dashed = false;
  let sub = cc?.sub ?? null;
  if (cc?.isJumper) {
    accent = JUMPER_ACCENT;
    dashed = true;
    sub = "0Ω jumper";
  } else if (cc?.isDecoupling) {
    accent = DECOUP_ACCENT;
    sub = "bypass cap";
  }
  return {
    id,
    type: "component",
    position: pos,
    data: {
      label: refDes,
      sub,
      badge: cc ? COMP_TYPE_BADGE[cc.type] : COMP_TYPE_BADGE.other,
      accent,
      dashed,
      small: opts?.small ?? false,
      pins: cc?.pins ?? 0,
      focused: opts?.focused ?? false,
      rails: opts?.rails,
      tooltip: cc?.role,
    } satisfies CompData,
    draggable: false,
    selectable: false,
  };
}

function netNode(
  id: string,
  pos: Pt,
  classified: ClassifiedGraph,
  name: string,
  opts?: { focused?: boolean; subtitle?: string | null; fanout?: number }
): Node {
  const cn = classified.nets.get(name);
  const tier = cn?.tier ?? "signal";
  return {
    id,
    type: "net",
    position: pos,
    data: {
      label: name,
      color: TIER_COLOR[tier],
      fanout: opts?.fanout ?? cn?.fanout ?? 0,
      highFanout: cn?.highFanout ?? false,
      subtitle:
        opts?.subtitle !== undefined
          ? opts.subtitle
          : tier === "ground"
            ? null
            : TIER_LABEL[tier],
      focused: opts?.focused ?? false,
      tooltip: cn?.role,
    } satisfies NetData,
    draggable: false,
    selectable: false,
  };
}

// ── Overview layout (dagre LR) ───────────────────────────────────────────────────

function overviewLinkLabel(l: OverviewLink): string {
  return l.via ? `${l.nets[0]} ─${l.via}─ ${l.nets[1]}` : l.nets[0];
}

function layoutOverview(
  model: OverviewModel,
  classified: ClassifiedGraph,
  selectedEdgeId: string | null
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 120, marginx: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of model.nodes) {
    g.setNode(n.refDes, { width: COMP_W + 24, height: COMP_H + 12 });
  }
  for (const e of model.edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  const centers = new Map<string, Pt>();
  const nodes: Node[] = model.nodes.map((n) => {
    const p = g.node(n.refDes);
    const id = `c:${n.refDes}`;
    centers.set(id, { x: p.x, y: p.y });
    const rails: RailDot[] = n.rails.map((r) => ({
      color: TIER_COLOR[r.tier],
      label: r.nets.join(", "),
    }));
    return compNode(
      id,
      { x: p.x - COMP_W / 2, y: p.y - COMP_H / 2 },
      classified,
      n.refDes,
      { rails }
    );
  });

  const edges: Edge[] = model.edges.map((e) => {
    const selected = e.id === selectedEdgeId;
    const label =
      e.links.length > 1 ? `${e.links.length} nets` : overviewLinkLabel(e.links[0]);
    return {
      id: e.id,
      source: `c:${e.source}`,
      target: `c:${e.target}`,
      label,
      labelStyle: {
        fill: selected ? "#e2e8f0" : "#64748b",
        fontSize: 9,
        fontFamily: "monospace",
      },
      labelBgStyle: { fill: "#0a0a0c", fillOpacity: 0.9 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 3,
      data: { links: e.links },
      style: {
        stroke: selected
          ? alpha(EDGE_BLUE, "dd")
          : alpha(EDGE_BLUE, e.links.length > 1 ? "66" : "42"),
        strokeWidth: selected ? 2 : 1 + Math.min(1.4, e.links.length * 0.2),
      },
    };
  });

  return { nodes, edges: assignHandles(edges, centers) };
}

// ── Focus layout (radial) ────────────────────────────────────────────────────────

const R_SPOKE = 300;
const R_NEIGHBOR = 560;

function polar(angle: number, r: number): Pt {
  return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
}

function layoutComponentFocus(
  model: ComponentFocusModel,
  classified: ClassifiedGraph,
  showPowerPins: boolean
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const centers = new Map<string, Pt>();

  const centerId = `c:${model.center.refDes}`;
  centers.set(centerId, { x: 0, y: 0 });
  nodes.push(
    compNode(
      centerId,
      { x: -COMP_W / 2, y: -COMP_H / 2 },
      classified,
      model.center.refDes,
      { focused: true }
    )
  );

  if (!showPowerPins && model.hiddenPowerNets.length > 0) {
    const p = { x: 0, y: COMP_H / 2 + 26 };
    centers.set("chip:power", p);
    nodes.push({
      id: "chip:power",
      type: "chip",
      position: { x: p.x - CHIP_W / 2, y: p.y - CHIP_H / 2 },
      data: {
        label: `+${model.hiddenPowerNets.length} power/GND ${
          model.hiddenPowerNets.length === 1 ? "net" : "nets"
        }`,
        tooltip: "Click to show power/GND pins",
      } satisfies ChipData,
      draggable: false,
      selectable: false,
    });
  }

  const n = model.spokes.length;
  const spokeGap = n > 0 ? (2 * Math.PI) / n : 0;
  const placed = new Set<string>();

  model.spokes.forEach((spoke, i) => {
    const angle = -Math.PI / 2 + i * spokeGap;
    const netId = `n:${spoke.net}`;
    const np = polar(angle, R_SPOKE);
    centers.set(netId, np);
    nodes.push(
      netNode(
        netId,
        { x: np.x - NET_W / 2, y: np.y - NET_H / 2 },
        classified,
        spoke.net,
        { fanout: spoke.fanout }
      )
    );
    const tier = classified.nets.get(spoke.net)?.tier ?? "signal";
    edges.push({
      id: `e:hub:${spoke.net}`,
      source: centerId,
      target: netId,
      style: { stroke: alpha(TIER_COLOR[tier], "77"), strokeWidth: 1.6 },
    });

    // Neighbors fan out around the spoke angle; a part on several spokes is
    // placed once and just picks up extra edges.
    const items: { id: string; refDes?: string; more?: number }[] = [];
    for (const refDes of spoke.neighbors) {
      items.push({ id: `c:${refDes}`, refDes });
    }
    if (spoke.moreCount > 0) {
      items.push({ id: `chip:more:${spoke.net}`, more: spoke.moreCount });
    }
    const k = items.length;
    const span = Math.min(spokeGap * 0.85, 0.42 * Math.max(1, k - 1));
    items.forEach((item, j) => {
      const a = k > 1 ? angle - span / 2 + (span * j) / (k - 1) : angle;
      if (!placed.has(item.id)) {
        placed.add(item.id);
        const p = polar(a, R_NEIGHBOR);
        centers.set(item.id, p);
        if (item.refDes) {
          nodes.push(
            compNode(
              item.id,
              { x: p.x - COMP_W / 2, y: p.y - COMP_H / 2 },
              classified,
              item.refDes
            )
          );
        } else {
          nodes.push({
            id: item.id,
            type: "chip",
            position: { x: p.x - CHIP_W / 2, y: p.y - CHIP_H / 2 },
            data: {
              label: `+${item.more} more on ${spoke.net}`,
            } satisfies ChipData,
            draggable: false,
            selectable: false,
          });
        }
      }
      edges.push({
        id: `e:${spoke.net}:${item.id}`,
        source: netId,
        target: item.id,
        style: { stroke: alpha(TIER_COLOR[tier], "3a"), strokeWidth: 1.1 },
      });
    });
  });

  return { nodes, edges: assignHandles(edges, centers) };
}

function layoutNetFocus(
  model: NetFocusModel,
  classified: ClassifiedGraph
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const centers = new Map<string, Pt>();

  const centerId = `n:${model.center.net}`;
  centers.set(centerId, { x: 0, y: 0 });
  nodes.push(
    netNode(
      centerId,
      { x: -NET_W / 2, y: -NET_H / 2 },
      classified,
      model.center.net,
      { focused: true }
    )
  );

  const tier = model.center.tier;
  // Concentric rings with growing capacity so big nets (GND) stay readable.
  let ring = 0;
  let placedInRing = 0;
  let ringStart = 0;
  const ringCap = (r: number) => 10 + r * 7;
  model.members.forEach((m, idx) => {
    if (placedInRing >= ringCap(ring)) {
      ring += 1;
      ringStart = idx;
      placedInRing = 0;
    }
    const cap = Math.min(ringCap(ring), model.members.length - ringStart);
    const angle =
      -Math.PI / 2 +
      (2 * Math.PI * placedInRing) / cap +
      (ring % 2 === 1 ? Math.PI / cap : 0); // stagger alternate rings
    const p = polar(angle, R_SPOKE + ring * 190);
    placedInRing += 1;

    const id = `c:${m.refDes}`;
    centers.set(id, p);
    nodes.push(
      compNode(
        id,
        { x: p.x - COMP_W / 2, y: p.y - COMP_H / 2 },
        classified,
        m.refDes,
        { small: ring > 0 }
      )
    );
    edges.push({
      id: `e:${centerId}:${id}`,
      source: centerId,
      target: id,
      style: { stroke: alpha(TIER_COLOR[tier], "33"), strokeWidth: 1.1 },
    });
  });

  return { nodes, edges: assignHandles(edges, centers) };
}

// ── Power-tree layout (manual columns) ───────────────────────────────────────────

const POWER_ROLE_LABEL = {
  entry: "power entry",
  protection: "protection",
  regulator: "regulator",
} as const;

function layoutPowerTree(
  model: PowerTreeModel,
  classified: ClassifiedGraph
): { nodes: Node[]; edges: Edge[] } {
  const byColumn = new Map<number, PowerTreeModel["nodes"]>();
  for (const n of model.nodes) {
    if (!byColumn.has(n.column)) byColumn.set(n.column, []);
    byColumn.get(n.column)!.push(n);
  }

  const centers = new Map<string, Pt>();
  const nodes: Node[] = [];
  for (const [col, items] of byColumn) {
    items.sort((a, b) => a.label.localeCompare(b.label));
    items.forEach((item, i) => {
      const p = { x: col * 280, y: (i - (items.length - 1) / 2) * 96 };
      centers.set(item.id, p);
      if (item.kind === "net") {
        nodes.push(
          netNode(
            item.id,
            { x: p.x - NET_W / 2, y: p.y - NET_H / 2 },
            classified,
            item.label,
            {
              fanout: item.loadCount ?? 0,
              subtitle:
                item.loadCount !== undefined
                  ? `${item.loadCount} ${item.loadCount === 1 ? "load" : "loads"}`
                  : null,
            }
          )
        );
      } else {
        const node = compNode(
          item.id,
          { x: p.x - COMP_W / 2, y: p.y - COMP_H / 2 },
          classified,
          item.label,
          { focused: item.role === "regulator" }
        );
        if (item.role) {
          (node.data as CompData).sub = POWER_ROLE_LABEL[item.role];
        }
        nodes.push(node);
      }
    });
  }

  const edges: Edge[] = model.edges.map((e) => {
    const netId = e.source.startsWith("n:") ? e.source : e.target;
    const tier = classified.nets.get(netId.slice(2))?.tier ?? "regulated";
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      style: { stroke: alpha(TIER_COLOR[tier], "66"), strokeWidth: 1.6 },
    };
  });

  return { nodes, edges: assignHandles(edges, centers) };
}

// ── Search ──────────────────────────────────────────────────────────────────────

type SearchItem = {
  id: string; // "c:REF" | "n:NET"
  label: string;
  sub: string | null;
  kind: "component" | "net";
};

function searchMatches(items: SearchItem[], query: string): SearchItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts: SearchItem[] = [];
  const contains: SearchItem[] = [];
  for (const it of items) {
    const l = it.label.toLowerCase();
    if (l.startsWith(q)) starts.push(it);
    else if (l.includes(q) || it.sub?.toLowerCase().includes(q))
      contains.push(it);
    if (starts.length >= 10) break;
  }
  return [...starts, ...contains].slice(0, 10);
}

// ── Detail panel ─────────────────────────────────────────────────────────────────

type DetailRow = { k: string; v: string };
type Detail = {
  title: string;
  role: string;
  rows: DetailRow[];
  /** Pin-level table: [pin label, net/target]. */
  pinRows?: [string, string][];
};

function pinSort(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a.localeCompare(b);
}

function buildDetail(
  graph: ConnectivityGraph,
  classified: ClassifiedGraph,
  id: string
): Detail | null {
  if (id.startsWith("c:")) {
    const refDes = id.slice(2);
    const cc = classified.components.get(refDes);
    if (!cc) return null;
    const pinRows: [string, string][] = graph.connections
      .filter((c) => c.componentRefDes === refDes)
      .sort((a, b) => pinSort(a.pinNumber, b.pinNumber))
      .map((c) => [
        c.pinName ? `${c.pinNumber} · ${c.pinName}` : c.pinNumber,
        c.netName,
      ]);
    return {
      title: refDes,
      role: cc.role,
      rows: [
        { k: "pins", v: String(cc.pins) },
        { k: "nets", v: String(cc.nets.length) },
      ],
      pinRows,
    };
  }
  if (id.startsWith("n:")) {
    const name = id.slice(2);
    const cn = classified.nets.get(name);
    if (!cn) return null;
    const pinRows: [string, string][] = graph.connections
      .filter((c) => c.netName === name)
      .sort(
        (a, b) =>
          a.componentRefDes.localeCompare(b.componentRefDes) ||
          pinSort(a.pinNumber, b.pinNumber)
      )
      .map((c) => [
        c.componentRefDes,
        c.pinName ? `pin ${c.pinNumber} · ${c.pinName}` : `pin ${c.pinNumber}`,
      ]);
    return {
      title: name,
      role: cn.role,
      rows: [
        { k: "tier", v: TIER_LABEL[cn.tier] },
        { k: "fan-out", v: `${cn.fanout}${cn.highFanout ? " ⚠ high" : ""}` },
      ],
      pinRows,
    };
  }
  return null;
}

// ── Legends ─────────────────────────────────────────────────────────────────────

const TIER_LEGEND: { tier: NetTier; label: string }[] = [
  { tier: "high_power", label: "power" },
  { tier: "regulated", label: "regulated" },
  { tier: "intermediate", label: "intermediate" },
  { tier: "signal", label: "signal" },
  { tier: "ground", label: "ground" },
];

const RAIL_LEGEND: { tier: NetTier; label: string }[] = [
  { tier: "high_power", label: "on high-side power" },
  { tier: "regulated", label: "on regulated rail" },
];

function LegendDot({ tier }: { tier: NetTier }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{
        background: alpha(TIER_COLOR[tier], "33"),
        border: `1px solid ${TIER_COLOR[tier]}`,
      }}
    />
  );
}

// ── Tab component ─────────────────────────────────────────────────────────────

export function ConnectivityTab({ graph }: { graph: ConnectivityGraph }) {
  const [mode, setMode] = useState<ViewMode>("overview");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [crumbs, setCrumbs] = useState<string[]>([]);
  const [showPowerPins, setShowPowerPins] = useState(false);
  const [hideJumpers, setHideJumpers] = useState(false);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

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

  const searchIndex = useMemo<SearchItem[]>(() => {
    const comps: SearchItem[] = graph.components
      .map((c) => ({
        id: `c:${c.refDes}`,
        label: c.refDes,
        sub: c.name ?? c.value ?? null,
        kind: "component" as const,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const nets: SearchItem[] = graph.nets
      .map((n) => ({
        id: `n:${n.name}`,
        label: n.name,
        sub: null,
        kind: "net" as const,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [...comps, ...nets];
  }, [graph]);
  const results = useMemo(
    () => searchMatches(searchIndex, query),
    [searchIndex, query]
  );

  const enterFocus = useCallback((id: string) => {
    setMode("focus");
    setSelectedEdgeId(null);
    setFocusId((prev) => {
      if (prev === id) return prev;
      setCrumbs((cs) => [...cs.filter((c) => c !== id), id].slice(-8));
      return id;
    });
  }, []);

  const overviewModel = useMemo(
    () =>
      mode === "overview"
        ? buildOverviewModel(graph, classified, { hideJumpers })
        : null,
    [mode, graph, classified, hideJumpers]
  );
  const focusModel = useMemo<FocusModel | null>(
    () =>
      mode === "focus" && focusId
        ? buildFocusModel(graph, classified, focusId, { showPowerPins })
        : null,
    [mode, graph, classified, focusId, showPowerPins]
  );
  const powerModel = useMemo(
    () => (mode === "power" ? buildPowerTreeModel(graph, classified) : null),
    [mode, graph, classified]
  );

  const { nodes, edges } = useMemo(() => {
    if (mode === "overview" && overviewModel) {
      return layoutOverview(overviewModel, classified, selectedEdgeId);
    }
    if (mode === "focus" && focusModel) {
      return focusModel.kind === "component"
        ? layoutComponentFocus(focusModel, classified, showPowerPins)
        : layoutNetFocus(focusModel, classified);
    }
    if (mode === "power" && powerModel) {
      return layoutPowerTree(powerModel, classified);
    }
    return { nodes: [] as Node[], edges: [] as Edge[] };
  }, [
    mode,
    overviewModel,
    focusModel,
    powerModel,
    classified,
    selectedEdgeId,
    showPowerPins,
  ]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.id === "chip:power") {
        setShowPowerPins(true);
        return;
      }
      if (node.id.startsWith("chip:")) return;
      enterFocus(node.id);
    },
    [enterFocus]
  );
  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      if (mode !== "overview") return;
      setSelectedEdgeId((prev) => (prev === edge.id ? null : edge.id));
    },
    [mode]
  );
  const onPaneClick = useCallback(() => setSelectedEdgeId(null), []);

  const selectSearchResult = useCallback(
    (id: string) => {
      setQuery("");
      setSearchOpen(false);
      searchRef.current?.blur();
      enterFocus(id);
    },
    [enterFocus]
  );

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

  // Detail panel: focused item in Focus mode, selected edge in Overview.
  let detail: Detail | null = null;
  let edgeDetail: { title: string; links: OverviewLink[] } | null = null;
  if (mode === "focus" && focusId) {
    detail = buildDetail(graph, classified, focusId);
  } else if (mode === "overview" && selectedEdgeId && overviewModel) {
    const e = overviewModel.edges.find((x) => x.id === selectedEdgeId);
    if (e) edgeDetail = { title: `${e.source} ↔ ${e.target}`, links: e.links };
  }

  const stats = (() => {
    if (mode === "overview" && overviewModel) {
      return `${overviewModel.nodes.length} major components · ${overviewModel.edges.length} links · ${graph.components.length} components / ${graph.nets.length} nets total`;
    }
    if (mode === "focus" && focusModel) {
      return focusModel.kind === "component"
        ? `${focusModel.center.refDes} · ${focusModel.spokes.length} nets shown · ${focusModel.hiddenPowerNets.length} power/GND hidden`
        : `${focusModel.center.net} · ${focusModel.members.length} components`;
    }
    if (mode === "power" && powerModel) {
      const rails = powerModel.nodes.filter((n) => n.kind === "net").length;
      return `${rails} power nets · ${powerModel.nodes.length - rails} path components`;
    }
    return "";
  })();

  const legend = mode === "overview" ? RAIL_LEGEND : TIER_LEGEND;

  const flowKey = `${mode}:${focusId ?? ""}:${showPowerPins}:${hideJumpers}`;

  const emptyFocus = mode === "focus" && !focusModel;
  const emptyOverview =
    mode === "overview" && overviewModel && overviewModel.nodes.length === 0;
  const emptyPower =
    mode === "power" && powerModel && powerModel.nodes.length === 0;

  const inner = (
    <div className={isFullscreen ? "flex h-full flex-col gap-2" : "space-y-2"}>
      {/* Mode switch + search + controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded border border-[rgba(var(--overlay-rgb),0.08)]">
          {(Object.keys(MODE_LABEL) as ViewMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === m
                  ? "bg-[rgba(96,165,250,0.15)] text-[#93c5fd]"
                  : "bg-[rgba(8,8,8,0.95)] text-[#64748b] hover:text-[#e2e8f0]"
              }`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>

        <div className="relative">
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results.length > 0) {
                selectSearchResult(results[0].id);
              } else if (e.key === "Escape") {
                setQuery("");
                setSearchOpen(false);
              }
            }}
            placeholder="Search U12, SPI_CLK…"
            className="w-44 rounded border border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(8,8,8,0.95)] px-2 py-1 font-mono text-xs text-[#e2e8f0] placeholder-[#3f4a5c] outline-none focus:border-[rgba(96,165,250,0.4)]"
          />
          {searchOpen && results.length > 0 && (
            <div className="absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden rounded border border-[rgba(var(--overlay-rgb),0.1)] bg-[rgba(10,10,12,0.97)] shadow-lg backdrop-blur">
              {results.map((r) => (
                <button
                  key={r.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectSearchResult(r.id);
                  }}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-xs text-[#cbd5e1] hover:bg-[rgba(96,165,250,0.12)]"
                >
                  <span
                    className={`rounded border px-1 text-[8px] font-bold ${
                      r.kind === "component"
                        ? "border-[rgba(96,165,250,0.4)] text-[#60a5fa]"
                        : "border-[rgba(167,139,250,0.4)] text-[#a78bfa]"
                    }`}
                  >
                    {r.kind === "component" ? "PART" : "NET"}
                  </span>
                  <span className="font-semibold">{r.label}</span>
                  {r.sub && (
                    <span className="truncate text-[var(--fg-subtle)]">{r.sub}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {mode === "focus" && focusModel?.kind === "component" && (
            <button
              onClick={() => setShowPowerPins((v) => !v)}
              className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${
                showPowerPins
                  ? "border-[rgba(96,165,250,0.5)] bg-[rgba(96,165,250,0.12)] text-[#93c5fd]"
                  : "border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(8,8,8,0.95)] text-[#64748b] hover:text-[#e2e8f0]"
              }`}
            >
              {showPowerPins ? "Hide power/GND pins" : "Show power/GND pins"}
            </button>
          )}
          {mode === "overview" && jumperCount > 0 && (
            <button
              onClick={() => setHideJumpers((v) => !v)}
              title="Ignore 0Ω-jumper / DNP bridges when linking blocks"
              className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${
                hideJumpers
                  ? "border-[rgba(245,158,11,0.5)] bg-[rgba(245,158,11,0.12)] text-[#fbbf24]"
                  : "border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(8,8,8,0.95)] text-[#64748b] hover:text-[#e2e8f0]"
              }`}
            >
              {hideJumpers ? "Include jumpers" : "Ignore jumpers/DNP"}
            </button>
          )}
          <button
            onClick={() => setIsFullscreen((v) => !v)}
            title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
            className="rounded border border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(8,8,8,0.95)] p-1.5 text-[#64748b] transition-colors hover:border-[rgba(var(--overlay-rgb),0.15)] hover:text-[#e2e8f0]"
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

      {/* Breadcrumbs (focus mode) + legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--fg-subtle)]">
        {mode === "focus" && crumbs.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1 font-mono">
            <button
              onClick={() => setMode("overview")}
              className="rounded px-1.5 py-0.5 text-[#64748b] hover:bg-[rgba(var(--overlay-rgb),0.05)] hover:text-[#e2e8f0]"
            >
              Overview
            </button>
            {crumbs.map((c) => (
              <span key={c} className="flex items-center gap-1">
                <span className="text-[#2a2a35]">›</span>
                <button
                  onClick={() => {
                    setCrumbs((cs) => cs.slice(0, cs.indexOf(c) + 1));
                    setFocusId(c);
                  }}
                  className={`rounded px-1.5 py-0.5 ${
                    c === focusId
                      ? "bg-[rgba(96,165,250,0.12)] text-[#93c5fd]"
                      : "text-[#64748b] hover:bg-[rgba(var(--overlay-rgb),0.05)] hover:text-[#e2e8f0]"
                  }`}
                >
                  {c.slice(2)}
                </button>
              </span>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {legend.map((t) => (
              <span key={t.tier} className="flex items-center gap-1.5">
                <LegendDot tier={t.tier} />
                {t.label}
              </span>
            ))}
            {mode === "overview" && (
              <span className="text-[#3f4a5c]">
                edges = signal nets · click a block to focus
              </span>
            )}
          </div>
        )}
      </div>

      {/* Graph */}
      <div
        className="relative overflow-hidden rounded-lg border border-[rgba(var(--overlay-rgb),0.08)]"
        style={isFullscreen ? { flex: 1 } : { height: 480 }}
      >
        {emptyFocus ? (
          <div className="flex h-full items-center justify-center text-xs text-[var(--fg-subtle)]">
            Search a part or net above, or click any node, to focus on it.
          </div>
        ) : emptyOverview ? (
          <div className="flex h-full items-center justify-center px-8 text-center text-xs text-[var(--fg-subtle)]">
            No ICs or connectors recognized in this netlist — try Focus mode
            via search instead.
          </div>
        ) : emptyPower ? (
          <div className="flex h-full items-center justify-center px-8 text-center text-xs text-[var(--fg-subtle)]">
            No power rails recognized (no VIN/VBAT/3V3/5V-style net names).
          </div>
        ) : (
          <ReactFlow
            key={flowKey}
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            fitView
            fitViewOptions={{ padding: 0.15, maxZoom: 1.2 }}
            minZoom={0.05}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            style={{ background: "var(--bg)" }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={0.75}
              color="rgba(var(--overlay-rgb),0.04)"
            />
            <Controls
              showInteractive={false}
              style={CONTROLS_STYLE}
              className="overflow-hidden rounded border border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(8,8,8,0.95)]"
            />
          </ReactFlow>
        )}

        {/* Detail panel */}
        {(detail || edgeDetail) && (
          <div className="absolute right-3 top-3 max-h-[calc(100%-24px)] w-64 overflow-y-auto rounded-lg border border-[rgba(var(--overlay-rgb),0.1)] bg-[rgba(10,10,12,0.92)] p-3 text-xs backdrop-blur">
            {detail && (
              <>
                <div className="font-mono text-sm font-bold text-[#f1f5f9]">
                  {detail.title}
                </div>
                <div className="mt-0.5 text-[var(--fg-muted)]">{detail.role}</div>
                <div className="mt-2 space-y-1">
                  {detail.rows.map((r) => (
                    <div key={r.k} className="flex gap-2">
                      <span className="w-16 shrink-0 text-[var(--fg-subtle)]">
                        {r.k}
                      </span>
                      <span className="font-mono text-[#cbd5e1]">{r.v}</span>
                    </div>
                  ))}
                </div>
                {detail.pinRows && detail.pinRows.length > 0 && (
                  <div className="mt-2 border-t border-[rgba(var(--overlay-rgb),0.06)] pt-2">
                    <div className="mb-1 text-[var(--fg-subtle)]">connections</div>
                    <div className="space-y-0.5">
                      {detail.pinRows.map(([pin, net], i) => (
                        <div key={i} className="flex gap-2 font-mono">
                          <span className="w-24 shrink-0 truncate text-[#64748b]">
                            {pin}
                          </span>
                          <span className="truncate text-[#cbd5e1]">
                            {net}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            {edgeDetail && (
              <>
                <div className="font-mono text-sm font-bold text-[#f1f5f9]">
                  {edgeDetail.title}
                </div>
                <div className="mt-0.5 text-[var(--fg-muted)]">
                  {edgeDetail.links.length}{" "}
                  {edgeDetail.links.length === 1 ? "net" : "nets"} between
                  these blocks
                </div>
                <div className="mt-2 space-y-0.5">
                  {edgeDetail.links.map((l, i) => (
                    <div key={i} className="font-mono text-[#cbd5e1]">
                      {overviewLinkLabel(l)}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Stats */}
      <p className="text-xs text-[#2a2a35]">{stats}</p>
    </div>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col bg-[var(--bg)] p-4">
        {inner}
      </div>
    );
  }
  return inner;
}
