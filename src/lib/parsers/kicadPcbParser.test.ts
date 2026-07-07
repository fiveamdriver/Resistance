import { describe, expect, it } from "vitest";

import { parseKicadPcb } from "./kicadPcbParser";

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
