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
  const connections = await prisma.connection.findMany({
    where: { net: { projectId } },
    include: {
      net: true,
      pin: { include: { component: true } },
    },
  });

  const pinConnections: PinConnection[] = connections.map((c) => ({
    componentRefDes: c.pin.component.refDes,
    pinNumber: c.pin.number,
    pinName: c.pin.name ?? undefined,
    netName: c.net.name,
  }));

  return buildGraph(pinConnections);
}
