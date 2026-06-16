import { describe, expect, it } from "vitest";

import {
  capacitiveReactance,
  inductiveReactance,
  parallelResistance,
  parseEngineeringValue,
  voltageDivider,
} from "./ee-calcs";

describe("parseEngineeringValue", () => {
  it("parses SI-suffixed values to base units", () => {
    expect(parseEngineeringValue("100nF")).toBeCloseTo(1e-7, 18);
    expect(parseEngineeringValue("1.8pF")).toBeCloseTo(1.8e-12, 18);
    expect(parseEngineeringValue("10k")).toBe(10000);
    expect(parseEngineeringValue("2.2M")).toBe(2.2e6);
  });

  it("parses infix (RKM) notation", () => {
    expect(parseEngineeringValue("4k7")).toBe(4700);
    expect(parseEngineeringValue("2R2")).toBeCloseTo(2.2, 10);
  });

  it("parses bare numbers", () => {
    expect(parseEngineeringValue("150")).toBe(150);
  });

  it("returns null for ranges and junk", () => {
    expect(parseEngineeringValue("4-6nH")).toBeNull();
    expect(parseEngineeringValue("")).toBeNull();
    expect(parseEngineeringValue("DNP")).toBeNull();
  });
});

describe("capacitiveReactance", () => {
  it("computes Xc = 1/(2πfC)", () => {
    // 0.7 pF at 700 MHz ≈ 324.9 Ω
    expect(capacitiveReactance(0.7e-12, 700e6)).toBeCloseTo(324.9, 0);
  });

  it("rejects non-positive inputs", () => {
    expect(() => capacitiveReactance(0, 1e6)).toThrow();
    expect(() => capacitiveReactance(1e-9, 0)).toThrow();
  });
});

describe("inductiveReactance", () => {
  it("computes Xl = 2πfL", () => {
    // 5 nH at 1.8 GHz ≈ 56.5 Ω
    expect(inductiveReactance(5e-9, 1.8e9)).toBeCloseTo(56.5, 0);
  });
});

describe("parallelResistance", () => {
  it("computes two equal resistors as half", () => {
    expect(parallelResistance(150, 150)).toBe(75);
  });

  it("computes the Thevenin example 82||130", () => {
    expect(parallelResistance(82, 130)).toBeCloseTo(50.3, 1);
  });
});

describe("voltageDivider", () => {
  it("computes a 50/50 divider", () => {
    expect(voltageDivider(3.3, 10000, 10000)).toBeCloseTo(1.65, 5);
  });
});
