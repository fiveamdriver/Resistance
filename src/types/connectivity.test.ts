import { describe, expect, it } from "vitest";

import {
  buildGraph,
  componentsForNet,
  netsForComponent,
  type PinConnection,
} from "./connectivity";

const CONNECTIONS: PinConnection[] = [
  { componentRefDes: "U7", pinNumber: "1", pinName: "VIN", netName: "5V" },
  { componentRefDes: "U7", pinNumber: "4", pinName: "GND", netName: "GND" },
  { componentRefDes: "R12", pinNumber: "1", pinName: "A", netName: "5V" },
  { componentRefDes: "C5", pinNumber: "1", pinName: "A", netName: "5V" },
  { componentRefDes: "C5", pinNumber: "2", pinName: "B", netName: "GND" },
];

describe("buildGraph", () => {
  it("derives unique component and net nodes", () => {
    const graph = buildGraph(CONNECTIONS);
    expect(graph.components.map((c) => c.refDes).sort()).toEqual([
      "C5",
      "R12",
      "U7",
    ]);
    expect(graph.nets.map((n) => n.name).sort()).toEqual(["5V", "GND"]);
  });

  it("counts pins per net (degree)", () => {
    const graph = buildGraph(CONNECTIONS);
    const fiveV = graph.nets.find((n) => n.name === "5V");
    expect(fiveV?.pinCount).toBe(3);
  });
});

describe("netsForComponent", () => {
  it("returns every net a component touches", () => {
    const graph = buildGraph(CONNECTIONS);
    expect(netsForComponent(graph, "U7").sort()).toEqual(["5V", "GND"]);
    expect(netsForComponent(graph, "R12")).toEqual(["5V"]);
  });
});

describe("componentsForNet", () => {
  it("returns every component on a net", () => {
    const graph = buildGraph(CONNECTIONS);
    expect(componentsForNet(graph, "5V").sort()).toEqual(["C5", "R12", "U7"]);
  });
});
