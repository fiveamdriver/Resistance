import { describe, expect, it } from "vitest";

import type { ConnectivityGraph, PinConnection } from "@/types/connectivity";
import { buildGraph } from "@/types/connectivity";
import { classifyGraph } from "./ee-graph-semantics";
import {
  buildFocusModel,
  buildOverviewModel,
  buildPowerTreeModel,
  isMajorComponent,
  MAX_SPOKE_NEIGHBORS,
  type ComponentFocusModel,
  type NetFocusModel,
} from "./ee-graph-views";

// A small but complete board exercising every view rule:
//
//   J1(VIN) → F1(fuse) → VIN_FUSED → U1(regulator) → 3V3 (+ GND)
//   U1 ↔ U2: SPI_CLK + SPI_MOSI shared directly (parallel-net bundling)
//   U2 → R5(series 33Ω) → LCD_CLK → J2 (bridge through one series passive)
//   U1, U2, J2 all on 3V3 and GND (power/ground must NOT become edges)
//   C1 bypass on 3V3 (excluded everywhere), R9 pull-down load on 3V3
//   X1: 6-pin unrecognized prefix (major); R9: 2-pin (not major)
function demoBoard(): ConnectivityGraph {
  const conns: PinConnection[] = [
    // power entry → fuse → regulator → rail
    { componentRefDes: "J1", pinNumber: "1", netName: "VIN" },
    { componentRefDes: "J1", pinNumber: "2", netName: "GND" },
    { componentRefDes: "F1", pinNumber: "1", netName: "VIN" },
    { componentRefDes: "F1", pinNumber: "2", netName: "VIN_FUSED" },
    { componentRefDes: "U1", pinNumber: "1", netName: "VIN_FUSED" },
    { componentRefDes: "U1", pinNumber: "2", netName: "3V3" },
    { componentRefDes: "U1", pinNumber: "3", netName: "GND" },
    // U1 ↔ U2 direct signal nets (two in parallel → bundling)
    { componentRefDes: "U1", pinNumber: "4", netName: "SPI_CLK" },
    { componentRefDes: "U1", pinNumber: "5", netName: "SPI_MOSI" },
    { componentRefDes: "U2", pinNumber: "1", netName: "SPI_CLK" },
    { componentRefDes: "U2", pinNumber: "2", netName: "SPI_MOSI" },
    { componentRefDes: "U2", pinNumber: "3", netName: "3V3" },
    { componentRefDes: "U2", pinNumber: "4", netName: "GND" },
    // U2 → series R5 → J2 (bridge through one passive)
    { componentRefDes: "U2", pinNumber: "5", netName: "LCD_CLK_SRC" },
    { componentRefDes: "R5", pinNumber: "1", netName: "LCD_CLK_SRC" },
    { componentRefDes: "R5", pinNumber: "2", netName: "LCD_CLK" },
    { componentRefDes: "J2", pinNumber: "1", netName: "LCD_CLK" },
    { componentRefDes: "J2", pinNumber: "2", netName: "3V3" },
    { componentRefDes: "J2", pinNumber: "3", netName: "GND" },
    // bypass cap + resistive load on the rail
    { componentRefDes: "C1", pinNumber: "1", netName: "3V3" },
    { componentRefDes: "C1", pinNumber: "2", netName: "GND" },
    { componentRefDes: "R9", pinNumber: "1", netName: "3V3" },
    { componentRefDes: "R9", pinNumber: "2", netName: "GND" },
    // X1: unrecognized prefix, 6 pins → major
    { componentRefDes: "X1", pinNumber: "1", netName: "SPI_CLK" },
    { componentRefDes: "X1", pinNumber: "2", netName: "GND" },
    { componentRefDes: "X1", pinNumber: "3", netName: "3V3" },
    { componentRefDes: "X1", pinNumber: "4", netName: "XA" },
    { componentRefDes: "X1", pinNumber: "5", netName: "XB" },
    { componentRefDes: "X1", pinNumber: "6", netName: "XC" },
  ];
  return buildGraph(conns);
}

const graph = demoBoard();
const classified = classifyGraph(graph);

describe("isMajorComponent", () => {
  it("keeps ICs and connectors, drops passives", () => {
    expect(isMajorComponent(classified.components.get("U1")!)).toBe(true);
    expect(isMajorComponent(classified.components.get("J1")!)).toBe(true);
    expect(isMajorComponent(classified.components.get("R5")!)).toBe(false);
    expect(isMajorComponent(classified.components.get("C1")!)).toBe(false);
  });
  it("keeps unrecognized-prefix parts with ≥5 pins, drops small ones", () => {
    expect(isMajorComponent(classified.components.get("X1")!)).toBe(true);
    expect(isMajorComponent(classified.components.get("R9")!)).toBe(false);
  });
});

describe("buildOverviewModel", () => {
  const model = buildOverviewModel(graph, classified);
  const edge = (a: string, b: string) =>
    model.edges.find(
      (e) =>
        (e.source === a && e.target === b) ||
        (e.source === b && e.target === a)
    );

  it("includes only major components", () => {
    // Fuses and passives are not block-diagram parts.
    const ids = model.nodes.map((n) => n.refDes).sort();
    expect(ids).toEqual(["J1", "J2", "U1", "U2", "X1"]);
  });

  it("bundles parallel signal nets into one edge", () => {
    const e = edge("U1", "U2")!;
    expect(e).toBeDefined();
    expect(e.links.map((l) => l.nets[0]).sort()).toEqual([
      "SPI_CLK",
      "SPI_MOSI",
    ]);
  });

  it("bridges through one series passive", () => {
    const e = edge("U2", "J2")!;
    expect(e).toBeDefined();
    const bridged = e.links.find((l) => l.via === "R5")!;
    expect(bridged).toBeDefined();
    expect(bridged.nets.sort()).toEqual(["LCD_CLK", "LCD_CLK_SRC"]);
  });

  it("never draws power or ground as edges", () => {
    // U1/J2 share only 3V3 + GND — no edge between them.
    expect(edge("U1", "J2")).toBeUndefined();
    for (const e of model.edges) {
      for (const l of e.links) {
        expect(l.nets).not.toContain("GND");
        expect(l.nets).not.toContain("3V3");
      }
    }
  });

  it("badges the rails each node touches, omitting GND", () => {
    const u1 = model.nodes.find((n) => n.refDes === "U1")!;
    expect(u1.rails.map((r) => r.tier)).toEqual(["high_power", "regulated"]);
    expect(u1.rails.find((r) => r.tier === "regulated")!.nets).toEqual(["3V3"]);
    expect(u1.rails.flatMap((r) => r.nets)).not.toContain("GND");
  });
});

describe("buildFocusModel (component)", () => {
  it("collapses power/GND spokes by default and reports them", () => {
    const m = buildFocusModel(
      graph,
      classified,
      "c:U2"
    ) as ComponentFocusModel;
    expect(m.kind).toBe("component");
    const spokeNets = m.spokes.map((s) => s.net).sort();
    expect(spokeNets).toEqual(["LCD_CLK_SRC", "SPI_CLK", "SPI_MOSI"]);
    expect(m.hiddenPowerNets.map((h) => h.net).sort()).toEqual(["3V3", "GND"]);
  });

  it("shows power/GND spokes when showPowerPins is on", () => {
    const m = buildFocusModel(graph, classified, "c:U2", {
      showPowerPins: true,
    }) as ComponentFocusModel;
    expect(m.spokes.map((s) => s.net).sort()).toEqual([
      "3V3",
      "GND",
      "LCD_CLK_SRC",
      "SPI_CLK",
      "SPI_MOSI",
    ]);
    expect(m.hiddenPowerNets).toEqual([]);
  });

  it("lists the right neighbors on each spoke", () => {
    const m = buildFocusModel(
      graph,
      classified,
      "c:U1"
    ) as ComponentFocusModel;
    const clk = m.spokes.find((s) => s.net === "SPI_CLK")!;
    expect(clk.neighbors.sort()).toEqual(["U2", "X1"]);
    expect(clk.moreCount).toBe(0);
  });

  it("caps neighbors per spoke", () => {
    // GND touches many parts; with power pins shown it must stay capped.
    const m = buildFocusModel(graph, classified, "c:U1", {
      showPowerPins: true,
    }) as ComponentFocusModel;
    const gnd = m.spokes.find((s) => s.net === "GND")!;
    expect(gnd.neighbors.length).toBeLessThanOrEqual(MAX_SPOKE_NEIGHBORS);
  });

  it("returns null for unknown ids", () => {
    expect(buildFocusModel(graph, classified, "c:NOPE")).toBeNull();
    expect(buildFocusModel(graph, classified, "bogus")).toBeNull();
  });
});

describe("buildFocusModel (net)", () => {
  it("lists every member with its pins on the net", () => {
    const m = buildFocusModel(graph, classified, "n:SPI_CLK") as NetFocusModel;
    expect(m.kind).toBe("net");
    expect(m.center.net).toBe("SPI_CLK");
    expect(m.members.map((x) => x.refDes).sort()).toEqual(["U1", "U2", "X1"]);
    expect(m.members.find((x) => x.refDes === "U1")!.pinNumbers).toEqual(["4"]);
  });
});

describe("buildPowerTreeModel", () => {
  const m = buildPowerTreeModel(graph, classified);
  const node = (id: string) => m.nodes.find((n) => n.id === id);

  it("detects entry, protection, and regulator roles", () => {
    expect(node("c:J1")?.role).toBe("entry");
    expect(node("c:F1")?.role).toBe("protection");
    expect(node("c:U1")?.role).toBe("regulator");
    // U2 sits on one rail only — not a regulator, not in the tree.
    expect(node("c:U2")).toBeUndefined();
  });

  it("orders columns source → fuse → regulator → rail", () => {
    const col = (id: string) => node(id)!.column;
    expect(col("c:J1")).toBeLessThan(col("n:VIN"));
    expect(col("n:VIN")).toBeLessThan(col("c:F1"));
    expect(col("c:F1")).toBeLessThan(col("n:VIN_FUSED"));
    expect(col("n:VIN_FUSED")).toBeLessThan(col("c:U1"));
    expect(col("c:U1")).toBeLessThan(col("n:3V3"));
  });

  it("summarizes rail loads, excluding bypass caps and the power path", () => {
    const rail = node("n:3V3")!;
    // Loads on 3V3: U2, J2, R9, X1 — C1 (bypass) and U1 (regulator) excluded.
    expect(rail.loads?.sort()).toEqual(["J2", "R9", "U2", "X1"]);
    expect(rail.loadCount).toBe(4);
  });

  it("connects the path with directed edges", () => {
    const ids = m.edges.map((e) => e.id);
    expect(ids).toContain("c:J1→n:VIN");
    expect(ids).toContain("n:VIN→c:F1");
    expect(ids).toContain("c:U1→n:3V3");
  });

  it("keeps GND out of the power tree", () => {
    expect(node("n:GND")).toBeUndefined();
  });
});
