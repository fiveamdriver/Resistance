"use client";
import * as Tabs from "@radix-ui/react-tabs";
import { BookOpen, GitBranch, Table2, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// ─── Feature visuals ──────────────────────────────────────────────────────────

function KBVisual() {
  return (
    <div className="w-full rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-4 font-mono text-xs text-[#94a3b8]">
      <div className="mb-3 flex items-center gap-2 rounded border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.03)] px-3 py-2">
        <span className="text-[#93c5fd]">⌕</span>
        <span className="text-[#93c5fd]">&quot;U7 bypass&quot;</span>
        <span className="ml-2 text-[#3f3f4f]">— 3 results</span>
      </div>
      <div className="space-y-1.5">
        {[
          { icon: "◈", name: "power_board.SchDoc", tag: "netlist",   match: true },
          { icon: "▦", name: "BOM_rev3.xlsx",      tag: "bom",       match: true },
          { icon: "▤", name: "TPS62135.pdf",        tag: "datasheet", match: false },
          { icon: "◈", name: "constraints.rpt",    tag: "report",    match: false },
        ].map((f) => (
          <div
            key={f.name}
            className={`flex items-center gap-2 rounded px-2 py-1.5 ${
              f.match
                ? "border border-[rgba(96,165,250,0.2)] bg-[rgba(96,165,250,0.05)] text-[#93c5fd]"
                : ""
            }`}
          >
            <span className="text-[rgba(96,165,250,0.4)]">{f.icon}</span>
            <span>{f.name}</span>
            <span className="ml-auto rounded border border-[rgba(255,255,255,0.06)] px-1 py-0.5 text-[10px] text-[#3f3f4f]">
              {f.tag}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 border-t border-[rgba(255,255,255,0.05)] pt-3">
        <div className="text-[#93c5fd]">C45, C46, C47</div>
        <div className="mt-0.5 text-[#3f3f4f]">refdes · net: +3V3_PERIPH · U7 pin 14 (VDD)</div>
      </div>
    </div>
  );
}

function ConnectivityVisual() {
  const nodes = [
    { x: 50,  y: 45,  label: "R12", sub: "SPI_CLK" },
    { x: 230, y: 45,  label: "U3",  sub: "SCK" },
    { x: 45,  y: 145, label: "C45", sub: "+3V3" },
    { x: 230, y: 145, label: "TP7", sub: "nRST" },
    { x: 140, y: 15,  label: "+5V", sub: "PWR" },
  ];
  return (
    <div className="w-full rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-4">
      <div className="mb-2 font-mono text-[10px] text-[#3f3f4f]">
        Connectivity: U7 → neighbors (5 connections)
      </div>
      <svg viewBox="0 0 280 185" className="w-full" aria-hidden="true">
        {nodes.map((n) => (
          <g key={n.label}>
            <line
              x1={140} y1={95} x2={n.x} y2={n.y}
              stroke="#60a5fa" strokeOpacity={0.18} strokeWidth={0.75}
              strokeDasharray="3 4"
            />
            <text
              x={(140 + n.x) / 2}
              y={(95 + n.y) / 2 - 4}
              textAnchor="middle"
              fill="rgba(96,165,250,0.2)"
              fontSize={7}
              fontFamily="monospace"
            >
              {n.sub}
            </text>
          </g>
        ))}
        {/* Center node */}
        <circle cx={140} cy={95} r={22}
          fill="rgba(96,165,250,0.07)"
          stroke="rgba(96,165,250,0.4)"
          strokeWidth={1} />
        <text x={140} y={92} textAnchor="middle" dominantBaseline="middle"
          fill="#60a5fa" fontSize={11} fontFamily="monospace" fontWeight="bold">U7</text>
        <text x={140} y={105} textAnchor="middle"
          fill="#93c5fd" fontSize={8} fontFamily="monospace">MCU</text>
        {/* Satellite nodes */}
        {nodes.map((n) => (
          <g key={`node-${n.label}`}>
            <circle cx={n.x} cy={n.y} r={16}
              fill="rgba(255,255,255,0.03)"
              stroke="rgba(255,255,255,0.1)"
              strokeWidth={1} />
            <text x={n.x} y={n.y} textAnchor="middle" dominantBaseline="middle"
              fill="#93c5fd" fontSize={9} fontFamily="monospace">{n.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function BOMVisual() {
  type Status = "ok" | "warn" | "error";
  const rows: { ref: string; mpn: string; val: string; qty: number; status: Status }[] = [
    { ref: "U7",  mpn: "STM32F446RET6",  val: "MCU",   qty: 1,  status: "ok" },
    { ref: "R12", mpn: "RC0402FR-0710K", val: "10kΩ",  qty: 15, status: "ok" },
    { ref: "C45", mpn: "GRM1885C1H100",  val: "100nF", qty: 4,  status: "warn" },
    { ref: "L1",  mpn: "—",              val: "4.7μH", qty: 2,  status: "error" },
  ];
  const rowBg: Record<Status, string> = {
    ok: "",
    warn: "bg-amber-950/20",
    error: "bg-red-950/20",
  };
  const statusColor: Record<Status, string> = {
    ok: "text-[#93c5fd]",
    warn: "text-amber-400",
    error: "text-red-400",
  };
  return (
    <div className="w-full overflow-hidden rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)]">
      <div className="flex gap-2 border-b border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.03)] px-4 py-2 font-mono text-[10px] text-[#3f3f4f]">
        <span className="w-9">Ref</span>
        <span className="flex-1">MPN</span>
        <span className="w-12">Value</span>
        <span className="w-6 text-right">Qty</span>
        <span className="w-20 text-right">Status</span>
      </div>
      {rows.map((r) => (
        <div
          key={r.ref}
          className={`flex items-center gap-2 border-b border-[rgba(255,255,255,0.04)] px-4 py-2 font-mono text-[11px] ${rowBg[r.status]}`}
        >
          <span className="w-9 text-[#60a5fa]">{r.ref}</span>
          <span className="flex-1 truncate text-[#94a3b8]">{r.mpn}</span>
          <span className="w-12 text-[#94a3b8]">{r.val}</span>
          <span className="w-6 text-right text-[#3f3f4f]">{r.qty}</span>
          <span className={`w-20 text-right text-[10px] ${statusColor[r.status]}`}>
            {r.status === "ok" ? "✓ matched" : r.status === "warn" ? "⚠ mfr?" : "✗ no MPN"}
          </span>
        </div>
      ))}
      <div className="px-4 py-2 font-mono text-[10px] text-[#3f3f4f]">
        128 total · 124 matched ·{" "}
        <span className="text-amber-400">3 warnings</span> ·{" "}
        <span className="text-red-400">1 error</span>
      </div>
    </div>
  );
}

function AIVisual() {
  return (
    <div className="w-full rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-4 font-mono text-xs">
      <div className="space-y-3">
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-lg rounded-tr-none border border-[rgba(96,165,250,0.2)] bg-[rgba(96,165,250,0.06)] px-3 py-2 text-[#93c5fd]">
            What connects to pin 4 of U7?
          </div>
        </div>
        <div className="flex">
          <div className="max-w-[90%] space-y-1 rounded-lg rounded-tl-none border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-[#94a3b8]">
            <div className="mb-1.5 text-[#93c5fd]">U7 pin 4 — net: SPI_CLK</div>
            <div>· <span className="text-[#60a5fa]">R12</span> pin 1</div>
            <div>· <span className="text-[#60a5fa]">U3</span> pin 23 (SCK)</div>
            <div>· <span className="text-[#60a5fa]">TP7</span> (test point)</div>
            <div className="mt-1.5 text-[#3f3f4f]">3 connections on SPI_CLK</div>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-3 py-2 text-[#2a2a35]">
          <span>Ask about your design…</span>
          <span className="ml-auto text-[rgba(96,165,250,0.2)]">⏎</span>
        </div>
      </div>
    </div>
  );
}

// ─── Tab definitions ─────────────────────────────────────────────────────────

const TABS = [
  {
    value: "knowledge",
    icon: <BookOpen className="h-4 w-4" />,
    label: "Knowledge Base",
    badge: "Upload & Index",
    title: "One searchable workspace",
    description:
      "Upload Altium exports — .SchDoc, .brd, BOMs, datasheets, and constraint reports. Every file is parsed and indexed, searchable instantly by refdes, net name, or part number.",
    buttonText: "Explore your files",
    visual: <KBVisual />,
  },
  {
    value: "connectivity",
    icon: <GitBranch className="h-4 w-4" />,
    label: "Connectivity Graph",
    badge: "Net Navigator",
    title: "Navigate your schematic like a map",
    description:
      "Instantly query what connects to U7, what's on the 5V net, or which ICs share a SPI bus. The graph engine traces every connection across your netlist — refdes to net to pin to component.",
    buttonText: "Explore the graph",
    visual: <ConnectivityVisual />,
  },
  {
    value: "bom",
    icon: <Table2 className="h-4 w-4" />,
    label: "BOM Intelligence",
    badge: "BOM Parser",
    title: "BOMs that actually make sense",
    description:
      "Match BOM rows to placed components by refdes. Link datasheets to the correct part numbers. Surface mismatches — wrong footprint, missing MPN, unresolved substitutions — before they hit the fab house.",
    buttonText: "Inspect your BOM",
    visual: <BOMVisual />,
  },
  {
    value: "ai",
    icon: <MessageSquare className="h-4 w-4" />,
    label: "AI Assistant",
    badge: "AI Assistant",
    title: "Ask your design anything",
    description:
      "Query in plain English. Get answers grounded in your actual netlist, BOM, and datasheets. Surface design-review risks, trace net connectivity, or find which component has no datasheet.",
    buttonText: "Try the assistant",
    visual: <AIVisual />,
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function FeatureTabs() {
  return (
    <section className="pt-10 pb-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <Badge variant="outline">Engineering Intelligence</Badge>
          <h2 className="max-w-2xl text-3xl font-semibold text-white md:text-4xl">
            Know your design. Navigate it.
          </h2>
          <p className="max-w-xl text-[#94a3b8]">
            Purpose-built tools for electrical engineers working with complex PCB
            projects — from first schematic capture to design review.
          </p>
        </div>

        <Tabs.Root defaultValue="knowledge" className="mt-12">
          <Tabs.List className="flex flex-wrap items-center justify-center gap-2 md:gap-3">
            {TABS.map((tab) => (
              <Tabs.Trigger
                key={tab.value}
                value={tab.value}
                className="flex items-center gap-2 rounded-lg border border-[rgba(255,255,255,0.1)] px-4 py-2.5 text-sm font-medium text-[#94a3b8] outline-none transition-all hover:border-[rgba(255,255,255,0.25)] hover:text-white data-[state=active]:border-[rgba(255,255,255,0.3)] data-[state=active]:bg-[rgba(255,255,255,0.06)] data-[state=active]:text-white"
              >
                {tab.icon}
                {tab.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          <div className="mx-auto mt-6 max-w-5xl rounded-2xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-6 lg:p-12">
            {TABS.map((tab) => (
              <Tabs.Content
                key={tab.value}
                value={tab.value}
                className="grid place-items-center gap-12 outline-none lg:grid-cols-2 lg:gap-10"
              >
                <div className="flex flex-col gap-4">
                  <Badge variant="outline" className="w-fit">
                    {tab.badge}
                  </Badge>
                  <h3 className="text-2xl font-semibold text-white lg:text-4xl">
                    {tab.title}
                  </h3>
                  <p className="text-[#94a3b8] lg:text-base">{tab.description}</p>
                  <button className="mt-2 w-fit rounded-md bg-white px-6 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90">
                    {tab.buttonText}
                  </button>
                </div>
                <div className="w-full">{tab.visual}</div>
              </Tabs.Content>
            ))}
          </div>
        </Tabs.Root>
      </div>
    </section>
  );
}
