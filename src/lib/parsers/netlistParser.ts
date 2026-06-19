/**
 * Altium Protel netlist parser.
 *
 * Parses the bracket-delimited .net format Altium Designer exports:
 *   [...]  — component record: line 1 = RefDes, line 2 = footprint, line 3+ = name
 *   (...)  — net record:       line 1 = net name, lines 2+ = "REFDES-PIN" pairs
 *
 * Upserts Components, Nets, Pins, and Connections into the project. Safe to
 * call multiple times — subsequent parses of the same file converge to the same
 * DB state rather than creating duplicates.
 */
import "server-only";

import { readFile } from "fs/promises";

import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

export interface NetlistParseSummary {
  componentCount: number;
  netCount: number;
  connectionCount: number;
  /** RefDes list discovered in component blocks. */
  components: string[];
  /** Net names discovered in net blocks. */
  nets: string[];
}

// ---------------------------------------------------------------------------
// Internal parse types
// ---------------------------------------------------------------------------

export interface ComponentRecord {
  refDes: string;
  footprint: string | null;
  name: string | null;
}

export interface PinRef {
  refDes: string;
  pinNumber: string;
}

export interface NetRecord {
  name: string;
  pins: PinRef[];
}

interface ParsedNetlistData {
  components: ComponentRecord[];
  nets: NetRecord[];
}

// ---------------------------------------------------------------------------
// Text parser (pure, no I/O)
// ---------------------------------------------------------------------------

function parseText(text: string): ParsedNetlistData {
  // Normalize to LF
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const components: ComponentRecord[] = [];
  const nets: NetRecord[] = [];

  // Component blocks: [...] — [^\]] matches any char including \n, excluding ]
  const compRe = /\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;

  while ((m = compRe.exec(src)) !== null) {
    const lines = m[1]
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    const refDes = lines[0];
    const footprint = lines.length > 1 ? lines[1] : null;
    // Lines 3+ are name / description — join them
    const name = lines.length > 2 ? lines.slice(2).join(" ").trim() || null : null;

    if (refDes) {
      components.push({ refDes, footprint, name });
    }
  }

  // Net blocks: (...) — [^)] matches any char including \n, excluding )
  const netRe = /\(([^)]*)\)/g;

  while ((m = netRe.exec(src)) !== null) {
    const lines = m[1]
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    // Need at least a net name and one pin reference
    if (lines.length < 2) continue;

    const netName = lines[0];
    const pins: PinRef[] = [];

    for (let i = 1; i < lines.length; i++) {
      const raw = lines[i];
      // Format: REFDES-PINNUMBER  e.g. "U7-1", "R12-14", "J1-A3"
      // Use the FIRST dash as the separator — Altium RefDes never contain dashes
      const dashAt = raw.indexOf("-");
      if (dashAt <= 0) continue;
      const refDes = raw.slice(0, dashAt).trim();
      const pinNumber = raw.slice(dashAt + 1).trim();
      if (refDes && pinNumber) {
        pins.push({ refDes, pinNumber });
      }
    }

    if (netName && pins.length > 0) {
      nets.push({ name: netName, pins });
    }
  }

  return { components, nets };
}

// ---------------------------------------------------------------------------
// DB upserts
// ---------------------------------------------------------------------------

export async function upsertComponents(
  projectId: string,
  components: ComponentRecord[]
): Promise<void> {
  for (const comp of components) {
    await prisma.component.upsert({
      where: { projectId_refDes: { projectId, refDes: comp.refDes } },
      // Only overwrite fields if the parse gave us a value — avoids blanking
      // data a user or prior parse may have supplied.
      update: {
        ...(comp.name != null ? { name: comp.name } : {}),
        ...(comp.footprint != null ? { footprint: comp.footprint } : {}),
      },
      create: {
        projectId,
        refDes: comp.refDes,
        name: comp.name,
        footprint: comp.footprint,
      },
    });
  }
}

export async function upsertNets(
  projectId: string,
  nets: NetRecord[]
): Promise<void> {
  for (const net of nets) {
    await prisma.net.upsert({
      where: { projectId_name: { projectId, name: net.name } },
      update: {},
      create: { projectId, name: net.name },
    });
  }
}

export async function upsertPinsAndConnections(
  projectId: string,
  nets: NetRecord[]
): Promise<number> {
  let connectionCount = 0;

  for (const net of nets) {
    const netRecord = await prisma.net.findUniqueOrThrow({
      where: { projectId_name: { projectId, name: net.name } },
    });

    for (const pin of net.pins) {
      // Ensure the component exists even if it had no component block
      const component = await prisma.component.upsert({
        where: { projectId_refDes: { projectId, refDes: pin.refDes } },
        update: {},
        create: { projectId, refDes: pin.refDes },
      });

      const pinRecord = await prisma.pin.upsert({
        where: {
          componentId_number: { componentId: component.id, number: pin.pinNumber },
        },
        update: {},
        create: { componentId: component.id, number: pin.pinNumber },
      });

      // A pin connects to exactly one net — update if it changed
      await prisma.connection.upsert({
        where: { pinId: pinRecord.id },
        update: { netId: netRecord.id },
        create: { pinId: pinRecord.id, netId: netRecord.id },
      });

      connectionCount++;
    }
  }

  return connectionCount;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an Altium Protel .net file and upsert the connectivity data for the
 * given project. Returns a summary of what was written.
 */
export async function parseNetlistFile(
  projectId: string,
  filePath: string
): Promise<NetlistParseSummary> {
  let text: string;
  try {
    text = await readFile(filePath, "utf-8");
  } catch (err) {
    throw new AppError(
      "PARSE_ERROR",
      `Cannot read netlist file: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const { components, nets } = parseText(text);

  if (components.length === 0 && nets.length === 0) {
    throw new AppError(
      "PARSE_ERROR",
      "No components or nets found. Verify the file is an Altium Protel .net export."
    );
  }

  // Write in dependency order: components → nets → pins/connections
  await upsertComponents(projectId, components);
  await upsertNets(projectId, nets);
  const connectionCount = await upsertPinsAndConnections(projectId, nets);

  return {
    componentCount: components.length,
    netCount: nets.length,
    connectionCount,
    components: components.map((c) => c.refDes),
    nets: nets.map((n) => n.name),
  };
}
