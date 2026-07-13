/**
 * KiCad .kicad_pcb layout parser.
 *
 * Pulls physical-layout facts out of the board S-expression — component
 * placements, board outline dimensions, copper stackup, and copper zones — so
 * the assistant can answer layout questions from structured tool results
 * (board-queries.ts / board-tools.ts) rather than the schematic-only netlist.
 *
 * Deliberately NOT extracted: raw routing (track lengths, via counts). That is
 * a follow-up; DRC-derived geometry is already available via the run_drc tool.
 *
 * parseKicadPcb(text) — pure, unit-testable.
 * parsePcbLayoutFile / persistPcbLayout — I/O + DB write.
 */
import "server-only";

import { readFile } from "fs/promises";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { withProjectLock } from "@/lib/project-lock";

import { extractAttr, extractBlocks } from "./sexpr";
import {
  type ComponentRecord,
  type NetlistParseSummary,
  type NetRecord,
  type PinRef,
  writeConnectivity,
} from "./netlistParser";

export interface Placement {
  refDes: string;
  x: number;
  y: number;
  rotation: number;
  layer: string; // "F.Cu" (top) | "B.Cu" (bottom)
}

export interface ZoneMeta {
  netName: string | null;
  layer: string | null;
}

export interface BoardMeta {
  widthMm: number | null;
  heightMm: number | null;
  copperLayers: string[]; // stackup order, e.g. ["F.Cu","In1.Cu","In2.Cu","B.Cu"]
  layerCount: number;
  zones: ZoneMeta[];
}

export interface PcbLayout {
  placements: Placement[];
  board: BoardMeta;
}

export interface PcbLayoutSummary {
  placedCount: number;
  layerCount: number;
  widthMm: number | null;
  heightMm: number | null;
  zoneCount: number;
  /**
   * Every refdes placed on the board. The folder-sync reconciliation pass
   * uses this as the layout half of the "what still exists" union, so
   * layout-only parts (fiducials, mounting holes) survive netlist reconcile.
   */
  placedRefDes: string[];
}

/** The footprint's own placement: the first `(at x y [rot])` in the block. */
const AT_RE = /\(at\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s+(-?[\d.]+))?\s*\)/;
/** Positional reference property: `(property "Reference" "R12" ...)`. */
const REF_RE = /\(property\s+"Reference"\s+"([^"]*)"/;
/** Legacy (KiCad ≤5) reference: `(fp_text reference U10 ...)`, maybe quoted. */
const LEGACY_REF_RE = /\(fp_text\s+reference\s+(?:"([^"]*)"|([^\s()]+))/;
/** Legacy value: `(fp_text value 100nF ...)`, maybe quoted. */
const LEGACY_VALUE_RE = /\(fp_text\s+value\s+(?:"([^"]*)"|([^\s()]+))/;
/** Modern value property: `(property "Value" "100nF" ...)`. */
const VALUE_RE = /\(property\s+"Value"\s+"([^"]*)"/;
/** Pad number: the first token after `(pad ` — quoted in KiCad 6+, bare in ≤5. */
const PAD_NUM_RE = /^\(pad\s+(?:"([^"]*)"|([^\s()]+))/;
/** Net reference inside a pad: `(net 2 "GND")` or `(net 2 GND)`. */
const PAD_NET_RE = /\(net\s+\d+\s+(?:"([^"]*)"|([^\s()]+))\s*\)/;
/** Numbered stackup entry: `(0 "F.Cu" signal)`, unquoted in KiCad ≤5. */
const LAYER_ENTRY_RE = /\(\d+\s+(?:"([^"]+)"|([^\s()]+))/g;
/** Any point-bearing sub-expr inside a graphic item. */
const POINT_RE = /\((?:start|end|center|mid|xy)\s+(-?[\d.]+)\s+(-?[\d.]+)\)/g;

const EDGE_CUTS = "Edge.Cuts";
const GRAPHIC_KEYWORDS = [
  "gr_line",
  "gr_rect",
  "gr_poly",
  "gr_arc",
  "gr_circle",
];

/**
 * Footprint blocks across format generations: KiCad 6+ uses `(footprint ...)`,
 * KiCad ≤5 uses `(module ...)`. A board has one or the other, never both.
 */
function footprintBlocks(text: string): string[] {
  const modern = extractBlocks(text, "footprint");
  return modern.length > 0 ? modern : extractBlocks(text, "module");
}

/** RefDes of a footprint block, across formats; null when unset. */
function blockRefDes(block: string): string | null {
  const modern = REF_RE.exec(block);
  if (modern) return modern[1] || null;
  const legacy = LEGACY_REF_RE.exec(block);
  return legacy ? (legacy[1] ?? legacy[2] ?? null) : null;
}

function parsePlacements(text: string): Placement[] {
  const placements: Placement[] = [];
  for (const block of footprintBlocks(text)) {
    const refDes = blockRefDes(block);
    if (!refDes) continue;

    const at = AT_RE.exec(block);
    if (!at) continue;

    // A footprint's own layer is the first `(layer "..")` (singular); pad
    // layers use `(layers ..)` (plural) and never match this.
    const layer = extractAttr(block, "layer") ?? "F.Cu";

    placements.push({
      refDes,
      x: Number(at[1]),
      y: Number(at[2]),
      rotation: at[3] ? Number(at[3]) : 0,
      layer,
    });
  }
  return placements;
}

function parseCopperLayers(text: string): string[] {
  // The stackup is defined once, in the first top-level (layers ...) block
  // (before any footprint's own plural (layers ..) sub-exprs).
  const [stackup] = extractBlocks(text, "layers");
  if (!stackup) return [];

  const names: string[] = [];
  LAYER_ENTRY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LAYER_ENTRY_RE.exec(stackup)) !== null) {
    const name = m[1] ?? m[2];
    if (name.endsWith(".Cu")) names.push(name);
  }
  return names;
}

function parseDimensions(text: string): {
  widthMm: number | null;
  heightMm: number | null;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  // Edge.Cuts layer name is quoted in KiCad 6+, bare in ≤5.
  const edgeCutsRe = new RegExp(
    `\\(layer\\s+"?${EDGE_CUTS.replace(".", "\\.")}"?\\s*\\)`
  );
  for (const keyword of GRAPHIC_KEYWORDS) {
    for (const block of extractBlocks(text, keyword)) {
      if (!edgeCutsRe.test(block)) continue;
      POINT_RE.lastIndex = 0;
      let p: RegExpExecArray | null;
      while ((p = POINT_RE.exec(block)) !== null) {
        const x = Number(p[1]);
        const y = Number(p[2]);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { widthMm: null, heightMm: null };
  }
  return {
    widthMm: round2(maxX - minX),
    heightMm: round2(maxY - minY),
  };
}

function parseZones(text: string): ZoneMeta[] {
  return extractBlocks(text, "zone").map((zone) => ({
    netName: extractAttr(zone, "net_name"),
    // Single-layer zones use (layer ..); multi-layer use (layers ..) — fall
    // back to the plural's first name.
    layer: extractAttr(zone, "layer") ?? extractAttr(zone, "layers"),
  }));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Pure parse — no I/O. Exported for unit testing. */
export function parseKicadPcb(text: string): PcbLayout {
  const copperLayers = parseCopperLayers(text);
  return {
    placements: parsePlacements(text),
    board: {
      ...parseDimensions(text),
      copperLayers,
      layerCount: copperLayers.length,
      zones: parseZones(text),
    },
  };
}

/**
 * Write layout facts for a project: placement onto each Component (matched by
 * refDes, only touching the placement columns so the netlist parse is never
 * clobbered) and a single Board row. A component present in the layout but not
 * yet in the netlist is created placement-only.
 */
export async function persistPcbLayout(
  projectId: string,
  layout: PcbLayout,
  sourceFile: string
): Promise<PcbLayoutSummary> {
  // Batched + transactional (audit #5): one read, createMany for new
  // placement-only components, targeted updates only where a value changed.
  // Serialized per project: this is the createMany that died on the
  // (projectId, refDes) unique constraint when two syncs overlapped.
  await withProjectLock(projectId, () =>
    prisma.$transaction(
      async (tx) => {
        const existing = await tx.component.findMany({
          where: { projectId },
          select: {
            id: true,
            refDes: true,
            posX: true,
            posY: true,
            rotation: true,
            layer: true,
          },
        });
        const byRefDes = new Map(existing.map((c) => [c.refDes, c]));

        const toCreate = layout.placements.filter(
          (p) => !byRefDes.has(p.refDes)
        );
        if (toCreate.length > 0) {
          await tx.component.createMany({
            data: toCreate.map((p) => ({
              projectId,
              refDes: p.refDes,
              posX: p.x,
              posY: p.y,
              rotation: p.rotation,
              layer: p.layer,
            })),
          });
        }

        for (const p of layout.placements) {
          const current = byRefDes.get(p.refDes);
          if (!current) continue;
          if (
            current.posX !== p.x ||
            current.posY !== p.y ||
            current.rotation !== p.rotation ||
            current.layer !== p.layer
          ) {
            await tx.component.update({
              where: { id: current.id },
              data: {
                posX: p.x,
                posY: p.y,
                rotation: p.rotation,
                layer: p.layer,
              },
            });
          }
        }

        const { board } = layout;
        const data = {
          widthMm: board.widthMm,
          heightMm: board.heightMm,
          layerCount: board.layerCount,
          copperLayers: JSON.stringify(board.copperLayers),
          zones: JSON.stringify(board.zones),
          sourceFile,
          parsedAt: new Date(),
        };
        await tx.board.upsert({
          where: { projectId },
          update: data,
          create: { projectId, ...data },
        });
      },
      { timeout: 60_000, maxWait: 10_000 }
    )
  );

  const { board } = layout;
  return {
    placedCount: layout.placements.length,
    layerCount: board.layerCount,
    widthMm: board.widthMm,
    heightMm: board.heightMm,
    zoneCount: board.zones.length,
    placedRefDes: [...new Set(layout.placements.map((p) => p.refDes))],
  };
}

// ---------------------------------------------------------------------------
// Board-derived connectivity (components + pad→net) — the no-schematic path.
//
// The .kicad_pcb format has carried per-pad net assignments since KiCad 4, so
// a board file alone yields the full component list and net connectivity —
// coarser than a schematic netlist (pads, not pin functions; no MPN/datasheet
// fields), but enough to study a design whose schematic is legacy-format or
// missing entirely.
// ---------------------------------------------------------------------------

/** Pure parse of components + nets from board text. Exported for unit tests. */
export function parseKicadPcbConnectivity(text: string): {
  components: ComponentRecord[];
  nets: NetRecord[];
} {
  const components: ComponentRecord[] = [];
  const netPins = new Map<string, PinRef[]>();
  const seen = new Set<string>();

  for (const block of footprintBlocks(text)) {
    const refDes = blockRefDes(block);
    if (!refDes || seen.has(refDes)) continue;
    seen.add(refDes);

    // Footprint lib id: first token after the block keyword.
    const head = /^\((?:footprint|module)\s+(?:"([^"]*)"|([^\s()]+))/.exec(
      block
    );
    const footprint = head ? (head[1] ?? head[2] ?? null) : null;
    const value =
      VALUE_RE.exec(block)?.[1] ??
      (() => {
        const legacy = LEGACY_VALUE_RE.exec(block);
        return legacy ? (legacy[1] ?? legacy[2] ?? null) : null;
      })();

    // The board file's "value" is the value proper ("100n" / "STM32F446").
    // Never write it to name: this parse runs after the netlist parse in a
    // sync, and the null-merge update would clobber the netlist's libsource
    // part name. Display code falls back name → value for board-only parts.
    components.push({
      refDes,
      name: null,
      value: value?.trim() ? value : null,
      footprint,
      mpn: null,
      datasheetUrl: null,
    });

    const padSeen = new Set<string>();
    for (const pad of extractBlocks(block, "pad")) {
      const num = PAD_NUM_RE.exec(pad);
      const pinNumber = num ? (num[1] ?? num[2]) : null;
      if (!pinNumber || pinNumber === '""') continue;

      const net = PAD_NET_RE.exec(pad);
      const netName = net ? (net[1] ?? net[2]) : null;
      if (!netName) continue; // unconnected pad

      // Multi-geometry pads repeat the same number (thermal pads etc.) —
      // one logical pin per (pad, net).
      const key = `${pinNumber}\0${netName}`;
      if (padSeen.has(key)) continue;
      padSeen.add(key);

      const pins = netPins.get(netName) ?? [];
      pins.push({ refDes, pinNumber });
      netPins.set(netName, pins);
    }
  }

  const nets: NetRecord[] = [...netPins.entries()].map(([name, pins]) => ({
    name,
    pins,
  }));
  return { components, nets };
}

/**
 * Parse connectivity from a .kicad_pcb and upsert it through the same
 * writeConnectivity path the netlist parsers use. Additive (no prune):
 * a board import must never delete what a netlist established.
 */
export async function parseBoardConnectivityFile(
  projectId: string,
  filePath: string
): Promise<NetlistParseSummary> {
  let text: string;
  try {
    text = await readFile(filePath, "utf-8");
  } catch (err) {
    throw new AppError(
      "PARSE_ERROR",
      `Cannot read KiCad board file: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const { components, nets } = parseKicadPcbConnectivity(text);
  if (components.length === 0) {
    throw new AppError(
      "PARSE_ERROR",
      "No footprints found. Verify the file is a KiCad .kicad_pcb board."
    );
  }

  const written = await writeConnectivity(projectId, components, nets, {});
  return {
    componentCount: components.length,
    netCount: nets.length,
    connectionCount: written.connectionCount,
    components: components.map((c) => c.refDes),
    nets: nets.map((n) => n.name),
    allRefDes: written.allRefDes,
    pruned: written.pruned,
  };
}

/** Read, parse, and persist a .kicad_pcb file for a project. */
export async function parsePcbLayoutFile(
  projectId: string,
  filePath: string,
  sourceFile: string
): Promise<PcbLayoutSummary> {
  let text: string;
  try {
    text = await readFile(filePath, "utf-8");
  } catch (err) {
    throw new AppError(
      "PARSE_ERROR",
      `Cannot read KiCad board file: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return persistPcbLayout(projectId, parseKicadPcb(text), sourceFile);
}
