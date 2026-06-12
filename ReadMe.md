# ⚡ Resistance — AI-Powered Electrical Engineering Project Assistant

Resistance is a web app for electrical/hardware engineers. Upload your Altium
project exports — **netlists, BOMs, schematic PDFs, datasheets, and requirements
documents** — and Resistance turns them into a searchable project knowledge
base, a connectivity graph, and (eventually) an AI assistant that can answer
questions like:

- What connects to **U7**?
- What components are on the **5V** rail?
- What nets connect to this IC?
- Which BOM rows match this component?
- Which datasheets belong to these parts?
- What design-review risks should a human engineer check?

> **Status: Phase 1 (MVP foundation).** This is a working skeleton: project
> creation, file upload, file organization, and clean placeholder interfaces for
> the netlist/BOM/PDF parsers and the AI agent. Parsers currently return
> mock/sample data; no LLM is wired up yet.
>
> The quality bar for this project lives in
> [`docs/ENGINEERING_STANDARDS.md`](./docs/ENGINEERING_STANDARDS.md).

---

## Phase 1 scope

| Area              | Included in Phase 1                                               |
| ----------------- | ----------------------------------------------------------------- |
| Projects          | Create projects, list them, open a project dashboard              |
| File upload       | Local upload to `/uploads`, isolated per project, type/size gated |
| File organization | Files table with category, size, parse status, upload date        |
| Data model        | Full Prisma schema for the connectivity + BOM + RAG domains       |
| Parsers           | `parseNetlist` / `parseBom` / `parsePdf` / `chunkDocument` stubs  |
| Connectivity      | Typed graph model + search ("nets for U7", "components on 5V")    |
| AI assistant      | Chat UI with **canned** responses (no LLM)                        |
| Reports           | Project summary + placeholder for the design-review generator     |

What Phase 1 deliberately does **not** do yet: real Altium parsing, real BOM
parsing, PDF text extraction/RAG, LLM calls, and graph visualization. Each has a
clearly marked seam (see [Architecture](#architecture)).

---

## Tech stack

- **Next.js (App Router) + TypeScript** — UI and server actions / route handlers
- **Tailwind CSS** — styling
- **Prisma** — ORM
- **SQLite** for local dev (schema is **PostgreSQL-compatible** — see below)
- **Zod** — input/validation schemas
- **Vitest** — unit tests
- **ESLint + Prettier** — linting and formatting

---

## Getting started

### Prerequisites

- Node.js 18.18+ (developed on Node 20+)
- npm

### Setup

```bash
# 1. Install dependencies (also runs `prisma generate` via postinstall)
npm install

# 2. Create the SQLite database, apply the schema, and seed demo data
npm run setup
#   ≡ prisma generate && prisma db push && npm run db:seed

# 3. Start the dev server
npm run dev
```

Open <http://localhost:3000>. The seed creates a **"Demo Power Board"** project
with mock components, nets, and BOM rows so every tab shows real data.

### Environment

Configuration lives in `.env` (committed with safe local defaults — no secrets):

```bash
DATABASE_URL="file:./dev.db"   # SQLite for local dev
UPLOADS_DIR="uploads"          # local file storage directory
```

### Useful scripts

| Script               | What it does                            |
| -------------------- | --------------------------------------- |
| `npm run dev`        | Start the dev server                    |
| `npm run build`      | Production build                        |
| `npm test`           | Run the unit test suite (Vitest)        |
| `npm run test:watch` | Run tests in watch mode                 |
| `npm run lint`       | ESLint                                  |
| `npm run format`     | Prettier (write)                        |
| `npm run typecheck`  | `tsc --noEmit`                          |
| `npm run db:push`    | Apply the Prisma schema to the database |
| `npm run db:seed`    | Seed demo/mock data                     |
| `npm run db:reset`   | Reset the DB and re-seed                |
| `npm run db:studio`  | Open Prisma Studio                      |

---

## Supported file types

Validated on upload (type + 25 MB size limit), then stored per-project under a
server-generated filename:

| Category   | Extensions             | Purpose                     |
| ---------- | ---------------------- | --------------------------- |
| `netlist`  | `.net`                 | Altium netlist exports      |
| `bom`      | `.csv`, `.xlsx`        | Bill of Materials           |
| `pdf`      | `.pdf`                 | Datasheets, schematic PDFs  |
| `document` | `.md`, `.txt`, `.docx` | Requirements / general docs |

Sample/mock files for testing live in [`sample-files/`](./sample-files).

---

## Architecture

Separation of concerns is the organizing principle — UI, business logic, data
access, parsing, and AI logic are kept apart.

```
src/
  app/                      # Next.js routes — thin UI + server actions only
    page.tsx                #   Home
    projects/               #   List, create (server action), dashboard
    api/projects/route.ts   #   REST surface (JSON) for future clients
  components/               # Presentational + small client components
    dashboard/              #   Tabs, upload, tables, connectivity, AI chat
    projects/, ui/          #   Forms and shared primitives
  server/services/          # Business logic — the ONLY place that queries Prisma
    project-service.ts
    file-service.ts         #   validate -> store -> record upload pipeline
    connectivity-service.ts #   builds the ConnectivityGraph from the DB
  lib/                      # Cross-cutting helpers
    prisma.ts, storage.ts   #   data access + local file storage
    fileTypes.ts, validation.ts, errors.ts, format.ts
    ai/canned-assistant.ts  #   placeholder assistant routing (no LLM)
  parsers/                  # parseNetlist / parseBom / parsePdf / chunkDocument
  types/connectivity.ts     # ComponentNode / NetNode / PinConnection / Graph
prisma/                     # schema.prisma + seed.ts
sample-files/               # mock netlist / BOM / requirements
uploads/                    # local file storage (gitignored)
```

### Data model (Prisma)

```
User 1─* Project 1─* ProjectFile
                  1─* Component 1─* Pin 1─1 Connection *─1 Net
                  1─* Net
                  1─* BomItem *─* Component
                  1─* DocumentChunk
```

- A **Pin** connects to exactly one **Net** (enforced by a unique `pinId` on
  `Connection`); a **Net** has many connections.
- A **BomItem** can reference one or more **Components** (many-to-many).
- **DocumentChunk** stores chunked text + an optional embedding for future RAG.
- No enums and no SQLite-only types → moving to PostgreSQL is a two-line change
  (`provider` + `DATABASE_URL`).

### Extension seams (how to make this real later)

- **Replace mock parsers:** implement the bodies of `src/parsers/*` — the return
  types and `dispatchParse()` router already match what the pipeline expects.
- **Plug in an LLM:** swap `lib/ai/canned-assistant.ts` for a real agent runtime;
  the future tool names (`search_component`, `search_net`,
  `get_connected_components`, …) are already defined.
- **Add graph visualization:** `connectivity-service.ts` already produces a
  `ConnectivityGraph`; render it with React Flow in the Connectivity tab.

---

## Testing

```bash
npm test
```

Unit tests cover the pure, high-value logic: file-type detection, Zod
validation + size/type gating, byte formatting, parser interface shapes, the
connectivity graph transforms, and the canned-assistant routing. Tests use mock
data only.

---

## Security notes (Phase 1)

- Uploaded files are validated by **type and size** (25 MB) via Zod before any
  disk write.
- User filenames are **never trusted**: files are stored under a server-generated
  UUID name, isolated in a per-project subdirectory.
- `resolveStoredPath` guards against **path traversal** outside the uploads root.
- No secrets in code; `.env` holds only safe local defaults.
- Sample/mock data only — no proprietary or confidential data.

---

## Roadmap (future phases)

- [ ] **Altium netlist parser** — real Protel `.NET` parsing → Components / Nets / Pins / Connections
- [ ] **BOM parser** — CSV/XLSX parsing, header normalization, refdes expansion, component matching
- [ ] **PDF parsing & RAG** — text extraction, chunking, embeddings, retrieval over datasheets/requirements
- [ ] **Connectivity graph** — interactive React Flow visualization
- [ ] **AI assistant tools** — LLM-backed agent with `search_component` / `search_net` / `get_connected_components` / `match_bom_rows` / `find_datasheets`
- [ ] **Design-review report generator** — automated risk flags for human review

```

```
