/**
 * Altium netlist parser — PLACEHOLDER.
 *
 * Phase 1 returns mock data shaped exactly like the real parser will. Wire the
 * real implementation in where noted; the return shape should not need to change.
 */
import type { PinConnection } from "@/types/connectivity";

export interface ParsedNetlist {
  /** Flat list of pin→net memberships, ready for buildGraph(). */
  connections: PinConnection[];
  /** Distinct component reference designators discovered. */
  components: { refDes: string; name?: string }[];
  /** Distinct net names discovered. */
  nets: string[];
}

/**
 * Parse an Altium netlist export (e.g. Protel `.NET` format) into a normalized
 * connectivity structure.
 *
 * @param _filePath absolute path to the uploaded netlist file
 *
 * TODO(phase 2): read the file and implement real parsing. Altium Protel
 * netlists have two sections:
 *   [  ... component records ...  ]   designator / footprint / comment
 *   (  ... net records ...        )   net name followed by PIN refs (e.g. U7-14)
 * Parse both, then emit one PinConnection per pin on each net.
 */
export async function parseNetlist(_filePath: string): Promise<ParsedNetlist> {
  // --- MOCK DATA (remove when real parsing lands) --------------------------
  const connections: PinConnection[] = [
    { componentRefDes: "U7", pinNumber: "1", pinName: "VIN", netName: "5V" },
    { componentRefDes: "U7", pinNumber: "4", pinName: "GND", netName: "GND" },
    { componentRefDes: "R12", pinNumber: "1", pinName: "A", netName: "5V" },
    { componentRefDes: "C5", pinNumber: "1", pinName: "A", netName: "5V" },
    { componentRefDes: "C5", pinNumber: "2", pinName: "B", netName: "GND" },
  ];

  return {
    connections,
    components: [
      { refDes: "U7", name: "TPS54331" },
      { refDes: "R12", name: "Resistor 10k" },
      { refDes: "C5", name: "Capacitor 100nF" },
    ],
    nets: ["5V", "GND"],
  };
}
