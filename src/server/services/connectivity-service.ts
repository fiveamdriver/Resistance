/**
 * Connectivity domain service.
 *
 * Builds the in-memory ConnectivityGraph (see types/connectivity.ts) from
 * persisted Components/Nets/Pins/Connections. Consumed by the connectivity
 * graph visualization and AI agent tools (search_component, search_net,
 * get_connected_components).
 */
import "server-only";

import { prisma } from "@/lib/prisma";
import {
  buildGraph,
  type ConnectivityGraph,
  type PinConnection,
} from "@/types/connectivity";

export async function getConnectivityGraph(
  projectId: string
): Promise<ConnectivityGraph> {
  const [connections, components] = await Promise.all([
    prisma.connection.findMany({
      where: { net: { projectId } },
      include: {
        net: true,
        pin: { include: { component: true } },
      },
    }),
    // Component metadata (value/comment/footprint) so the graph can label parts
    // and detect 0Ω jumpers — connection rows alone don't carry it.
    prisma.component.findMany({
      where: { projectId },
      select: { refDes: true, name: true, value: true, footprint: true },
    }),
  ]);

  const pinConnections: PinConnection[] = connections.map((c) => ({
    componentRefDes: c.pin.component.refDes,
    pinNumber: c.pin.number,
    pinName: c.pin.name ?? undefined,
    netName: c.net.name,
  }));

  return buildGraph(pinConnections, components);
}
