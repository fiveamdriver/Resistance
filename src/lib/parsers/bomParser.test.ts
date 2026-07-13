import { describe, expect, it } from "vitest";

import { buildColumnMap, csvLooksLikeBom } from "./bomParser";

describe("buildColumnMap", () => {
  // Regression: with both a Manufacturer and an Mfr Part # column, the mpn
  // alias "manufacturer part number" used to fuzzy-match the Manufacturer
  // column first, putting manufacturer names in the MPN field. Exact matches
  // must claim their columns before any fuzzy matching runs.
  it("keeps manufacturer and MPN apart (HADES_BOM.csv header shape)", () => {
    const cols = buildColumnMap([
      "Ref Des",
      "Qty",
      "Manufacturer",
      "Mfr Part #",
      "Value",
      "Package",
      "Type",
      "Your Instructions / Notes",
    ]);
    expect(cols.refDes).toBe(0);
    expect(cols.quantity).toBe(1);
    expect(cols.manufacturer).toBe(2);
    expect(cols.mpn).toBe(3);
    expect(cols.value).toBe(4);
    expect(cols.footprint).toBe(5); // "Package"
  });

  it("still resolves plain KiCad export headers", () => {
    const cols = buildColumnMap([
      "Reference",
      "Value",
      "Footprint",
      "Datasheet",
      "MPN",
      "QUANTITY",
    ]);
    expect(cols.refDes).toBe(0);
    expect(cols.value).toBe(1);
    expect(cols.footprint).toBe(2);
    expect(cols.datasheet).toBe(3);
    expect(cols.mpn).toBe(4);
    expect(cols.quantity).toBe(5);
  });
});

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
