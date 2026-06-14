"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
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
  componentsForNet,
  netsForComponent,
  type ConnectivityGraph,
} from "@/types/connectivity";

// ── Layout constants ──────────────────────────────────────────────────────────

const COMP_X = 30;
const NET_X = 310;
const V_GAP = 86;
const PAD_Y = 30;

// ── Custom node types ─────────────────────────────────────────────────────────

type CompData = {
  label: string;
  sub: string | null; // name or value, whichever is available
  pins: number;
  focused: boolean;
  dim: boolean;
};

type NetData = {
  label: string;
  pins: number;
  focused: boolean;
  dim: boolean;
};

function ComponentNode({ data }: NodeProps) {
  const d = data as CompData;
  return (
    <div
      style={{
        minWidth: 100,
        padding: "8px 12px",
        borderRadius: 6,
        border: `1px solid ${d.focused ? "rgba(96,165,250,0.85)" : "rgba(96,165,250,0.28)"}`,
        background: d.focused
          ? "rgba(96,165,250,0.11)"
          : "rgba(96,165,250,0.04)",
        opacity: d.dim ? 0.2 : 1,
        transition: "opacity 0.14s, border-color 0.14s, background 0.14s",
        fontFamily: "monospace",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      {/* Right-side handle for edges leaving toward nets */}
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: d.focused ? "#93c5fd" : "#e2e8f0",
        }}
      >
        {d.label}
      </div>
      {d.sub && (
        <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
          {d.sub}
        </div>
      )}
      <div style={{ fontSize: 9, color: "#334155", marginTop: 4 }}>
        {d.pins} {d.pins === 1 ? "pin" : "pins"}
      </div>
    </div>
  );
}

function NetNode({ data }: NodeProps) {
  const d = data as NetData;
  return (
    <div
      style={{
        minWidth: 72,
        padding: "7px 16px",
        borderRadius: 20,
        border: `1px solid ${d.focused ? "rgba(52,211,153,0.75)" : "rgba(255,255,255,0.12)"}`,
        background: d.focused
          ? "rgba(52,211,153,0.09)"
          : "rgba(255,255,255,0.03)",
        opacity: d.dim ? 0.2 : 1,
        transition: "opacity 0.14s, border-color 0.14s, background 0.14s",
        fontFamily: "monospace",
        textAlign: "center",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      {/* Left-side handle for edges arriving from components */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: d.focused ? "#6ee7b7" : "#94a3b8",
        }}
      >
        {d.label}
      </div>
      <div style={{ fontSize: 9, color: "#334155", marginTop: 2 }}>
        {d.pins} {d.pins === 1 ? "conn" : "conns"}
      </div>
    </div>
  );
}

// Defined outside the component so the object reference is stable across
// renders — React Flow warns if nodeTypes changes on every render.
const NODE_TYPES: NodeTypes = {
  component: ComponentNode,
  net: NetNode,
};

// CSS custom properties cascade to child button elements, so setting them
// inline on the Controls container is the only approach that beats the
// library's :root defaults regardless of stylesheet load order.
const CONTROLS_STYLE = {
  boxShadow: "none",
  "--xy-controls-button-background-color-default": "rgba(8,8,8,0.95)",
  "--xy-controls-button-background-color-hover-default": "rgba(255,255,255,0.06)",
  "--xy-controls-button-color-default": "#64748b",
  "--xy-controls-button-color-hover-default": "#e2e8f0",
  "--xy-controls-button-border-color-default": "rgba(255,255,255,0.07)",
  "--xy-controls-box-shadow-default": "none",
} as CSSProperties;

// ── Graph builder ─────────────────────────────────────────────────────────────

function buildFlowElements(
  graph: ConnectivityGraph,
  focusedId: string | null
): { nodes: Node[]; edges: Edge[] } {
  // Resolve the focused node's neighborhood
  const fComps = new Set<string>();
  const fNets = new Set<string>();
  if (focusedId?.startsWith("c:")) {
    const refDes = focusedId.slice(2);
    fComps.add(refDes);
    netsForComponent(graph, refDes).forEach((n) => fNets.add(n));
  } else if (focusedId?.startsWith("n:")) {
    const name = focusedId.slice(2);
    fNets.add(name);
    componentsForNet(graph, name).forEach((r) => fComps.add(r));
  }
  const hasFocus = focusedId !== null;

  // Center the shorter column relative to the taller one
  const compSpan = Math.max(0, graph.components.length - 1) * V_GAP;
  const netSpan = Math.max(0, graph.nets.length - 1) * V_GAP;
  const maxSpan = Math.max(compSpan, netSpan);
  const cY0 = PAD_Y + (maxSpan - compSpan) / 2;
  const nY0 = PAD_Y + (maxSpan - netSpan) / 2;

  const nodes: Node[] = [
    ...graph.components.map((c, i) => ({
      id: `c:${c.refDes}`,
      type: "component",
      position: { x: COMP_X, y: cY0 + i * V_GAP },
      data: {
        label: c.refDes,
        sub: c.name ?? c.value ?? null,
        pins: c.pinNumbers.length,
        focused: fComps.has(c.refDes),
        dim: hasFocus && !fComps.has(c.refDes),
      } satisfies CompData,
      draggable: false,
      selectable: false,
    })),
    ...graph.nets.map((n, i) => ({
      id: `n:${n.name}`,
      type: "net",
      position: { x: NET_X, y: nY0 + i * V_GAP },
      data: {
        label: n.name,
        pins: n.pinCount,
        focused: fNets.has(n.name),
        dim: hasFocus && !fNets.has(n.name),
      } satisfies NetData,
      draggable: false,
      selectable: false,
    })),
  ];

  // Deduplicate edges: one per (component, net) pair regardless of pin count
  const seen = new Set<string>();
  const edges: Edge[] = [];
  for (const conn of graph.connections) {
    const id = `${conn.componentRefDes}→${conn.netName}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const isActive =
      hasFocus &&
      fComps.has(conn.componentRefDes) &&
      fNets.has(conn.netName);
    const isDim = hasFocus && !isActive;

    edges.push({
      id,
      source: `c:${conn.componentRefDes}`,
      target: `n:${conn.netName}`,
      animated: isActive,
      style: {
        stroke: isActive
          ? "rgba(96,165,250,0.8)"
          : isDim
            ? "rgba(255,255,255,0.04)"
            : "rgba(96,165,250,0.22)",
        strokeWidth: isActive ? 2 : 1.2,
        transition: "stroke 0.14s, stroke-width 0.14s",
      },
    });
  }

  return { nodes, edges };
}

// ── Tab component ─────────────────────────────────────────────────────────────

export function ConnectivityTab({ graph }: { graph: ConnectivityGraph }) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

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
    () => buildFlowElements(graph, focusedId),
    [graph, focusedId]
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

  // Build a one-line description of what's in focus
  let focusDetail: string | null = null;
  if (focusedId?.startsWith("c:")) {
    const refDes = focusedId.slice(2);
    const nets = netsForComponent(graph, refDes);
    focusDetail = `${refDes} → ${nets.join(", ")}`;
  } else if (focusedId?.startsWith("n:")) {
    const name = focusedId.slice(2);
    const comps = componentsForNet(graph, name);
    focusDetail = `${name} ← ${comps.join(", ")}`;
  }

  // Count unique edges for the stats footer
  const uniqueEdgeCount = new Set(
    graph.connections.map((c) => `${c.componentRefDes}→${c.netName}`)
  ).size;

  const inner = (
    <div className={isFullscreen ? "flex h-full flex-col gap-2" : "space-y-2"}>
      {/* Legend + focus readout + fullscreen toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#4a5568]">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm border border-[rgba(96,165,250,0.35)]" />
            Component
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full border border-[rgba(255,255,255,0.15)]" />
            Net
          </span>
          <span className="text-[#2a2a35]">Click a node to trace connections · click again to clear</span>
        </div>
        <div className="flex items-center gap-2">
          {focusDetail && (
            <span className="rounded border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-2 py-0.5 font-mono text-[#94a3b8]">
              {focusDetail}
            </span>
          )}
          <button
            onClick={() => setIsFullscreen((v) => !v)}
            title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
            className="rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(8,8,8,0.95)] p-1.5 text-[#64748b] transition-colors hover:border-[rgba(255,255,255,0.15)] hover:text-[#e2e8f0]"
          >
            {isFullscreen ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M6 2L2 2L2 6M10 2L14 2L14 6M6 14L2 14L2 10M10 14L14 14L14 10" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Graph */}
      <div
        className="overflow-hidden rounded-lg border border-[rgba(255,255,255,0.08)]"
        style={isFullscreen ? { flex: 1 } : { height: 460 }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          fitView
          fitViewOptions={{ padding: 0.25 }}
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
      </div>

      {/* Stats */}
      <p className="text-xs text-[#2a2a35]">
        {graph.components.length} components · {graph.nets.length} nets ·{" "}
        {uniqueEdgeCount} connections
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
