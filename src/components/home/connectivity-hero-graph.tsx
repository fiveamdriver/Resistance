"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type CompData = { label: string; sub: string; focal?: boolean };
type NetData  = { label: string; kind: "signal" | "power" | "control" };

const HANDLE = { style: { opacity: 0, pointerEvents: "none" as const } };

function ComponentNode({ data }: NodeProps) {
  const d = data as CompData;
  return (
    <div style={{
      padding: "7px 12px", borderRadius: 5, fontFamily: "monospace", userSelect: "none",
      border: `1px solid ${d.focal ? "rgba(74,158,255,0.5)" : "rgba(255,255,255,0.11)"}`,
      background: d.focal ? "rgba(74,158,255,0.07)" : "rgba(255,255,255,0.025)",
      boxShadow: d.focal ? "0 0 16px rgba(74,158,255,0.12)" : "none",
    }}>
      <Handle type="target" position={Position.Left}   {...HANDLE} />
      <Handle type="source" position={Position.Right}  {...HANDLE} />
      <Handle type="target" position={Position.Top}    id="t-t" {...HANDLE} />
      <Handle type="source" position={Position.Bottom} id="b-s" {...HANDLE} />
      <div style={{ fontSize: 11, fontWeight: 700, color: "#93c5fd" }}>{d.label}</div>
      <div style={{ fontSize: 9, marginTop: 2, color: "#374151" }}>{d.sub}</div>
    </div>
  );
}

function NetNode({ data }: NodeProps) {
  const d = data as NetData;
  const palette = {
    signal:  { border: "rgba(147,197,253,0.3)", color: "#93c5fd", bg: "rgba(147,197,253,0.05)" },
    power:   { border: "rgba(251,191,36,0.3)",  color: "#fbbf24", bg: "rgba(251,191,36,0.05)"  },
    control: { border: "rgba(134,239,172,0.3)", color: "#86efac", bg: "rgba(134,239,172,0.05)" },
  }[d.kind];
  return (
    <div style={{
      padding: "5px 10px", borderRadius: 4, fontFamily: "monospace", fontSize: 9,
      fontWeight: 600, letterSpacing: "0.04em", userSelect: "none",
      border: `1px solid ${palette.border}`, color: palette.color, background: palette.bg,
    }}>
      <Handle type="target" position={Position.Left}   {...HANDLE} />
      <Handle type="source" position={Position.Right}  {...HANDLE} />
      <Handle type="target" position={Position.Top}    id="t-t" {...HANDLE} />
      <Handle type="source" position={Position.Bottom} id="b-s" {...HANDLE} />
      {d.label}
    </div>
  );
}

const nodeTypes: NodeTypes = { component: ComponentNode, net: NetNode };

const NODES: Node[] = [
  { id: "c46",  type: "component", position: { x: -150, y: 20  }, data: { label: "C46",        sub: "10µF" } as CompData },
  { id: "c45",  type: "component", position: { x: -150, y: 122 }, data: { label: "C45",        sub: "100nF" } as CompData },
  { id: "u3",   type: "component", position: { x: -150, y: 258 }, data: { label: "U3",         sub: "TPS62135" } as CompData },
  { id: "n3v3", type: "net",       position: { x: -38,  y: 280 }, data: { label: "3V3_PERIPH", kind: "power" } as NetData },
  { id: "nvdd", type: "net",       position: { x: 25,   y: 135 }, data: { label: "VDD",        kind: "power" } as NetData },
  { id: "ngnd", type: "net",       position: { x: -20,  y: 215 }, data: { label: "GND",        kind: "power" } as NetData },
  { id: "u7",   type: "component", position: { x: 142,  y: 143 }, data: { label: "U7",         sub: "STM32F446", focal: true } as CompData },
  { id: "r12",  type: "component", position: { x: 235,  y: 110 }, data: { label: "R12",        sub: "10kΩ" } as CompData },
  { id: "nspi", type: "net",       position: { x: 340,  y: 46  }, data: { label: "SPI_CLK",   kind: "signal" } as NetData },
  { id: "ncsn", type: "net",       position: { x: 340,  y: 175 }, data: { label: "CS_N",      kind: "signal" } as NetData },
  { id: "npwr", type: "net",       position: { x: 340,  y: 272 }, data: { label: "PWR_EN",    kind: "control" } as NetData },
  { id: "ic1",  type: "component", position: { x: 440,  y: 82  }, data: { label: "IC1",       sub: "SPI Flash" } as CompData },
  { id: "q3",   type: "component", position: { x: 440,  y: 280 }, data: { label: "Q3",        sub: "N-MOSFET" } as CompData },
];

const pwr  = { stroke: "rgba(251,191,36,0.2)",  strokeWidth: 1 };
const sig  = { stroke: "rgba(147,197,253,0.2)", strokeWidth: 1 };
const ctrl = { stroke: "rgba(134,239,172,0.2)", strokeWidth: 1 };

const EDGES: Edge[] = [
  { id: "e0",  source: "c46",  target: "nvdd",  animated: true, style: pwr  },
  { id: "e0b", source: "c46",  target: "ngnd",  animated: true, style: pwr  },
  { id: "e1",  source: "c45",  target: "nvdd",  animated: true, style: pwr  },
  { id: "e1b", source: "c45",  target: "ngnd",  animated: true, style: pwr  },
  { id: "e2",  source: "u3",   target: "n3v3",  animated: true, style: pwr  },
  { id: "e3",  source: "n3v3", target: "nvdd",  animated: true, style: pwr  },
  { id: "e4",  source: "nvdd", target: "u7",    animated: true, style: pwr  },
  { id: "e5",  source: "nvdd", target: "r12",   animated: true, style: pwr  },
  { id: "e6",  source: "r12",  target: "ncsn",  animated: true, style: sig  },
  { id: "e7a", source: "u7",   target: "nspi",  animated: true, style: sig  },
  { id: "e7",  source: "nspi", target: "ic1",   animated: true, style: sig  },
  { id: "e8",  source: "u7",   target: "ncsn",  animated: true, style: sig  },
  { id: "e9",  source: "ncsn", target: "ic1",   animated: true, style: sig  },
  { id: "e10", source: "u7",   target: "npwr",  animated: true, style: ctrl },
  { id: "e11", source: "npwr", target: "q3",    animated: true, style: ctrl },
];

const FIT_OPTIONS = { padding: 0.14 };

export default function ConnectivityHeroGraph() {
  const [mounted, setMounted] = useState(false);
  const rfInstance = useRef<ReactFlowInstance | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted || !containerRef.current) return;
    const ro = new ResizeObserver(() => {
      rfInstance.current?.fitView(FIT_OPTIONS);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [mounted]);

  const onInit = useCallback((instance: ReactFlowInstance) => {
    rfInstance.current = instance;
  }, []);

  if (!mounted) return null;

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={NODES}
        edges={EDGES}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={FIT_OPTIONS}
        onInit={onInit}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
        style={{ background: "transparent" }}
      />
    </div>
  );
}
