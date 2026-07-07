import { describe, expect, it } from "vitest";

import { buildGraph, type PinConnection } from "@/types/connectivity";
import {
  analyzeComponent,
  analyzeNet,
  summarizeTopology,
} from "./ee-graph-queries";

// Mini buck-ish board (mirrors ee-graph-semantics.test fixture).
function demoGraph() {
  const conns: PinConnection[] = [
    { componentRefDes: "J1", pinNumber: "1", netName: "VIN" },
    { componentRefDes: "F1", pinNumber: "1", netName: "VIN" },
    { componentRefDes: "F1", pinNumber: "2", netName: "VIN_F" },
    { componentRefDes: "U1", pinNumber: "1", netName: "VIN_F" },
    { componentRefDes: "U1", pinNumber: "2", netName: "3V3" },
    { componentRefDes: "U1", pinNumber: "3", netName: "GND" },
    { componentRefDes: "U1", pinNumber: "4", netName: "AMP_OUT" },
    { componentRefDes: "R3", pinNumber: "1", netName: "AMP_OUT" },
    { componentRefDes: "R3", pinNumber: "2", netName: "GND" },
    { componentRefDes: "C1", pinNumber: "1", netName: "VIN_F" },
    { componentRefDes: "C1", pinNumber: "2", netName: "GND" },
    { componentRefDes: "C2", pinNumber: "1", netName: "3V3" },
    { componentRefDes: "C2", pinNumber: "2", netName: "GND" },
    { componentRefDes: "C3", pinNumber: "1", netName: "3V3" },
    { componentRefDes: "C3", pinNumber: "2", netName: "GND" },
    { componentRefDes: "R1", pinNumber: "1", netName: "3V3" },
    { componentRefDes: "R1", pinNumber: "2", netName: "3V3_PERIPH" },
    { componentRefDes: "R2", pinNumber: "1", netName: "3V3_PERIPH" },
    { componentRefDes: "R2", pinNumber: "2", netName: "GND" },
  ];
  const g = buildGraph(conns, [{ refDes: "R1", value: "0" }]);
  return g;
}

describe("summarizeTopology", () => {
  const t = summarizeTopology(demoGraph());

  it("counts components/nets/connections", () => {
    expect(t.counts.components).toBeGreaterThan(0);
    expect(t.counts.nets).toBeGreaterThan(0);
  });

  it("groups nets by tier label", () => {
    expect(Object.keys(t.netsByTier)).toContain("ground");
    expect(Object.keys(t.netsByTier)).toContain("regulated rail");
  });

  it("flags the jumper, decoupling caps, and fuse-less connector set", () => {
    expect(t.flagged.jumpers.map((j) => j.refDes)).toContain("R1");
    expect(t.flagged.decouplingCaps.map((c) => c.refDes)).toEqual(
      expect.arrayContaining(["C1", "C2", "C3"])
    );
    expect(t.flagged.connectors).toContain("J1");
  });

  it("reports high fan-out nets", () => {
    expect(t.highFanoutNets.map((n) => n.net)).toContain("GND");
  });
});

describe("analyzeNet", () => {
  it("classifies a net and resolves names fuzzily", () => {
    const g = demoGraph();
    expect(analyzeNet(g, "3v3")?.tierLabel).toBe("regulated rail");
    expect(analyzeNet(g, "GND")?.highFanout).toBe(true);
    expect(analyzeNet(g, "GND")?.fanoutWarning).toBeTruthy();
  });
  it("returns null for unknown nets", () => {
    expect(analyzeNet(demoGraph(), "NOPE")).toBeNull();
  });
});

describe("analyzeComponent", () => {
  it("classifies a jumper", () => {
    const r1 = analyzeComponent(demoGraph(), "R1");
    expect(r1?.isJumper).toBe(true);
    expect(r1?.jumperIsolates).toEqual(
      expect.arrayContaining(["3V3", "3V3_PERIPH"])
    );
  });
  it("classifies a decoupling cap", () => {
    expect(analyzeComponent(demoGraph(), "C1")?.isDecoupling).toBe(true);
  });
  it("returns null for unknown refdes", () => {
    expect(analyzeComponent(demoGraph(), "X99")).toBeNull();
  });
});
