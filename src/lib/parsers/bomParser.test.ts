import { describe, expect, it } from "vitest";

import { csvLooksLikeBom } from "./bomParser";

describe("csvLooksLikeBom", () => {
  it("accepts KiCad BOM export headers", () => {
    expect(
      csvLooksLikeBom(["Reference", "Value", "Footprint", "Datasheet", "MPN", "QUANTITY", "DNP"])
    ).toBe(true);
  });

  it("accepts Altium-style headers", () => {
    expect(
      csvLooksLikeBom(["Designator", "Description", "Quantity", "Manufacturer Part Number"])
    ).toBe(true);
  });

  it("accepts a grouped BOM without designators (description + quantity)", () => {
    expect(csvLooksLikeBom(["Description", "Qty", "Part Number"])).toBe(true);
  });

  // Regression: real telemetry headers from HadesFCS that previously
  // false-matched via 1-char substring hits (v→value, q→quantity, r→ref).
  it("rejects flight-log headers", () => {
    expect(
      csvLooksLikeBom("t,u,v,q,theta,x,h,Va,alpha,gyrq,accx,accz,pitotVa,baroAlt,thetahat,de,dt,spAirspeed,spPitch,spAltitude".split(","))
    ).toBe(false);
  });

  it("rejects raw sensor data headers", () => {
    expect(csvLooksLikeBom(["bar", "mx", "my", "mz", "ax", "ay", "az", "p", "q", "r"])).toBe(false);
  });

  it("rejects gyro capture headers", () => {
    expect(csvLooksLikeBom(["gx", "gy", "gz", "gxf", "gyf", "gzf"])).toBe(false);
  });

  it("rejects a description-only table (no part columns)", () => {
    expect(csvLooksLikeBom(["Test Case", "Description", "Result"])).toBe(false);
  });

  it("rejects pick-and-place headers even with a designator column", () => {
    expect(
      csvLooksLikeBom(["Designator", "Mid X", "Mid Y", "Rotation", "Layer"])
    ).toBe(false);
  });
});
