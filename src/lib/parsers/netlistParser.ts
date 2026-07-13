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
import { withProjectLock } from "@/lib/project-lock";

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
  /**
   * Every refdes this parse saw — component blocks plus pin-only references.
   * The folder-sync reconciliation pass uses this as the netlist half of the
   * "what still exists on the board" union.
   */
  allRefDes: string[];
  /** Present when the parse ran with prune enabled (sync provenance). */
  pruned?: PruneSummary;
}

export interface PruneSummary {
  netsDeleted: number;
  pinsDeleted: number;
  /** Set when the shrink guard refused to delete (parse looked partial). */
  skippedReason?: string;
}

// ---------------------------------------------------------------------------
// Internal parse types
// ---------------------------------------------------------------------------

export interface ComponentRecord {
  refDes: string;
  footprint: string | null;
  name: string | null;
  mpn: string | null;
  /** Component value proper (KiCad "value" attr), e.g. "100n", "10k". */
  value?: string | null;
  /** Human description (KiCad libsource description), if the format has one. */
  description?: string | null;
  /** Datasheet URL from the design (KiCad "Datasheet" property), if any. */
  datasheetUrl?: string | null;
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
    const name =
      lines.length > 2 ? lines.slice(2).join(" ").trim() || null : null;

    if (refDes) {
      components.push({ refDes, footprint, name, mpn: null });
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
// DB write layer — shared by the Altium and KiCad netlist parsers
// ---------------------------------------------------------------------------
//
// One batched, transactional write instead of per-row awaited upserts
// (audit findings #1/#5): read the project's existing connectivity in four
// queries, diff in memory, apply createMany/deleteMany/targeted updates. A
// crash mid-parse rolls back to the previous consistent state instead of
// leaving the design half-updated.
//
// Preserved contracts (pinned by sync-behavior.db.test.ts):
//   - Null-merge updates: a parse that lacks a field never blanks a value a
//     prior parse (or the user) supplied.
//   - Pin-only refs create bare components ("ensure exists").
//   - Re-parses converge; a pin moving nets rewires its Connection in place.
//   - Without opts.prune, writes are purely additive (manual upload path).

/** SQLite parameter limit is 999; stay well under it for `in` lists. */
const CHUNK = 200;

function chunk<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK)
    out.push(items.slice(i, i + CHUNK));
  return out;
}

/**
 * Below this many existing rows the shrink guard stays out of the way —
 * replacing a small scratch design wholesale is a legitimate sync.
 */
const SHRINK_GUARD_MIN_ROWS = 20;
/** Refuse prune deletes when the fresh parse covers less than this fraction. */
const SHRINK_GUARD_MIN_RATIO = 0.5;

export interface WriteConnectivityResult {
  /** Matches the old return: total pin references processed. */
  connectionCount: number;
  /** Every refdes seen: component blocks ∪ pin references. */
  allRefDes: string[];
  pruned?: PruneSummary;
}

export async function writeConnectivity(
  projectId: string,
  components: ComponentRecord[],
  nets: NetRecord[],
  opts: {
    /**
     * Sync provenance only: the parse is a fresh full-design export, so nets
     * and pins absent from it are stale — delete them (scoped to components
     * present in this parse; component-level deletion is the folder-sync
     * reconciler's job, which also knows about layout-only parts).
     */
    prune?: boolean;
  } = {}
): Promise<WriteConnectivityResult> {
  // Merge duplicate component blocks, later non-null fields winning — the
  // same result the old sequential upserts converged to.
  const freshComponents = new Map<string, ComponentRecord>();
  for (const c of components) {
    const prev = freshComponents.get(c.refDes);
    if (!prev) {
      freshComponents.set(c.refDes, { ...c });
    } else {
      if (c.name != null) prev.name = c.name;
      if (c.footprint != null) prev.footprint = c.footprint;
      if (c.mpn != null) prev.mpn = c.mpn;
      if (c.value != null) prev.value = c.value;
      if (c.description != null) prev.description = c.description;
      if (c.datasheetUrl != null) prev.datasheetUrl = c.datasheetUrl;
    }
  }
  // Pin references without a component block still create the component.
  for (const net of nets) {
    for (const pin of net.pins) {
      if (!freshComponents.has(pin.refDes)) {
        freshComponents.set(pin.refDes, {
          refDes: pin.refDes,
          footprint: null,
          name: null,
          mpn: null,
        });
      }
    }
  }

  // Desired pin → net mapping. A pin listed under two nets keeps the later
  // one, matching the old upsert order.
  const pinKey = (refDes: string, pinNumber: string) => `${refDes}\0${pinNumber}`;
  const desiredPinNet = new Map<
    string,
    { refDes: string; pinNumber: string; netName: string }
  >();
  let connectionCount = 0;
  for (const net of nets) {
    for (const pin of net.pins) {
      desiredPinNet.set(pinKey(pin.refDes, pin.pinNumber), {
        refDes: pin.refDes,
        pinNumber: pin.pinNumber,
        netName: net.name,
      });
      connectionCount++;
    }
  }
  const freshNetNames = new Set(nets.map((n) => n.name));

  // Serialized per project: the read-diff-createMany below assumes no other
  // writer lands between the read and the write. See project-lock.ts.
  const pruned = await withProjectLock(projectId, () =>
    prisma.$transaction(
      async (tx) => {
        // ── Read existing state (4 queries) ─────────────────────────────────
        const existingComponents = await tx.component.findMany({
          where: { projectId },
          select: {
            id: true,
            refDes: true,
            name: true,
            footprint: true,
            mpn: true,
            value: true,
            description: true,
            datasheetUrl: true,
          },
        });
        const existingNets = await tx.net.findMany({
          where: { projectId },
          select: { id: true, name: true },
        });
        const existingPins = await tx.pin.findMany({
          where: { component: { projectId } },
          select: { id: true, componentId: true, number: true },
        });
        const existingConnections = await tx.connection.findMany({
          where: { net: { projectId } },
          select: { id: true, pinId: true, netId: true },
        });

        const componentIdByRef = new Map(
          existingComponents.map((c) => [c.refDes, c.id])
        );
        const netIdByName = new Map(existingNets.map((n) => [n.name, n.id]));

        // ── Components: create missing, null-merge update changed ───────────
        const componentsToCreate = [...freshComponents.values()].filter(
          (c) => !componentIdByRef.has(c.refDes)
        );
        if (componentsToCreate.length > 0) {
          const created = await tx.component.createManyAndReturn({
            data: componentsToCreate.map((c) => ({
              projectId,
              refDes: c.refDes,
              name: c.name,
              footprint: c.footprint,
              mpn: c.mpn,
              value: c.value ?? null,
              description: c.description ?? null,
              datasheetUrl: c.datasheetUrl ?? null,
            })),
            select: { id: true, refDes: true },
          });
          for (const c of created) componentIdByRef.set(c.refDes, c.id);
        }
        for (const existing of existingComponents) {
          const fresh = freshComponents.get(existing.refDes);
          if (!fresh) continue;
          const patch: Partial<
            Record<
              "name" | "footprint" | "mpn" | "value" | "description" | "datasheetUrl",
              string
            >
          > = {};
          if (fresh.name != null && fresh.name !== existing.name)
            patch.name = fresh.name;
          if (fresh.footprint != null && fresh.footprint !== existing.footprint)
            patch.footprint = fresh.footprint;
          if (fresh.mpn != null && fresh.mpn !== existing.mpn)
            patch.mpn = fresh.mpn;
          if (fresh.value != null && fresh.value !== existing.value)
            patch.value = fresh.value;
          if (
            fresh.description != null &&
            fresh.description !== existing.description
          )
            patch.description = fresh.description;
          if (
            fresh.datasheetUrl != null &&
            fresh.datasheetUrl !== existing.datasheetUrl
          )
            patch.datasheetUrl = fresh.datasheetUrl;
          if (Object.keys(patch).length > 0) {
            await tx.component.update({
              where: { id: existing.id },
              data: patch,
            });
          }
        }

        // ── Nets: create missing ─────────────────────────────────────────────
        const netsToCreate = [...freshNetNames].filter(
          (name) => !netIdByName.has(name)
        );
        if (netsToCreate.length > 0) {
          const created = await tx.net.createManyAndReturn({
            data: netsToCreate.map((name) => ({ projectId, name })),
            select: { id: true, name: true },
          });
          for (const n of created) netIdByName.set(n.name, n.id);
        }

        // ── Pins: create missing ─────────────────────────────────────────────
        const pinIdByCompNumber = new Map(
          existingPins.map((p) => [`${p.componentId}\0${p.number}`, p.id])
        );
        const pinsToCreate: { componentId: string; number: string }[] = [];
        for (const d of desiredPinNet.values()) {
          const componentId = componentIdByRef.get(d.refDes);
          if (!componentId) continue; // unreachable: fresh components cover all pin refs
          if (!pinIdByCompNumber.has(`${componentId}\0${d.pinNumber}`)) {
            pinsToCreate.push({ componentId, number: d.pinNumber });
          }
        }
        if (pinsToCreate.length > 0) {
          const created = await tx.pin.createManyAndReturn({
            data: pinsToCreate,
            select: { id: true, componentId: true, number: true },
          });
          for (const p of created) {
            pinIdByCompNumber.set(`${p.componentId}\0${p.number}`, p.id);
          }
        }

        // ── Prune stale nets and pins (sync provenance only) ─────────────────
        let pruneResult: PruneSummary | undefined;
        const deletedNetIds = new Set<string>();
        const deletedPinIds = new Set<string>();
        if (opts.prune) {
          const staleNets = existingNets.filter(
            (n) => !freshNetNames.has(n.name)
          );
          // Only pins of components present in THIS parse — a component absent
          // from the netlist (stale, or layout-only) is the reconciler's call.
          const freshComponentIds = new Set(
            [...freshComponents.keys()].map((r) => componentIdByRef.get(r)!)
          );
          const desiredPinIds = new Set(
            [...desiredPinNet.values()].map((d) =>
              pinIdByCompNumber.get(
                `${componentIdByRef.get(d.refDes)}\0${d.pinNumber}`
              )
            )
          );
          const stalePins = existingPins.filter(
            (p) =>
              freshComponentIds.has(p.componentId) && !desiredPinIds.has(p.id)
          );

          // Shrink guard: a drastically smaller parse looks like a parser
          // hiccup, not a redesign — upsert but refuse to delete.
          const netsLookPartial =
            existingNets.length >= SHRINK_GUARD_MIN_ROWS &&
            freshNetNames.size < existingNets.length * SHRINK_GUARD_MIN_RATIO;
          const pinsLookPartial =
            existingPins.length >= SHRINK_GUARD_MIN_ROWS &&
            desiredPinNet.size < existingPins.length * SHRINK_GUARD_MIN_RATIO;

          if (netsLookPartial || pinsLookPartial) {
            pruneResult = {
              netsDeleted: 0,
              pinsDeleted: 0,
              skippedReason: `fresh parse looks partial (${freshNetNames.size}/${existingNets.length} nets, ${desiredPinNet.size}/${existingPins.length} pins) — kept existing rows`,
            };
          } else {
            for (const ids of chunk(staleNets.map((n) => n.id))) {
              await tx.net.deleteMany({ where: { id: { in: ids } } });
            }
            for (const ids of chunk(stalePins.map((p) => p.id))) {
              await tx.pin.deleteMany({ where: { id: { in: ids } } });
            }
            for (const n of staleNets) deletedNetIds.add(n.id);
            for (const p of stalePins) deletedPinIds.add(p.id);
            pruneResult = {
              netsDeleted: staleNets.length,
              pinsDeleted: stalePins.length,
            };
          }
        }

        // ── Connections: create missing, rewire moved pins ───────────────────
        // Deleting nets/pins above cascaded their connection rows; filter the
        // snapshot to what actually survives.
        const connectionByPinId = new Map(
          existingConnections
            .filter(
              (c) => !deletedPinIds.has(c.pinId) && !deletedNetIds.has(c.netId)
            )
            .map((c) => [c.pinId, c])
        );
        const connectionsToCreate: { pinId: string; netId: string }[] = [];
        for (const d of desiredPinNet.values()) {
          const componentId = componentIdByRef.get(d.refDes);
          const pinId = pinIdByCompNumber.get(`${componentId}\0${d.pinNumber}`);
          const netId = netIdByName.get(d.netName);
          if (!pinId || !netId) continue;
          const existing = connectionByPinId.get(pinId);
          if (!existing) {
            connectionsToCreate.push({ pinId, netId });
          } else if (existing.netId !== netId) {
            await tx.connection.update({
              where: { id: existing.id },
              data: { netId },
            });
          }
        }
        if (connectionsToCreate.length > 0) {
          await tx.connection.createMany({ data: connectionsToCreate });
        }

        return pruneResult;
      },
      // Headroom for large boards; SQLite serializes writers anyway.
      { timeout: 60_000, maxWait: 10_000 }
    )
  );

  return {
    connectionCount,
    allRefDes: [...freshComponents.keys()],
    pruned,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an Altium Protel .net file and upsert the connectivity data for the
 * given project. Returns a summary of what was written.
 *
 * `opts.prune` (sync provenance only) additionally deletes nets and pins that
 * are absent from this parse — see writeConnectivity.
 */
export async function parseNetlistFile(
  projectId: string,
  filePath: string,
  opts: { prune?: boolean } = {}
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

  const written = await writeConnectivity(projectId, components, nets, opts);

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
