/**
 * Schema-coupled board queries — the single file that knows the Prisma model
 * field names. Every other board-AI file imports from here, not from Prisma
 * directly, so a future migration only touches this file.
 *
 * Field mapping (schema → returned shape):
 *   Component.refDes        → refdes
 *   Component.value         → value
 *   Component.footprint     → footprint
 *   Component.name          → (part/device name — used as "component" label in pins)
 *   BomItem.mpn             → partNumber (no partNumber on Component itself)
 *   Pin.number (String)     → pin
 *   Net.name                → net
 */
import "server-only";

import { prisma } from "@/lib/prisma";

// ── helpers ───────────────────────────────────────────────────────────────────

/** Strip spaces, dots, plus, minus, underscore for fuzzy net-name matching. */
const norm = (s: string): string => s.replace(/[\s.+\-_]/g, "").toLowerCase();

/**
 * Resolve a net name to a DB record: exact case-insensitive first, then a
 * fuzzy match that strips spaces/dots/+/-/_ (so "3.3V" matches "3V3").
 */
async function resolveNet(
  projectId: string,
  netName: string,
): Promise<{ id: string; name: string } | null> {
  const all = await prisma.net.findMany({
    where: { projectId },
    select: { id: true, name: true },
  });

  const lower = netName.toLowerCase();
  let hit = all.find((n) => n.name.toLowerCase() === lower);

  if (!hit) {
    const normQuery = norm(netName);
    hit = all.find((n) => norm(n.name) === normQuery);
  }

  return hit ?? null;
}

// ── return types ──────────────────────────────────────────────────────────────

export interface NetPin {
  refdes: string;
  pin: string;
  /** Component name/part name as stored; null if not recorded in source. */
  component: string | null;
}

export interface NetResult {
  net: string;
  pins: NetPin[];
}

/** Physical placement from the .kicad_pcb; null fields when no board parsed. */
export interface Placement {
  x: number;
  y: number;
  rotation: number;
  layer: string | null;
}

export interface ComponentResult {
  refdes: string;
  value: string | null;
  footprint: string | null;
  /** From linked BomItem.mpn; null if no BOM row links this component. */
  partNumber: string | null;
  /** From the parsed board layout; null if unplaced / no board parsed. */
  placement: Placement | null;
  pins: { pin: string; net: string | null }[];
}

export interface TracePinResult {
  refdes: string;
  pin: string;
  /** Null if the pin exists in the netlist but carries no net assignment. */
  net: string | null;
  connectedTo: { refdes: string; pin: string }[];
}

export interface BomRow {
  refDesRaw: string | null;
  description: string | null;
  manufacturer: string | null;
  mpn: string | null;
  value: string | null;
  footprint: string | null;
  quantity: number;
}

export interface ProjectSummary {
  componentCount: number;
  netCount: number;
  nets: string[];
  bomLineCount: number;
}

// ── queries ───────────────────────────────────────────────────────────────────

export async function listNets(projectId: string): Promise<string[]> {
  const rows = await prisma.net.findMany({
    where: { projectId },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => r.name);
}

export async function listComponents(
  projectId: string,
): Promise<{ refdes: string; value: string | null }[]> {
  const rows = await prisma.component.findMany({
    where: { projectId },
    select: { refDes: true, value: true },
    orderBy: { refDes: "asc" },
  });
  return rows.map((r) => ({ refdes: r.refDes, value: r.value }));
}

export async function getNet(
  projectId: string,
  netName: string,
): Promise<NetResult | null> {
  const found = await resolveNet(projectId, netName);
  if (!found) return null;

  const connections = await prisma.connection.findMany({
    where: { netId: found.id },
    include: {
      pin: {
        include: { component: true },
      },
    },
  });

  return {
    net: found.name,
    pins: connections.map((c) => ({
      refdes: c.pin.component.refDes,
      pin: c.pin.number,
      component: c.pin.component.name ?? null,
    })),
  };
}

export async function getComponent(
  projectId: string,
  refdes: string,
): Promise<ComponentResult | null> {
  const comp = await prisma.component.findUnique({
    where: { projectId_refDes: { projectId, refDes: refdes } },
    include: {
      pins: {
        include: {
          connection: {
            include: { net: true },
          },
        },
        orderBy: { number: "asc" },
      },
      bomItems: {
        select: { mpn: true },
        take: 1,
      },
    },
  });

  if (!comp) return null;

  return {
    refdes: comp.refDes,
    value: comp.value,
    footprint: comp.footprint,
    partNumber: comp.bomItems[0]?.mpn ?? null,
    placement:
      comp.posX !== null && comp.posY !== null
        ? { x: comp.posX, y: comp.posY, rotation: comp.rotation ?? 0, layer: comp.layer }
        : null,
    pins: comp.pins.map((p) => ({
      pin: p.number,
      net: p.connection?.net.name ?? null,
    })),
  };
}

export async function tracePin(
  projectId: string,
  refdes: string,
  pin: string,
): Promise<TracePinResult | null> {
  const pinRecord = await prisma.pin.findFirst({
    where: {
      number: pin,
      component: { projectId, refDes: refdes },
    },
    include: {
      connection: {
        include: {
          net: {
            include: {
              connections: {
                include: {
                  pin: {
                    include: { component: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!pinRecord) return null;

  if (!pinRecord.connection) {
    return { refdes, pin, net: null, connectedTo: [] };
  }

  const net = pinRecord.connection.net;
  const connectedTo = net.connections
    .filter((c) => c.pinId !== pinRecord.id)
    .map((c) => ({ refdes: c.pin.component.refDes, pin: c.pin.number }));

  return { refdes, pin, net: net.name, connectedTo };
}

export async function searchBom(
  projectId: string,
  filter?: string,
): Promise<BomRow[]> {
  const rows = await prisma.bomItem.findMany({
    where: {
      projectId,
      ...(filter
        ? {
            OR: [
              { manufacturer: { contains: filter } },
              { mpn: { contains: filter } },
              { refDesRaw: { contains: filter } },
              { description: { contains: filter } },
            ],
          }
        : {}),
    },
    orderBy: { refDesRaw: "asc" },
  });

  return rows.map((r) => ({
    refDesRaw: r.refDesRaw,
    description: r.description,
    manufacturer: r.manufacturer,
    mpn: r.mpn,
    value: r.value,
    footprint: r.footprint,
    quantity: r.quantity,
  }));
}

export async function getProjectSummary(
  projectId: string,
): Promise<ProjectSummary> {
  const [componentCount, netCount, bomLineCount, nets] = await Promise.all([
    prisma.component.count({ where: { projectId } }),
    prisma.net.count({ where: { projectId } }),
    prisma.bomItem.count({ where: { projectId } }),
    prisma.net.findMany({
      where: { projectId },
      select: { name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    componentCount,
    netCount,
    nets: nets.map((n) => n.name),
    bomLineCount,
  };
}

// ── layout queries (from the parsed .kicad_pcb) ────────────────────────────────

export interface BoardDimensions {
  widthMm: number | null;
  heightMm: number | null;
  layerCount: number | null;
  copperLayers: string[];
  zones: { netName: string | null; layer: string | null }[];
  sourceFile: string | null;
}

export interface PlacementResult {
  refdes: string;
  x: number;
  y: number;
  rotation: number;
  layer: string | null;
}

export interface NeighborResult {
  refdes: string;
  distanceMm: number;
  x: number;
  y: number;
  layer: string | null;
}

/** Board-level layout facts, or null if no .kicad_pcb has been parsed. */
export async function getBoardDimensions(
  projectId: string,
): Promise<BoardDimensions | null> {
  const board = await prisma.board.findUnique({ where: { projectId } });
  if (!board) return null;

  const parseJson = <T>(s: string, fallback: T): T => {
    try {
      return JSON.parse(s) as T;
    } catch {
      return fallback;
    }
  };

  return {
    widthMm: board.widthMm,
    heightMm: board.heightMm,
    layerCount: board.layerCount,
    copperLayers: parseJson<string[]>(board.copperLayers, []),
    zones: parseJson<{ netName: string | null; layer: string | null }[]>(board.zones, []),
    sourceFile: board.sourceFile,
  };
}

/** Placement of one component, or null if unplaced / no board parsed. */
export async function getPlacement(
  projectId: string,
  refdes: string,
): Promise<PlacementResult | null> {
  const comp = await prisma.component.findUnique({
    where: { projectId_refDes: { projectId, refDes: refdes } },
    select: { refDes: true, posX: true, posY: true, rotation: true, layer: true },
  });
  if (!comp || comp.posX === null || comp.posY === null) return null;

  return {
    refdes: comp.refDes,
    x: comp.posX,
    y: comp.posY,
    rotation: comp.rotation ?? 0,
    layer: comp.layer,
  };
}

/**
 * Components nearest to `refdes` by center-to-center distance, closest first.
 * `radiusMm` (optional) caps the result to that distance. Returns null when
 * the target itself is unplaced / no board parsed.
 */
export async function nearestComponents(
  projectId: string,
  refdes: string,
  radiusMm?: number,
  limit = 10,
): Promise<{ target: PlacementResult; neighbors: NeighborResult[] } | null> {
  const target = await getPlacement(projectId, refdes);
  if (!target) return null;

  const placed = await prisma.component.findMany({
    where: {
      projectId,
      refDes: { not: refdes },
      posX: { not: null },
      posY: { not: null },
    },
    select: { refDes: true, posX: true, posY: true, layer: true },
  });

  const neighbors: NeighborResult[] = placed
    .map((c) => {
      const dx = (c.posX as number) - target.x;
      const dy = (c.posY as number) - target.y;
      return {
        refdes: c.refDes,
        distanceMm: Math.round(Math.hypot(dx, dy) * 100) / 100,
        x: c.posX as number,
        y: c.posY as number,
        layer: c.layer,
      };
    })
    .filter((n) => radiusMm === undefined || n.distanceMm <= radiusMm)
    .sort((a, b) => a.distanceMm - b.distanceMm)
    .slice(0, limit);

  return { target, neighbors };
}
