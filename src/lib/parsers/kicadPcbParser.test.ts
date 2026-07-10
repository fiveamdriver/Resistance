import { describe, expect, it } from "vitest";

import { parseKicadPcb, parseKicadPcbConnectivity } from "./kicadPcbParser";

// Minimal but structurally faithful .kicad_pcb: a 4-copper-layer stackup, two
// footprints (F.Cu and B.Cu) each with a nested property (at ..) to prove the
// footprint's own placement is taken, a rectangular Edge.Cuts outline, and one
// copper zone.
const FIXTURE = `(kicad_pcb (version 20240108) (generator "pcbnew")
  (layers
    (0 "F.Cu" signal)
    (1 "In1.Cu" signal)
    (2 "In2.Cu" signal)
    (31 "B.Cu" signal)
    (36 "B.SilkS" user)
    (44 "Edge.Cuts" user)
  )
  (gr_line (start 10 10) (end 60 10) (layer "Edge.Cuts"))
  (gr_line (start 60 10) (end 60 40) (layer "Edge.Cuts"))
  (gr_line (start 60 40) (end 10 40) (layer "Edge.Cuts"))
  (gr_line (start 10 40) (end 10 10) (layer "Edge.Cuts"))
  (footprint "Capacitor_SMD:C_0805_2012Metric"
    (layer "F.Cu")
    (uuid "aaaa")
    (at 100 50 90)
    (property "Reference" "C1"
      (at 0 -2 0)
      (layer "F.SilkS"))
    (pad "1" smd roundrect (at 0 0) (layers "F.Cu" "F.Paste" "F.Mask")))
  (footprint "Package_SO:SOIC-8"
    (layer "B.Cu")
    (uuid "bbbb")
    (at 120 60 180)
    (property "Reference" "U1"
      (at 0 3 0)
      (layer "B.SilkS"))
    (pad "1" smd roundrect (at -1 0) (layers "B.Cu" "B.Paste" "B.Mask")))
  (zone (net 1) (net_name "GND") (layer "F.Cu") (hatch edge 0.5))
)`;

describe("parseKicadPcb", () => {
  it("extracts placements using the footprint's own (at) and layer", () => {
    const { placements } = parseKicadPcb(FIXTURE);

    expect(placements).toHaveLength(2);
    expect(placements).toContainEqual({
      refDes: "C1",
      x: 100,
      y: 50,
      rotation: 90,
      layer: "F.Cu",
    });
    expect(placements).toContainEqual({
      refDes: "U1",
      x: 120,
      y: 60,
      rotation: 180,
      layer: "B.Cu",
    });
  });

  it("reads the copper stackup, in order", () => {
    const { board } = parseKicadPcb(FIXTURE);
    expect(board.copperLayers).toEqual(["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"]);
    expect(board.layerCount).toBe(4);
  });

  it("computes board dimensions from the Edge.Cuts bounding box", () => {
    const { board } = parseKicadPcb(FIXTURE);
    expect(board.widthMm).toBe(50);
    expect(board.heightMm).toBe(30);
  });

  it("extracts copper zones with net name and layer", () => {
    const { board } = parseKicadPcb(FIXTURE);
    expect(board.zones).toEqual([{ netName: "GND", layer: "F.Cu" }]);
  });

  it("defaults rotation to 0 when the footprint (at) omits it", () => {
    const noRot = `(kicad_pcb
      (footprint "R"
        (layer "F.Cu")
        (at 5 5)
        (property "Reference" "R1")))`;
    const { placements } = parseKicadPcb(noRot);
    expect(placements[0]).toMatchObject({ refDes: "R1", x: 5, y: 5, rotation: 0 });
  });

  it("returns empty layout for a board with no footprints or outline", () => {
    const { placements, board } = parseKicadPcb(`(kicad_pcb (version 1))`);
    expect(placements).toEqual([]);
    expect(board.widthMm).toBeNull();
    expect(board.heightMm).toBeNull();
    expect(board.layerCount).toBe(0);
  });
});

// Legacy (KiCad ≤5) board: (module ...) blocks, (fp_text reference ...) with
// bare tokens, unquoted net names — the HadesFCS-era format.
const LEGACY_FIXTURE = `(kicad_pcb (version 20171130) (host pcbnew "(5.1.6)")
  (net 0 "")
  (net 1 +3V3)
  (net 2 GND)
  (module Capacitor_SMD:C_0402_1005Metric (layer F.Cu) (tedit 0) (tstamp 0)
    (at 88.5 45.25 270)
    (fp_text reference C13 (at 0 -1.2) (layer F.SilkS)
      (effects (font (size 1 1) (thickness 0.15))))
    (fp_text value 100nF (at 0 1.2) (layer F.Fab))
    (pad 1 smd rect (at -0.5 0) (size 0.6 0.6) (layers F.Cu F.Paste F.Mask)
      (net 1 +3V3))
    (pad 2 smd rect (at 0.5 0) (size 0.6 0.6) (layers F.Cu F.Paste F.Mask)
      (net 2 GND)))
  (module TestPoint:TestPoint_Pad_D1.5mm (layer B.Cu) (tedit 0) (tstamp 1)
    (at 100 60)
    (fp_text reference TP1 (at 0 -2) (layer B.SilkS))
    (fp_text value GND_TP (at 0 2) (layer B.Fab))
    (pad 1 smd circle (at 0 0) (size 1.5 1.5) (layers B.Cu B.Mask)
      (net 2 GND))
    (pad 1 smd circle (at 0 0.1) (size 1.5 1.5) (layers B.Cu B.Mask)
      (net 2 GND)))
  (module Mounting:Hole (layer F.Cu) (tedit 0) (tstamp 2)
    (at 5 5)
    (fp_text reference H1 (at 0 0) (layer F.SilkS))
    (pad "" np_thru_hole circle (at 0 0) (size 3 3) (drill 3))))`;

describe("legacy (module) format support", () => {
  it("extracts placements from (module) blocks with fp_text references", () => {
    const { placements } = parseKicadPcb(LEGACY_FIXTURE);
    expect(placements).toContainEqual({
      refDes: "C13",
      x: 88.5,
      y: 45.25,
      rotation: 270,
      layer: "F.Cu",
    });
    expect(placements.map((p) => p.refDes).sort()).toEqual(["C13", "H1", "TP1"]);
  });
});

describe("parseKicadPcbConnectivity", () => {
  it("builds components and pad→net connectivity from a legacy board", () => {
    const { components, nets } = parseKicadPcbConnectivity(LEGACY_FIXTURE);

    expect(components.map((c) => c.refDes).sort()).toEqual(["C13", "H1", "TP1"]);
    expect(components.find((c) => c.refDes === "C13")).toMatchObject({
      name: "100nF",
      footprint: "Capacitor_SMD:C_0402_1005Metric",
    });

    const gnd = nets.find((n) => n.name === "GND");
    expect(gnd).toBeDefined();
    // TP1's two same-numbered pad geometries collapse to one logical pin.
    expect(gnd!.pins).toEqual([
      { refDes: "C13", pinNumber: "2" },
      { refDes: "TP1", pinNumber: "1" },
    ]);

    const v33 = nets.find((n) => n.name === "+3V3");
    expect(v33!.pins).toEqual([{ refDes: "C13", pinNumber: "1" }]);
  });

  it("builds connectivity from a modern (footprint) board with quoted nets", () => {
    const modern = `(kicad_pcb (version 20240108)
      (footprint "Package_SO:SOIC-8" (layer "F.Cu")
        (at 10 10)
        (property "Reference" "U1")
        (property "Value" "LM358")
        (pad "1" smd roundrect (at 0 0) (net 3 "OUT_A"))
        (pad "4" smd roundrect (at 0 3) (net 2 "GND"))))`;
    const { components, nets } = parseKicadPcbConnectivity(modern);

    expect(components).toHaveLength(1);
    expect(components[0]).toMatchObject({
      refDes: "U1",
      name: "LM358",
      footprint: "Package_SO:SOIC-8",
    });
    expect(nets.map((n) => n.name).sort()).toEqual(["GND", "OUT_A"]);
  });

  it("skips unconnected pads and boards without footprints", () => {
    const { nets } = parseKicadPcbConnectivity(LEGACY_FIXTURE);
    // H1's netless mounting pad contributes nothing.
    expect(nets.every((n) => n.pins.every((p) => p.refDes !== "H1"))).toBe(true);

    const empty = parseKicadPcbConnectivity(`(kicad_pcb (version 1))`);
    expect(empty.components).toEqual([]);
    expect(empty.nets).toEqual([]);
  });
});
