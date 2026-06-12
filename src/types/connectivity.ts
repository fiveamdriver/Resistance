/**
 * Connectivity graph types.
 *
 * These describe the in-memory graph the app builds from parsed netlist data.
 * They are deliberately decoupled from the Prisma models so the parser, the API
 * layer, and the (future) React Flow visualization can share one shape.
 *
 * Target use cases:
 *   - Search component "U7"  -> list all nets it touches
 *   - Search net "5V"        -> list all components connected to it
 *   - Render a node-link graph (components + nets as nodes, pins as edges)
 */

/** A component node (IC, passive, connector, ...). */
export interface ComponentNode {
  id: string; // stable id (db id or refDes)
  refDes: string; // e.g. "U7"
  name?: string;
  value?: string;
  footprint?: string;
  pinNumbers: string[]; // pin numbers on this component
}

/** A net node (signal). */
export interface NetNode {
  id: string;
  name: string; // e.g. "5V", "GND", "SPI_CLK"
  /** Number of pins on this net (degree). */
  pinCount: number;
}

/** One pin-to-net membership — an edge in the graph. */
export interface PinConnection {
  componentRefDes: string; // e.g. "U7"
  pinNumber: string; // e.g. "14"
  pinName?: string; // e.g. "VCC"
  netName: string; // e.g. "5V"
}

/** The full connectivity graph for a project. */
export interface ConnectivityGraph {
  components: ComponentNode[];
  nets: NetNode[];
  connections: PinConnection[];
}

// ---------------------------------------------------------------------------
// Query helpers (pure functions over a ConnectivityGraph). The future graph UI
// and AI tools (search_component / search_net / get_connected_components) will
// build on these.
// ---------------------------------------------------------------------------

/** All nets that the given component connects to. */
export function netsForComponent(
  graph: ConnectivityGraph,
  refDes: string
): string[] {
  return Array.from(
    new Set(
      graph.connections
        .filter((c) => c.componentRefDes === refDes)
        .map((c) => c.netName)
    )
  );
}

/** All components connected to the given net. */
export function componentsForNet(
  graph: ConnectivityGraph,
  netName: string
): string[] {
  return Array.from(
    new Set(
      graph.connections
        .filter((c) => c.netName === netName)
        .map((c) => c.componentRefDes)
    )
  );
}

/** Build a ConnectivityGraph from a flat list of pin connections. */
export function buildGraph(connections: PinConnection[]): ConnectivityGraph {
  const componentMap = new Map<string, ComponentNode>();
  const netMap = new Map<string, NetNode>();

  for (const c of connections) {
    const comp = componentMap.get(c.componentRefDes) ?? {
      id: c.componentRefDes,
      refDes: c.componentRefDes,
      pinNumbers: [],
    };
    if (!comp.pinNumbers.includes(c.pinNumber)) comp.pinNumbers.push(c.pinNumber);
    componentMap.set(c.componentRefDes, comp);

    const net = netMap.get(c.netName) ?? {
      id: c.netName,
      name: c.netName,
      pinCount: 0,
    };
    net.pinCount += 1;
    netMap.set(c.netName, net);
  }

  return {
    components: Array.from(componentMap.values()),
    nets: Array.from(netMap.values()),
    connections,
  };
}
