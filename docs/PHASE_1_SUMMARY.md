# Phase 1 — Build Summary

**Project:** Resistance — AI-Powered Electrical Engineering Project Assistant
**Date:** 2026-06-11
**Status:** ✅ Complete — builds clean, all checks green, runtime-verified

---

## 1. What was built

Phase 1 delivers a production-quality **MVP foundation**: a Next.js + TypeScript
web app where engineers create projects, upload Altium-style exports
(netlists, BOMs, PDFs, docs), and browse them through a tabbed project
dashboard. The parsing, connectivity graph, and AI assistant are wired as clean
**placeholders** with stable interfaces so the real implementations can drop in
later without reshaping the codebase.

Starting point was an **empty directory**; everything below was created from
scratch.

---

## 2. Objectives delivered (original brief)

| # | Objective | Outcome |
|---|-----------|---------|
| 1 | Project setup (Next.js + TS + Tailwind + Prisma) | App Router project, hand-authored configs, SQLite for local dev |
| 2 | Core data model (9 Prisma models) | `User, Project, ProjectFile, Component, Net, Pin, Connection, BomItem, DocumentChunk` with indexes + constraints |
| 3 | MVP pages | Home, project list, create-project, project dashboard with 7 tabs |
| 4 | File upload | Local `/uploads`, per-project isolation, type + 25 MB size validation, parse-status tracking |
| 5 | Parser placeholders | `parseNetlist`, `parseBom`, `parsePdf`, `chunkDocument` (real chunker; others return typed mock data) |
| 6 | Connectivity types | `ComponentNode`, `NetNode`, `PinConnection`, `ConnectivityGraph` + pure query helpers |
| 7 | AI assistant placeholder | Chat UI with canned responses, no LLM; future tool names predefined |
| 8 | README | Full README + this summary + preserved engineering standards |

---

## 3. Quality bar (the 10 standards)

The mid-build brief raised the bar to "production-grade, senior-engineer
reviewable." How each was met:

1. **Architecture** — Strict layering: UI (`app/`, `components/`) → thin server
   actions → services (`server/services/*`, the *only* Prisma callers,
   `server-only`-guarded) → `lib/`, `parsers/`, `types/`. Verified no component
   or page queries Prisma directly.
2. **Type safety** — Strict TS, **zero `any`** (grep-verified). Zod validates
   every external input (form, REST body, upload metadata). Parser outputs are
   typed interfaces.
3. **Code quality** — 46 small modules (~2,460 LOC). Comments only explain
   tradeoffs/seams; future work marked with intentional `TODO(phase 2)`.
4. **Error handling** — Structured `AppError` / `ValidationError` /
   `NotFoundError`; `toUserError` returns user-safe messages and logs unexpected
   errors server-side. UI shows empty / loading / error states
   (`error.tsx`, `not-found.tsx`, `loading.tsx`). Uploads report per-file
   success/failure.
5. **Security** — Type + size gate before any disk write; user filenames never
   trusted (server-generated UUID names); per-project directory isolation;
   path-traversal guard in `resolveStoredPath`; no secrets in code; mock data
   only.
6. **Data modeling** — Indexed relations and unique constraints; a `Connection`
   join enforces "a pin connects to one net / a net has many"; BOM↔Component
   many-to-many; RAG-ready `DocumentChunk`. No enums or SQLite-only types →
   PostgreSQL is a two-line change.
7. **Testing** — Vitest suite (33 tests) over file-type detection, validation +
   size/type gating, byte formatting, parser interface shapes, graph transforms,
   and assistant routing. Mock data only; `npm test`.
8. **Developer experience** — ESLint + Prettier, clear npm scripts
   (`setup`, `db:*`, `test`, `typecheck`, `format`), seed data, documented `.env`.
9. **UI quality** — Clean Tailwind, consistent spacing, empty/loading/error
   states throughout, deliberately not over-designed.
10. **Maintainability** — Documented extension seams: replace mock parser
    bodies; swap the canned assistant for an LLM (tool names predefined); render
    the existing `ConnectivityGraph` with React Flow.

---

## 4. Architecture & file map

```
src/
  app/                       # Next.js routes — thin UI + server actions only
    page.tsx                 #   Home
    projects/                #   List, create (server action), dashboard
      actions.ts             #   createProjectAction
      new/page.tsx           #   Create form
      [projectId]/           #   Dashboard + actions + loading/error/not-found
    api/projects/route.ts    #   REST surface (JSON) for future clients
  components/
    dashboard/               #   Tabs, upload, tables, connectivity, AI chat, reports
    projects/                #   New-project form (client)
    ui/                      #   EmptyState, ParseStatusBadge
  server/services/           # Business logic — ONLY place that queries Prisma
    project-service.ts
    file-service.ts          #   validate → store → record upload pipeline
    connectivity-service.ts  #   builds ConnectivityGraph from the DB
  lib/
    prisma.ts, storage.ts    #   data access + local file storage (traversal-guarded)
    fileTypes.ts, validation.ts (Zod), errors.ts, format.ts
    ai/canned-assistant.ts   #   placeholder routing, no LLM
  parsers/                   # parseNetlist / parseBom / parsePdf / chunkDocument + dispatch
  types/connectivity.ts      # graph types + buildGraph / netsForComponent / componentsForNet
prisma/                      # schema.prisma + seed.ts
sample-files/                # mock netlist / BOM / requirements
docs/                        # ENGINEERING_STANDARDS.md + this summary
uploads/                     # local file storage (gitignored)
```

### Data model

```
User 1─* Project 1─* ProjectFile
                  1─* Component 1─* Pin 1─1 Connection *─1 Net
                  1─* Net
                  1─* BomItem *─* Component
                  1─* DocumentChunk
```

---

## 5. Verification performed

All run against the actual built/running app, not assumed:

| Check | Result |
|-------|--------|
| `npm run build` | ✓ Compiled, 6 routes (static + dynamic) |
| `npm test` | ✓ 33/33 passing |
| `npm run typecheck` | ✓ no errors |
| `npm run lint` | ✓ no warnings/errors |
| `npm run format:check` | ✓ Prettier-clean |
| Pages (`/`, `/projects`, `/projects/new`, dashboard) | ✓ HTTP 200 |
| `GET /api/projects` | ✓ returns seeded project |
| `POST /api/projects` (valid) | ✓ 201 created |
| `POST /api/projects` (invalid) | ✓ 400 with structured field errors |
| Missing project | ✓ renders not-found boundary |

### Bugs found and fixed during verification

1. **Zod schema ordering bug** — `description` used `.optional().or(empty)`,
   which let a blank `""` pass as a valid string instead of normalizing to
   `undefined`. Caught by a unit test; fixed with `.optional().transform()`.
2. **Layering violation** — the projects list page queried Prisma directly
   instead of via `listProjects()`. Caught by a grep in the final pass; routed
   through the service.
3. **Type errors** — `fieldErrors` typed too strictly (`Record<string,
   string[]>` vs Zod's `string[] | undefined`); fixed across `errors.ts` and the
   action state.

---

## 6. Known caveats (intentional for Phase 1)

- The missing-project route renders the correct not-found UI but returns HTTP
  **200**, not 404 — standard Next.js streaming-SSR behavior for `force-dynamic`
  routes. UX is correct.
- `.xlsx` / `.docx` / `.pdf` parsers return **mock data** by design; no parsing
  libraries are pulled in yet.
- No authentication yet — `Project.ownerId` is nullable and unused.
- `npm install` ran behind a script-approval wrapper; build-critical install
  scripts (esbuild, Prisma engines, sharp) were approved and pinned in
  `package.json` under `allowScripts`.

---

## 7. How to run

```bash
npm install      # installs deps + generates Prisma client
npm run setup    # prisma generate + db push + seed "Demo Power Board"
npm run dev      # http://localhost:3000
```

---

## 8. Suggested next steps (Phase 2)

1. Real Altium Protel `.NET` parser → populate Components / Nets / Pins / Connections.
2. CSV/XLSX BOM parser with header normalization + refdes expansion + component matching.
3. PDF text extraction + embeddings + retrieval (RAG) over datasheets/requirements.
4. React Flow connectivity graph visualization (data layer already exists).
5. LLM-backed AI agent implementing the predefined tools.
6. Design-review report generator (risk flags for human review).
```
