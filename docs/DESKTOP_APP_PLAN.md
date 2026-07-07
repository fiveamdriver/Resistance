# Resistance Desktop App — Plan

Proposed 2026-07-05. Follows from the KiCad sync provenance work
(`kicad_sync` files + `syncMeta` staleness display).

## Status

| Phase | State |
| --- | --- |
| 1 — Electron shell | **Done** 2026-07-05 (`47c89ad`) |
| 2 — Native app feel + settings | **Done** 2026-07-06 (`0b09c88`) |
| 3 — Packaging, distribution, updates | Not started |
| 4 — KiCad folder link / import / auto-sync | **Done** 2026-07-06 (`9affc08`) |

Still open:

- **Apple Developer Program enrollment** (Lance; individual, $99/yr) —
  gates Phase 3 signing/notarization, and with it giving the app to
  anyone outside the founding team. Everything else in Phase 3 can be
  built and tested locally without it.
- **Compliance item 3** (below): research Anthropic API data-retention
  terms; the in-app disclosure and off switches (items 1–2) shipped in
  Phase 2.
- **One untested flow**: key-set → backend-restart, end-to-end (needs a
  real key typed into the settings UI).

## Why this adds value to Resistance

Resistance's promise is that an engineer's design data, documentation, and
AI review live in one place with zero ceremony. Before this plan the
ceremony was real: run a dev server, open a browser tab, and drive KiCad
sync through an external AI agent (the kicad-mcp server was the *only*
sync path). The target experience — open an application, link a KiCad
project folder, and everything else follows — is delivered as of Phase 4.

The codebase was closer to this than a typical web app. It was already a
local application that happened to render in a browser: SQLite on disk
(`DATABASE_URL`), local file storage (`UPLOADS_DIR`, `src/lib/storage.ts`),
and the assumption that KiCad projects live on the same machine. Both paths
are env-configurable, which was most of the relocation battle already won.

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

## Phase 1 — Electron shell that runs the real app ✅ 2026-07-05

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
3. **Baseline and adopt real Prisma migrations.** The old workflow was
   `db:push` with a single hand-written FTS migration, no init baseline,
   no `migration_lock.toml`. Before anything ships: generate a baseline
   init migration, add the lock file, and switch to `prisma migrate dev` /
   `migrate deploy`.
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
   runtime behavior. An older app opening a newer DB must refuse with a
   clear message pointing at the pre-migration backup.
6. **API key decision — blocker, and product, not just engineering.**
   A packaged app has no shell environment, so the assistant, AI review,
   and datasheet auto-ingestion are dead on first launch until this is
   answered: **bring-your-own-key** (user's own Anthropic agreement
   governs their data; needs a settings UI + `safeStorage`) vs. a **proxy
   backend** (a business model decision — billing, quotas, a server to
   run). **Decided: BYOK for v1**, proxy revisited if Resistance sells to
   teams (2026-07-06 discussion: likely hybrid — proxy default with BYOK
   kept as the advanced option — if/when conversion for strangers
   matters).
7. **Dev mode**: `npm run dev:desktop` = Electron window pointed at the
   existing `next dev` server.

**Outcome.** Shipped as specified after a clean half-day spike (see
Sequencing). Two later corrections from Phase 2's verification work:

- **Item 5 as first implemented was dead code** — Prisma 6's
  `migrate status` reports "up to date" even when the DB contains
  migrations the app doesn't know, so the regex guard never fired. Rewritten
  to compare the `_prisma_migrations` ledger against the local migrations
  directory (`electron/read-migrations.ts`); verified in both directions
  once a second migration existed.
- **Item 6's "point errors at settings" was only half done** — the server
  messages were right but the assistant UI discarded response bodies and
  showed "check the server logs". Fixed alongside Phase 2.

Apple Developer enrollment (the Phase 1 calendar item) was **not**
started — still the critical-path item for Phase 3.

## Phase 2 — Make it feel like an application ✅ 2026-07-06

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

**Outcome.** All of the above shipped: app menu with Settings (Cmd+,),
single-instance lock, window-state persistence, dock icon
(`scripts/make-icon.mjs` → `electron/assets/icon.png`),
`pickFile`/`pickFolder` IPC, and `/settings` (disclosure, AI +
datasheet-fetch switches enforced server-side via the new `AppSetting`
table, BYOK key entry, kicad-cli detection with manual override — the
probing immediately proved necessary: a standard `/Applications` KiCad
install is not on PATH). The second migration exercised
backup-before-migrate for real and exposed the Phase 1 downgrade-guard
bug (see Phase 1 outcome). safeStorage key roundtrip and the
single-instance lock verified directly. In-app the marketing hero is
skipped: desktop "/" redirects to `/projects` (middleware) and the logo
follows; the hero remains for the future website.

Known cosmetic dev-mode artifact: the menu bar / Dock label reads
"Electron" until Phase 3 produces a real `Resistance.app` bundle.

## Phase 3 — Packaging, distribution, updates *(not started)*

- **electron-builder**; macOS `.dmg` first, Windows/Linux later.
- The known sharp edge is **Prisma inside Electron**: query-engine native
  binaries must be `asarUnpack`ed and the right binary targets bundled per
  platform. Well-trodden, but this is where the packaging time goes. (No
  `better-sqlite3` anywhere — Prisma bundles its own engine — so that
  classic native-module rebuild pain does not apply.)
- macOS code-signing + notarization (Apple Developer ID — **enrollment
  still pending**), then **auto-update** via electron-updater against
  GitHub Releases. electron-updater verifies checksums and handles partial
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

Everything here except the signature itself is buildable and locally
testable before enrollment completes: an unsigned `.dmg` runs on the
build machine (Gatekeeper only bites third-party downloads), so the
electron-builder + Prisma-asar work, the app bundle (which also fixes the
"Electron" naming), and the license audit should not wait on Apple.

## Phase 4 — The payoff features ✅ 2026-07-06

With the shell in place: "Link KiCad project folder" with a native picker,
inclusive checkbox-scan import (fresh `kicad-cli` netlist/BOM exports
default-checked with `kicad_sync` provenance; loose folder docs under a
new `project_folder` provenance), then a file watcher for auto-sync. The
kicad-mcp Python server stays exactly as it is — the external-agent front
door — and is not bundled into the app.

**Outcome.** Shipped as the agreed EDA-adapter design:

- `src/server/eda/` — adapter interface; KiCad (kicad-cli) is the first
  adapter. A future Altium adapter returns no planned exports and relies
  on the document scan (manual-export tier; Altium has no kicad-cli
  equivalent).
- `folder-sync-service` — scan (categorized: recognized EDA project +
  planned exports / importable documents / everything else behind "show
  all"), import through the existing upload pipeline, and `syncNow`.
  Fresh exports supersede the previous sync's `kicad_sync` rows instead
  of piling up; import paths are traversal-checked against the linked
  root; syncMeta is stamped in the same shape the MCP server writes.
- `watcher-service` — opt-in per-project auto-sync: debounced (2s)
  `fs.watch` on the folder root, re-exports on design-file saves.
  Watchers are reconciled from the DB on first server use and on project
  updates. Reconciliation lives in `src/lib/prisma.ts` init, **not**
  `instrumentation.ts` — instrumentation is also compiled for the edge
  runtime (middleware exists), where the chain's `child_process` import
  cannot resolve.
- `kicad-folder-card.tsx` — link (native picker in the desktop shell,
  manual path in the browser), sync-now, categorized import dialog,
  auto-sync toggle, unlink.
- Schema: `Project.kicadProjectPath` + `Project.autoSyncEnabled`
  (migration `20260706200000_add_kicad_project_link`).

Verified end-to-end against `packages/kicad-mcp/tests/fixtures/hier`:
link → scan (traversal attempts rejected) → import (netlist parsed, BOM
linked, doc indexed, syncMeta stamped) → repeated sync-now supersede →
watcher fire on touch (root and subsheet) → watcher restore after server
restart.

## Compliance & data handling

This section is a **distribution blocker**, not polish: PCB designs are
routinely confidential company IP, and board data demonstrably leaves the
machine.

What leaves the machine, as implemented:

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

1. ✅ *(Phase 2)* A short, plain-language **data-handling disclosure** in
   the app: what is sent, to whom, when, and what never leaves the
   machine. Lives at the top of `/settings`.
2. ✅ *(Phase 2)* **Per-tier off switches** in settings, enforced
   server-side: AI features entirely off (app still works as a local
   design-data organizer) and datasheet web-fetch off. Crash-reporting-off
   (default) lands with crash reporting itself in Phase 3.
3. ⬜ **Research item, do not guess**: Anthropic API data-retention and
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

## Sequencing *(as planned — held up in practice)*

Step zero was a half-day throwaway spike (standalone Next + one Prisma
query inside a bare Electron shell) — it passed, and Phase 1 landed the
same day. Phase 2 was the predicted quick wins, plus one surprise the
plan explicitly hoped to catch: the downgrade guard could only be tested
once a second migration existed, and it was in fact broken. Phase 4 was
built directly on Phases 1–2 (folder picker, kicad-cli detection,
settings) without waiting for Phase 3, as designed. The BYOK-vs-proxy
decision deadline was met before Phase 2's settings surface was built.

Remaining sequence: Phase 3 is grind, not risk — signing bureaucracy
(blocked on enrollment) + the Prisma-asar dance (not blocked) + the
compliance research (not blocked, should be drafted early).
