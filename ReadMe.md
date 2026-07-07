# ⚡ Resistance — AI-Powered Electrical Engineering Project Assistant

Resistance is a local-first assistant for electrical/hardware engineers. Link a
KiCad project folder (or upload Altium/KiCad exports — netlists, BOMs,
schematic PDFs, datasheets, requirements docs) and Resistance turns them into a
queryable design database, an interactive connectivity graph, and an AI
assistant + design reviewer whose answers are grounded in your actual board:

- What connects to **U7**? What's on the **5V** rail?
- Where is **C3** placed, and what's near it on the board?
- Does anything exceed its datasheet's absolute maximums?
- What design-review risks should a human engineer check before spinning?

> The quality bar for this project lives in
> [`docs/ENGINEERING_STANDARDS.md`](./docs/ENGINEERING_STANDARDS.md).
> CI enforces typecheck + lint + tests on every push.

---

## What's real today

| Area | Status |
| --- | --- |
| **Parsers** | Altium Protel `.net`, KiCad S-expression `.net` (auto-detected), KiCad `.kicad_pcb` layout (placements, board dims, copper stackup, zones), Altium binary validation, BOM CSV with tolerant header mapping |
| **KiCad integration** | Link a KiCad folder in-app: import, one-click sync, optional file-watcher auto-sync. Sync is authoritative — parts deleted in KiCad are reconciled out of the database (guarded against partial parses). Plus a standalone [KiCad MCP server](./packages/kicad-mcp) (DRC/ERC/render/BOM/netlist via kicad-cli) |
| **AI assistant** | Streams from the Anthropic API with a multi-round tool loop: schematic tools (nets, components, search), EE-graph tools (topology, net/component analysis), and physical-layout tools (dimensions, placement, proximity) |
| **AI design review** | Multi-round tool loop with EE calculators and datasheet-grounded compliance checks; findings persist as review runs |
| **Datasheets** | Automatic ingestion with a verification gate (magic bytes, size cap, MPN-in-document check, quarantine), global content-hash library, MPN→specs enrichment, FTS5 full-text search |
| **Connectivity graph** | Interactive React Flow bipartite graph (components ↔ nets) with click-to-trace |
| **Desktop** | Electron shell with native menus, settings, and server-side privacy gates (AI calls and datasheet fetching can each be disabled) |

Not built yet: semantic/embedding RAG (search is FTS5 keyword-only — roadmap in
`docs/EMBEDDINGS_FOR_RAG.md`), PCB track/routing extraction, multi-user auth.

---

## Tech stack

- **Next.js (App Router) + TypeScript (strict, zero `any`)** — UI, server
  actions, REST routes
- **Prisma + SQLite** — local dev; schema is PostgreSQL-compatible by design
- **Anthropic SDK** — assistant, design review, datasheet enrichment
- **React Flow** (`@xyflow/react`) — connectivity graph
- **Tailwind CSS**, **Zod**, **Vitest**, **ESLint + Prettier**
- **Electron** — desktop shell (`electron/`)
- **Python FastMCP + kiutils** — KiCad MCP server (`packages/kicad-mcp`)

---

## Getting started

### Prerequisites

- Node.js 24 (LTS)
- npm
- Optional: [KiCad](https://kicad.org) 8+ with `kicad-cli` on PATH — enables
  in-app folder sync exports, DRC/ERC, and board rendering
- Optional: an Anthropic API key — enables the AI assistant, design review,
  and datasheet enrichment (everything else works without it)

### Setup

```bash
# 1. Install dependencies (also runs `prisma generate` via postinstall)
npm install

# 2. Create the SQLite database, apply the schema, and seed demo data
npm run setup

# 3. Start the dev server
npm run dev
```

Open <http://localhost:3000>. The seed creates a demo project so every tab has
data. To use the AI features, add `ANTHROPIC_API_KEY` to `.env.local` or via
the in-app Settings page.

### Environment

`.env` is committed with safe local defaults (no secrets):

```bash
DATABASE_URL="file:./dev.db"   # SQLite for local dev
UPLOADS_DIR="uploads"          # local file storage directory
```

### Useful scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run desktop` | Build and run the Electron desktop app |
| `npm run dev:desktop` | Electron shell against the dev server |
| `npm test` | Unit suite + DB-backed integration suite |
| `npm run test:unit` | Pure unit tests only (fast) |
| `npm run test:db` | DB-backed tests (throwaway SQLite per file) |
| `npm run typecheck` | `tsc --noEmit` for app + electron |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run db:push` / `db:seed` / `db:reset` / `db:studio` | Prisma database tasks |
| `npm run review:dry-run` | Exercise the design-review pipeline from the CLI |

---

## Supported file types

Validated on upload (type + size gated), stored per-project under
server-generated names:

| Category | Extensions | Purpose |
| --- | --- | --- |
| `netlist` | `.net` | Altium Protel or KiCad S-expression (auto-detected) |
| `bom` | `.csv`, `.xlsx` | Bill of Materials |
| `altium` | `.SchDoc`, `.PcbDoc` | Altium binaries (validated, stored) |
| `pdf` | `.pdf` | Datasheets, schematic PDFs — text-extracted + indexed |
| `document` | `.md`, `.txt`, `.docx` | Requirements / general docs — indexed |

KiCad design files (`.kicad_sch`, `.kicad_pcb`, …) aren't uploaded directly —
link the project folder instead and Resistance exports/parses via kicad-cli.

---

## Architecture

UI, business logic, data access, parsing, and AI logic are kept apart:

```
src/
  app/                      # Next.js routes — thin UI + server actions only
    api/projects/[id]/      #   REST: upload, assistant, review, folder-import…
  components/               # Presentational + small client components
  server/
    services/               # Business logic — the only place that queries Prisma
      file-service.ts       #   validate → store → parse → status pipeline
      folder-sync-service.ts#   KiCad folder scan/import/sync + reconciliation
      review-service.ts     #   AI design-review runs
      datasheet-service.ts  #   MPN → specs enrichment (cached)
      ingest-service.ts     #   datasheet download + verification gate
    eda/                    # EDA-tool adapter (KiCad detection + exports)
  lib/
    parsers/                # netlist / KiCad netlist / .kicad_pcb / BOM / Altium
    board-tools.ts,
    ee-assistant-tools.ts   # AI tool definitions + executors
    ee-graph-queries.ts,
    ee-graph-semantics.ts   # pure connectivity analysis (tested)
electron/                   # desktop shell (spawns the standalone Next server)
packages/kicad-mcp/         # Python MCP server for KiCad (13 tools)
prisma/                     # schema + migrations + seed
```

**Write-layer contract:** parser DB writes are batched and transactional. A
crash mid-parse rolls back; a re-parse converges; parses never blank fields
they didn't produce. Sync-provenance parses prune stale nets/pins, and folder
sync reconciles deleted components (netlist ∪ layout, with a shrink guard so a
partial parse can never mass-delete a design). These contracts are pinned by
`src/lib/parsers/*.db.test.ts`.

---

## Testing

```bash
npm test          # everything
npm run test:unit # pure logic only (sub-second)
npm run test:db   # DB-backed characterization + reconciliation tests
```

The DB suite provisions a throwaway SQLite database per test file
(`src/test/db-setup.ts`) — no shared state, safe in parallel, runs in CI.

---

## Security & privacy notes

- Local-first: your design data stays in a local SQLite DB and local uploads
  directory. AI and datasheet fetching are opt-out via Settings and enforced
  server-side.
- Uploaded filenames are never trusted; files are stored under generated names
  with path-traversal guards at both storage seams.
- Fetched datasheets pass a verification gate (magic bytes, size cap, MPN
  match) or are quarantined pending human approval.
- Electron DB migrations take a timestamped backup first and refuse downgrades.
