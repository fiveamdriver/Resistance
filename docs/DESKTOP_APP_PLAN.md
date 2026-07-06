# Resistance Desktop App — Plan

Status: **proposed 2026-07-05** (not started). Follows from the KiCad sync
provenance work (`kicad_sync` files + `syncMeta` staleness display) and sets
up the in-app KiCad folder-link/import flow, which depends on Phases 1–2
here for the native folder picker.

## Why this adds value to Resistance

Resistance's promise is that an engineer's design data, documentation, and
AI review live in one place with zero ceremony. Today the ceremony is real:
run a dev server, open a browser tab, and drive KiCad sync through an
external AI agent (the kicad-mcp server is currently the *only* sync path).
The target experience is: open an application, link a KiCad project folder,
and everything else follows.

The codebase is closer to this than a typical web app. It is already a
local application that happens to render in a browser: SQLite on disk
(`DATABASE_URL`), local file storage (`UPLOADS_DIR`, `src/lib/storage.ts`),
and the assumption that KiCad projects live on the same machine. Both paths
are env-configurable, which is most of the relocation battle already won.

## Approach: Electron wrapping the existing Next server

An Electron shell boots the existing Next.js server on a local port and
opens a window on it. Zero rewrite; the web dev workflow (`npm run dev` in
a browser) stays untouched.

Alternatives considered:

- **Tauri** — smaller binaries and a better security posture, but its
  native model assumes a static frontend; a server-full Next app (API
  routes, server components, Prisma) must run as a Node sidecar, which
  adds packaging complexity for no v1 benefit. Revisit if bundle size
  becomes a complaint.
- **Static export + native backend** — a rewrite, not a wrap. No.

## Phase 1 — Electron shell that runs the real app

The risk-retiring milestone: the packaged app boots, migrates, and serves
the real product from per-user paths.

1. **`electron/` main process** (own tsconfig, outside Next's compilation).
   On launch, derive per-user paths from `app.getPath("userData")` and set
   `DATABASE_URL=file:<userData>/resistance.db` and
   `UPLOADS_DIR=<userData>/uploads` before booting the server. The storage
   layer needs no changes — it already reads these envs.
2. **Next `output: "standalone"`** so production builds emit a
   self-contained `server.js` the main process spawns on an ephemeral
   localhost port, opening a `BrowserWindow` once it responds.
   **The local server must be authenticated from day one.** The API has no
   auth today; a localhost listener without it lets any local process — or
   a malicious webpage fetching `localhost:<port>` — read board data,
   upload files, or burn the user's Anthropic key. The main process
   generates a random token per boot, injects it into the window
   (preload), and middleware rejects any request not bearing it.
   Retrofitting auth after routes ship open is far more expensive than
   designing it into the boot sequence now.
3. **Baseline and adopt real Prisma migrations.** Today the workflow is
   `db:push` and `prisma/migrations/` holds a single hand-written FTS
   migration with no init baseline and no `migration_lock.toml`. Before
   anything ships: generate a baseline init migration, add the lock file,
   and switch the workflow to `prisma migrate dev` / `migrate deploy`.
4. **Backup before every migration — non-negotiable.** `migrate deploy`
   can fail mid-migration and leave `_prisma_migrations` in a failed state
   that blocks every subsequent launch. Before running migrations the main
   process copies `resistance.db` (plus `-wal`/`-shm` if present, before
   the server has opened the DB) to a timestamped backup, retaining the
   last ~5. On migration failure: surface a real error UI with a restore
   path, never a silent crash loop. The FTS5 index is derived state
   rebuilt at startup (`src/lib/fts.ts`), so backups and migrations never
   need to preserve it.
5. **Downgrade protection.** electron-updater has no rollback, so a user
   who reverts to an older app after a forward migration hits undefined
   runtime behavior. Store the app's schema version in the DB; on open,
   an older app seeing a newer schema refuses with a clear message
   pointing at the pre-migration backup, instead of failing confusingly.
6. **API key decision — blocker, and product, not just engineering.**
   `ANTHROPIC_API_KEY` currently comes from the developer's shell
   environment (it is not even in `.env`). A packaged app has no shell
   environment, so the assistant (`assistant/route.ts`), AI review
   (`review-service.ts`), and datasheet auto-ingestion
   (`datasheet-service.ts`) — the product's core — are all dead on first
   launch until this is answered:
   - **Bring-your-own-key**: each user supplies an Anthropic key. Cheapest
     to build; the user's own Anthropic agreement governs their data.
     Requires a settings UI and secure storage — Electron `safeStorage`
     (OS-keychain-backed), never plaintext in userData.
   - **Proxy backend**: Resistance operates (and pays for) an API proxy.
     A business model decision — billing, quotas, and a server to run.
   v1 recommendation: BYOK, with the proxy revisited if Resistance sells
   to teams. Either way, fix `assistant/route.ts` constructing the
   Anthropic client at module load with a possibly-undefined key, and
   replace "set ANTHROPIC_API_KEY in your environment" errors with a
   pointer to the settings UI.
7. **Dev mode**: `npm run dev:desktop` = Electron window pointed at the
   existing `next dev` server.

Also in Phase 1, on the calendar not the code: **start Apple Developer
Program enrollment** (see Phase 3 — it has lead time, and nothing built in
Phases 1–2 may be given to anyone outside the founding team until signing
lands, or Gatekeeper blocks it).

## Phase 2 — Make it feel like an application

- Native app menu, dock icon, single-instance lock, remembered window
  size/position; external links open in the system browser.
- Minimal IPC bridge (contextIsolation on, small preload) exposing native
  dialogs — this unlocks the real folder picker the KiCad folder-link
  feature needs.
- Settings surface: API key entry (per Phase 1 decision), `kicad-cli`
  detection (in-app sync shells out to it), and the data-sharing controls
  from the Compliance section below.
  `kicad-cli` detection cannot be a naive `which`: macOS apps launched
  from the Dock/Finder inherit a minimal PATH without Homebrew or
  `/Applications/KiCad/.../bin`, so the lookup must probe well-known
  install locations per platform and offer a manual path override in
  settings. (Same caveat applies to anything else the app spawns.)

## Phase 3 — Packaging, distribution, updates

- **electron-builder**; macOS `.dmg` first, Windows/Linux later.
- The known sharp edge is **Prisma inside Electron**: query-engine native
  binaries must be `asarUnpack`ed and the right binary targets bundled per
  platform. Well-trodden, but this is where the packaging time goes. (No
  `better-sqlite3` anywhere — Prisma bundles its own engine — so that
  classic native-module rebuild pain does not apply.)
- macOS code-signing + notarization (Apple Developer ID from the Phase 1
  enrollment), then **auto-update** via electron-updater against GitHub
  Releases. electron-updater verifies checksums and handles partial
  downloads; the real update hazard is data, not bits — an update that
  migrates the DB followed by a user downgrade — and the Phase 1
  backup-before-migrate + downgrade-refusal machinery is the fix. Ship
  updates as: download → verify → back up DB → swap → migrate on next
  launch.
- **Crash reporting, opt-in only**: Sentry (or equivalent) across main,
  renderer, and the server child process. Without it a desktop app with
  real users is flying blind on bugs; with it silently, it is a privacy
  violation. Off by default, one-line disclosure, toggle in settings.
- **License audit checklist** before the first public release: current
  `dependencies` are all permissive (MIT/BSD-2/Apache-2.0/ISC — Next,
  React, Prisma, @anthropic-ai/sdk, mammoth, pdf-parse, papaparse, zod,
  Radix, xyflow, lucide, CVA); Electron is MIT. Verify
  `@paper-design/shaders-react` (license not confirmed). Ship the
  third-party attribution bundle electron-builder generates. `kicad-cli`
  is invoked as a user-installed external binary and never distributed,
  so KiCad's GPL does not attach to Resistance.

## Phase 4 — The payoff features

With the shell in place: "Link KiCad project folder" with a native picker,
inclusive checkbox-scan import (fresh `kicad-cli` netlist/BOM exports
default-checked with `kicad_sync` provenance; loose folder docs under a
new `project_folder` provenance), then a file watcher for auto-sync. The
kicad-mcp Python server stays exactly as it is — the external-agent front
door — and is not bundled into the app.

## Compliance & data handling

This section is a **distribution blocker**, not polish: PCB designs are
routinely confidential company IP, and board data demonstrably leaves the
machine today.

What leaves the machine, as implemented now:

- **AI review** (`review-service.ts`) and the **assistant**
  (`assistant/route.ts` + `board-tools.ts`): netlist, BOM, component, and
  net data are sent to the Anthropic API as tool results and conversation
  context.
- **Datasheet enrichment** (`datasheet-service.ts`): MPN lists are sent to
  the Anthropic API, which performs hosted web searches for them.
- **Datasheet ingestion** (`ingest-service.ts`): the app fetches datasheet
  URLs directly from third-party sites (MPNs leak via URLs and User-Agent
  to manufacturers/distributors).

Required before any user outside the founding team:

1. A short, plain-language **data-handling disclosure** in the app: what
   is sent, to whom, when, and what never leaves the machine.
2. **Per-tier off switches** in settings: AI features entirely off (app
   still works as a local design-data organizer), datasheet web-fetch off,
   crash reporting off (default).
3. **Research item, do not guess**: Anthropic API data-retention and
   usage terms as they apply to customers with export-controlled or
   ITAR-adjacent designs — whether commercial terms / zero-data-retention
   options cover this, and what Resistance must state about it. BYOK
   shifts the agreement to the user's own Anthropic account, which helps,
   but the disclosure still has to be accurate.

## Explicit scope decisions

- **Single-user, local SQLite is the v1 product** — a deliberate decision,
  not an accident of the desktop architecture. Teams sharing projects have
  no story in this plan; that would be a hosted/sync backend project.
  Recorded so it is revisited on purpose. One correction to the schema's
  own claim of Postgres portability ("no SQLite-only features"): the FTS5
  index is SQLite-only. It lives outside the Prisma schema as derived
  state, so the seam is contained (`src/lib/fts.ts` swaps for `tsvector`),
  but a team version is a backend project, not a config change.
- **Staying on SQLite**: right call for a desktop app; the "Postgres
  later" note in `.env` applies only to a future hosted version.

## Sequencing

**Step zero, before committing to Phase 1's estimate: a half-day
throwaway spike.** Boot this repo's standalone Next build inside a bare
Electron shell and run one Prisma query against a DB in `userData`. The
plan asserts Next 15 + React 19 + Prisma 6 + Electron compose cleanly —
they generally do, but it has not been proven on this codebase, and the
spike is the cheapest way to find out whether "days, not weeks" is
honest.

Phase 1 retires the technical risk (standalone Next + Prisma migration
machinery + local API auth + key storage; days if the spike is clean).
Phase 2 is quick wins. Phase 3 is grind, not risk (signing bureaucracy +
the Prisma-asar dance + the compliance disclosure, which can be drafted
any time and should be drafted early). Phase 4 is a separate feature
track that depends on Phases 1–2.

One decision deadline: the BYOK-vs-proxy call (Phase 1, item 6) must be
made before Phase 2 starts — the settings surface and the compliance
disclosure both change shape depending on the answer.
