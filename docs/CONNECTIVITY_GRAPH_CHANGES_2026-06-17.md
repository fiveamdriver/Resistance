# Connectivity Graph — Change Summary

**Date:** 2026-06-17
**Area:** Connectivity graph visualization (`Connectivity Graph` tab)
**Status:** Built & verified (62 tests / typecheck / build clean). The EE-aware
refactor is committed; the declutter pass is **uncommitted** (working tree).

---

## 1. What changed, in two passes

### Pass A — EE-aware connectivity graph (committed: `89e6739`)

Replaced the flat bipartite graph with an electrically-meaningful one. New pure,
unit-tested module **`src/lib/ee-graph-semantics.ts`** classifies nets and
components; the view (`src/components/dashboard/connectivity-tab.tsx`) renders
from it. Features:

1. **Voltage-hierarchy layout** — nets stacked top→bottom by tier:
   high-side power → regulated → intermediate → signal → ground. Components
   ordered by the Y-centroid of their nets to reduce edge crossings.
2. **Net color coding by tier** — coral (power), blue (regulated), teal
   (intermediate), purple (signal), gray (ground).
3. **0Ω / DNP jumper flagging** — dashed amber border, "0Ω jumper" subtitle,
   "Remove to isolate A from B" tooltip, and a hide toggle.
4. **Intermediate nets** — name-based (SENSE/FB) and topological (between a
   source and a load); teal with directional edge arrows.
5. **Fan-out badges** — connection count per net; amber + warning tooltip when
   the net has more than 4 connections.
6. **Component type badges** — IC / C / R / D / FUSE / CONN / LED; fuses get a
   red accent ("protection device"), connectors a distinct fuchsia.
7. **Click highlight + info panel** — selecting a node dims the rest to 20% and
   shows a detail card (role, connected parts/nets, fan-out). Click again clears.

**Pipeline fix (also in `89e6739`):** `buildGraph` / `getConnectivityGraph` now
carry component value/comment into the graph, so jumper detection works on real
parsed netlists (Altium Protel stores the value in the component comment).

### Pass B — Declutter / scalability (UNCOMMITTED)

The bipartite layout forces every edge across the full width, and high-fan-out
rails (GND had 15 edges) dominate. Fix:

- **Hide power & ground rails by default** (`high_power` + `ground` tiers).
  Each component instead shows small **rail chips** (e.g. `⚡VIN_F`, `⏚GND`),
  preserving the info without the edges. A **"Show power/GND"** toggle restores
  the full view.
- **Bypass caps fully collapsed** — decoupling caps are no longer drawn as
  nodes; their rail shows a `⊥N` badge and the rail's info panel lists them.
- **Status bar** reports hidden rails and collapsed-cap counts.

Net effect on the buck sample: a ~53-edge hairball becomes a clean signal-flow
view (U1, L1, D2, dividers, LED chain, connectors) with power/ground as chips.

---

## 2. Files touched

Committed (`89e6739`):

- `src/lib/ee-graph-semantics.ts` (+ `.test.ts`) — new classification module
- `src/components/dashboard/connectivity-tab.tsx` — rewritten view
- `src/types/connectivity.ts` — `buildGraph` carries component metadata
- `src/server/services/connectivity-service.ts` — fetches component value/comment
- `sample-files/buck-converter.net` + `buck-converter-bom.csv` — test board
- `scripts/dry-run-review.mjs`, `docs/TEST_PLAN.md` (same commit)

Uncommitted (Pass B):

- `src/components/dashboard/connectivity-tab.tsx` — power/GND hide + chips +
  bypass collapse + "Show power/GND" toggle

---

## 3. Verification

- `npm test` → 62 passing (includes 15 ee-graph-semantics tests)
- `npm run typecheck`, `npm run build` → clean
- Loaded the buck sample through the running app; classification confirmed on
  real parsed data: R7 flagged jumper; C1–C4 collapsed as bypass; GND(15)/
  3V3(7)/VIN_F(6) high fan-out; FB/3V3_SENSE intermediate.

---

## 4. Deferred (not done — possible next steps)

- **Neighborhood / focus-first view** — for very large boards, render only a
  selected node + its 1-hop neighborhood, expandable. The real scalability play.
- **ELK / dagre layered auto-layout** — replace the hand-placed two columns with
  a crossing-minimized left→right signal-flow layout, optionally grouped by
  functional block.
- Optional: a Component-vs-Net highlight *mode* toggle (today there is a legend
  + click-to-trace, not a mode switch).

---

## 5. Notes / gotchas

- Don't run `npm run build` or `rm -rf .next` while `npm run dev` is running — it
  corrupts `.next` and the page renders unstyled. Fix:
  `lsof -ti:3000 | xargs kill -9 && rm -rf .next && npm run dev`.
- If `tsx` fails with an esbuild platform error: `npm rebuild esbuild`.
