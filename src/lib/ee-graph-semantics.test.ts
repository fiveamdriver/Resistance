import { describe, expect, it } from "vitest";

import type { ConnectivityGraph, PinConnection } from "@/types/connectivity";
import { buildGraph } from "@/types/connectivity";
import {
  classifyComponentType,
  classifyGraph,
  classifyNetByName,
  isDnpMarked,
  isZeroOhmValue,
} from "./ee-graph-semantics";

describe("classifyNetByName", () => {
  it("maps high-side power rails", () => {
    expect(classifyNetByName("VIN")).toBe("high_power");
    expect(classifyNetByName("VIN_RAW")).toBe("high_power");
    expect(classifyNetByName("VBAT")).toBe("high_power");
  });
  it("maps regulated rails", () => {
    expect(classifyNetByName("3V3")).toBe("regulated");
    expect(classifyNetByName("5V")).toBe("regulated");
    expect(classifyNetByName("VOUT")).toBe("regulated");
  });
  it("maps ground (and ground wins over other matches)", () => {
    expect(classifyNetByName("GND")).toBe("ground");
    expect(classifyNetByName("AGND")).toBe("ground");
    expect(classifyNetByName("PGND")).toBe("ground");
  });
  it("maps sense/feedback to intermediate", () => {
    expect(classifyNetByName("VSENSE")).toBe("intermediate");
    expect(classifyNetByName("FB")).toBe("intermediate");
  });
  it("maps control/signal nets", () => {
    expect(classifyNetByName("LED_A")).toBe("signal");
    expect(classifyNetByName("PWM1")).toBe("signal");
  });
  it("defaults unknown nets to signal (graceful)", () => {
    expect(classifyNetByName("NET0042")).toBe("signal");
  });
});

describe("classifyComponentType", () => {
  it("classifies by refdes prefix, multi-letter prefixes first", () => {
    expect(classifyComponentType("U1")).toBe("ic");
    expect(classifyComponentType("C3")).toBe("capacitor");
    expect(classifyComponentType("R1")).toBe("resistor");
    expect(classifyComponentType("D2")).toBe("diode");
    expect(classifyComponentType("F1")).toBe("fuse");
    expect(classifyComponentType("J5")).toBe("connector");
    expect(classifyComponentType("CN1")).toBe("connector");
    expect(classifyComponentType("LED2")).toBe("led");
  });
});

describe("isZeroOhmValue / isDnpMarked", () => {
  it("detects 0Ω jumpers", () => {
    expect(isZeroOhmValue("0")).toBe(true);
    expect(isZeroOhmValue("0R")).toBe(true);
    expect(isZeroOhmValue("0Ω")).toBe(true);
    expect(isZeroOhmValue("10k")).toBe(false);
    expect(isZeroOhmValue(null)).toBe(false);
  });
  it("detects DNP markers", () => {
    expect(isDnpMarked("R_DNP")).toBe(true);
    expect(isDnpMarked("R1", null, "DNP")).toBe(true);
    expect(isDnpMarked("R1", "Resistor", "10k")).toBe(false);
  });
});

// A small board:
//   J1(VIN) -> F1 (fuse) -> VIN_FUSED -> U1 (regulator) -> 3V3
//   U1 -> AMP_OUT -> R3 (load)  ← unrecognized net between source & load
//   C1/C2/C3 bypass caps; R1 is a 0Ω jumper (3V3 -> 3V3_PERIPH); GND high fan-out.
function demoGraph(): ConnectivityGraph {
  const conns: PinConnection[] = [
    { componentRefDes: "J1", pinNumber: "1", netName: "VIN" },
    { componentRefDes: "F1", pinNumber: "1", netName: "VIN" },
    { componentRefDes: "F1", pinNumber: "2", netName: "VIN_FUSED" },
    { componentRefDes: "U1", pinNumber: "1", netName: "VIN_FUSED" },
    { componentRefDes: "U1", pinNumber: "2", netName: "3V3" },
    { componentRefDes: "U1", pinNumber: "3", netName: "GND" },
    { componentRefDes: "U1", pinNumber: "4", netName: "AMP_OUT" },
    { componentRefDes: "R3", pinNumber: "1", netName: "AMP_OUT" },
    { componentRefDes: "R3", pinNumber: "2", netName: "GND" },
    { componentRefDes: "C1", pinNumber: "1", netName: "VIN_FUSED" },
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
  const g = buildGraph(conns);
  // attach a 0Ω value to R1 so the jumper heuristic fires
  g.components = g.components.map((c) =>
    c.refDes === "R1" ? { ...c, value: "0" } : c
  );
  return g;
}

describe("classifyGraph", () => {
  const cg = classifyGraph(demoGraph());

  it("flags a 0Ω resistor as a jumper", () => {
    expect(cg.components.get("R1")?.isJumper).toBe(true);
  });

  it("flags 2-pin power↔ground caps as decoupling", () => {
    expect(cg.components.get("C1")?.isDecoupling).toBe(true);
    expect(cg.components.get("C2")?.isDecoupling).toBe(true);
    expect(cg.components.get("C1")?.railNet).toBe("VIN_FUSED");
  });

  it("promotes an unrecognized source→load net to intermediate", () => {
    expect(cg.intermediateNets.has("AMP_OUT")).toBe(true);
    expect(cg.nets.get("AMP_OUT")?.tier).toBe("intermediate");
  });

  it("keeps named rails at their tier (not promoted to intermediate)", () => {
    expect(cg.nets.get("3V3")?.tier).toBe("regulated");
    expect(cg.nets.get("VIN_FUSED")?.tier).toBe("high_power");
  });

  it("flags GND as high fan-out", () => {
    expect(cg.nets.get("GND")?.highFanout).toBe(true);
  });

  it("types components correctly", () => {
    expect(cg.components.get("U1")?.type).toBe("ic");
    expect(cg.components.get("F1")?.type).toBe("fuse");
    expect(cg.components.get("J1")?.type).toBe("connector");
  });
});
