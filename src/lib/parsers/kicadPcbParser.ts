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

import { extractAttr, extractBlocks } from "./sexpr";

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
/** Numbered stackup entry: `(0 "F.Cu" signal)`. */
const LAYER_ENTRY_RE = /\(\d+\s+"([^"]+)"/g;
/** Any point-bearing sub-expr inside a graphic item. */
const POINT_RE = /\((?:start|end|center|mid|xy)\s+(-?[\d.]+)\s+(-?[\d.]+)\)/g;

const EDGE_CUTS = "Edge.Cuts";
const GRAPHIC_KEYWORDS = ["gr_line", "gr_rect", "gr_poly", "gr_arc", "gr_circle"];

function parsePlacements(text: string): Placement[] {
  const placements: Placement[] = [];
  for (const block of extractBlocks(text, "footprint")) {
    const refMatch = REF_RE.exec(block);
    const refDes = refMatch?.[1];
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
    if (m[1].endsWith(".Cu")) names.push(m[1]);
  }
  return names;
}

function parseDimensions(text: string): { widthMm: number | null; heightMm: number | null } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const keyword of GRAPHIC_KEYWORDS) {
    for (const block of extractBlocks(text, keyword)) {
      if (!block.includes(`"${EDGE_CUTS}"`)) continue;
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
  await prisma.$transaction(
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

      const toCreate = layout.placements.filter((p) => !byRefDes.has(p.refDes));
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
            data: { posX: p.x, posY: p.y, rotation: p.rotation, layer: p.layer },
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
