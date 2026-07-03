import { describe, expect, it } from "vitest";

import { parseKicadNetlistText } from "./kicadNetlistParser";

const FIXTURE = `(export (version "E")
  (design
    (source "myboard.kicad_sch")
    (date "2024-01-01")
    (tool "Eeschema 7.0.0"))
  (components
    (comp (ref "U1")
      (value "STM32F446RET6")
      (footprint "Package_QFP:LQFP-64_10x10mm_P0.5mm"))
    (comp (ref "R1")
      (value "10k")
      (footprint "Resistor_SMD:R_0402_1005Metric"))
    (comp (ref "C1")
      (value "100nF")
      (footprint "Capacitor_SMD:C_0402_1005Metric")))
  (nets
    (net (code "1") (name "GND")
      (node (ref "U1") (pin "5") (pintype "power_in"))
      (node (ref "C1") (pin "2") (pintype "passive")))
    (net (code "2") (name "VCC")
      (node (ref "U1") (pin "1") (pintype "power_in"))
      (node (ref "R1") (pin "1") (pintype "passive")))
    (net (code "3") (name "SPI_CLK")
      (node (ref "U1") (pin "23") (pintype "output"))
      (node (ref "R1") (pin "2") (pintype "passive")))))`;

describe("parseKicadNetlistText", () => {
  it("extracts all components with correct refDes, name, and footprint", () => {
    const { components } = parseKicadNetlistText(FIXTURE);

    expect(components).toHaveLength(3);
    expect(components[0]).toEqual({
      refDes: "U1",
      name: "STM32F446RET6",
      footprint: "Package_QFP:LQFP-64_10x10mm_P0.5mm",
      mpn: null,
      datasheetUrl: null,
    });
    expect(components[1]).toEqual({
      refDes: "R1",
      name: "10k",
      footprint: "Resistor_SMD:R_0402_1005Metric",
      mpn: null,
      datasheetUrl: null,
    });
    expect(components[2]).toEqual({
      refDes: "C1",
      name: "100nF",
      footprint: "Capacitor_SMD:C_0402_1005Metric",
      mpn: null,
      datasheetUrl: null,
    });
  });

  it("extracts all nets with correct names and pin connections", () => {
    const { nets } = parseKicadNetlistText(FIXTURE);

    expect(nets).toHaveLength(3);
    expect(nets[0]).toEqual({
      name: "GND",
      pins: [
        { refDes: "U1", pinNumber: "5" },
        { refDes: "C1", pinNumber: "2" },
      ],
    });
    expect(nets[1]).toEqual({
      name: "VCC",
      pins: [
        { refDes: "U1", pinNumber: "1" },
        { refDes: "R1", pinNumber: "1" },
      ],
    });
    expect(nets[2]).toEqual({
      name: "SPI_CLK",
      pins: [
        { refDes: "U1", pinNumber: "23" },
        { refDes: "R1", pinNumber: "2" },
      ],
    });
  });

  it("produces the correct NetlistParseSummary shape from parsed data", () => {
    const { components, nets } = parseKicadNetlistText(FIXTURE);

    const summary = {
      componentCount: components.length,
      netCount: nets.length,
      connectionCount: nets.reduce((sum, n) => sum + n.pins.length, 0),
      components: components.map((c) => c.refDes),
      nets: nets.map((n) => n.name),
    };

    expect(summary).toEqual({
      componentCount: 3,
      netCount: 3,
      connectionCount: 6,
      components: ["U1", "R1", "C1"],
      nets: ["GND", "VCC", "SPI_CLK"],
    });
  });

  it("returns empty arrays for an S-expression with no components or nets", () => {
    const { components, nets } = parseKicadNetlistText(
      `(export (version "E") (design (source "empty.kicad_sch")))`
    );
    expect(components).toHaveLength(0);
    expect(nets).toHaveLength(0);
  });

  it("extracts MPN from (property (name MPN#) (value ...)) blocks", () => {
    const withMpn = `(export (version "E")
  (components
    (comp (ref "U1")
      (value "TPS54331DR")
      (footprint "SOIC-8")
      (property (name "MPN#") (value "TPS54331DR"))
      (property (name "Datasheet") (value "https://www.ti.com/lit/ds/symlink/tps54331.pdf")))
    (comp (ref "R1")
      (value "10k")
      (footprint "R_0402")))
  (nets))`;
    const { components } = parseKicadNetlistText(withMpn);
    expect(components).toHaveLength(2);
    expect(components[0].mpn).toBe("TPS54331DR");
    expect(components[1].mpn).toBeNull();
  });

  it("extracts the Datasheet property as datasheetUrl (http/https only)", () => {
    const withDatasheet = `(export (version "E")
  (components
    (comp (ref "U1")
      (value "TPS54331DR")
      (property (name "Datasheet") (value "https://www.ti.com/lit/ds/symlink/tps54331.pdf")))
    (comp (ref "R1")
      (value "10k")
      (property (name "Datasheet") (value "~")))
    (comp (ref "C1")
      (value "100nF")
      (datasheet "https://example.com/c1.pdf")))
  (nets))`;
    const { components } = parseKicadNetlistText(withDatasheet);
    expect(components[0].datasheetUrl).toBe(
      "https://www.ti.com/lit/ds/symlink/tps54331.pdf"
    );
    expect(components[1].datasheetUrl).toBeNull(); // "~" = empty in KiCad
    expect(components[2].datasheetUrl).toBe("https://example.com/c1.pdf");
  });

  it("does not confuse (comp ...) with (components ...) or (net ...) with (nets ...)", () => {
    const { components, nets } = parseKicadNetlistText(FIXTURE);
    // If keyword boundary check fails, we'd get extra garbage entries
    expect(components.every((c) => typeof c.refDes === "string" && c.refDes.length > 0)).toBe(true);
    expect(nets.every((n) => typeof n.name === "string" && n.name.length > 0)).toBe(true);
  });
});
