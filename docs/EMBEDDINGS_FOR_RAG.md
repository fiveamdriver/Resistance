# Embeddings for RAG

**Date:**   2026-07-06 (Lance + phx)
**Status:** Reference + backlog. Nothing below is implemented unless marked.

Two non-negotiables, in priority order:

1. **No hallucinations.** Every board/part fact the AI states must be
   traceable to parsed data or an ingested document.
2. **Token efficiency.** Lowest possible API cost per question and per
   review — but never bought with a quality loss. Cheaper models or shorter
   context are only acceptable where measurement shows no regression.

---

## 1. How the AI is grounded today (works — protect it)

Two channels, routed by data shape:

| Data                     | Channel                              | Risk     |
| ------------------------ | ------------------------------------ | -------- |
| Netlist, BOM, layout     | Parsed to SQLite, answered by tools  | ~none    |
| Datasheet headline specs | Extracted once at ingest to MpnCache | low      |
| Datasheet/document prose | FTS5 keyword search (the RAG layer)  | see §2   |
| Parts not on file        | Forbidden — must answer not-on-file  | policy   |

Safeguards to preserve through any refactor:

- **Grounding contract** in the assistant system prompt (rules A–I):
  provenance required, no model memory for parts, layout facts only from
  the layout tools.
- **Datasheet verification gate**: fetched PDFs must pass magic-bytes,
  size-cap, and MPN-in-first-pages checks before ingest; failures quarantine.
- **Local-only retrieval.** FTS5 in SQLite; no embedding service, no
  non-Anthropic AI dependency. This is a privacy/desktop feature, not
  an accident.

## 2. The retrieval gap — why embeddings are on the roadmap

FTS5 is keyword-only. The dangerous failure is not a wrong answer (the
grounding contract blocks those) — it is a **confident false negative**:

> Datasheet says "overcurrent protection threshold". User asks for the
> "current limit". FTS matches nothing, the assistant answers "not on
> file", and the user now believes information that exists does not.
> Indistinguishable from the truth, so it silently erodes trust.

Secondary effects:

- Conceptual questions ("any thermal concerns on this board?") cannot be
  answered from prose at all — no keyword to match.
- Design review grounds only on pre-extracted ratings, not on full
  datasheet guidance (layout recommendations, soft-start, minimum load).

### Work items (cheapest first)

- [ ] **W1 — Synonym retry inside `search_documents`.** The tool (not the
      model) expands a missed query with domain synonyms: current limit /
      OCP / overcurrent, quiescent / IQ, etc. Static table, zero API calls.
- [ ] **W2 — Honest empty results.** On zero hits the tool result should
      say "no keyword match — content may exist under different wording"
      so the model retries with new terms instead of concluding absence.
      Prompt rule H should split "searched and absent" from "search missed".
- [ ] **W3 — Retrieval eval set.** ~20 question-to-expected-chunk pairs
      from real ingested datasheets, run as a vitest suite. Gates every
      retrieval change and decides when W4 is justified.
- [ ] **W4 — Local embeddings (only when W3 says keyword search stalled).**
      Small on-device model (ONNX MiniLM / bge-small) for hybrid
      FTS + vector retrieval. No hosted embedding APIs — that would be the
      first non-Anthropic data dependency and needs its own settings gate.

## 3. Token & cost efficiency

Verified against the code on 2026-07-06 — none implemented yet:

- [ ] **C1 — Prompt caching (biggest win, zero quality risk).** Neither
      the assistant route nor the review loop sets `cache_control`. Both
      resend the same system prompt + tool schemas every round (review:
      up to 10 rounds per run; assistant: every turn). Caching them is
      roughly a 90% discount on those input tokens. Do this first.
- [ ] **C2 — Cap assistant history.** The route forwards the client's
      entire `messages[]` unbounded; long chats grow cost linearly. Keep
      the last ~12 turns server-side. With C1 in place, history becomes
      the dominant uncached cost.
- [ ] **C3 — Model tiering for enrichment.** `datasheet-service` runs
      `claude-sonnet-4-6` + web search per MPN. Spec extraction from a
      found datasheet is a Haiku-class task; keep URL selection on Sonnet.
      Measure on known MPNs before switching (rule 2 above).
- [ ] **C4 — Parallelize enrichment (latency, not tokens).** The per-MPN
      loop is sequential; first review on a 13-MPN board takes 5–10 min.
      Use bounded concurrency (~4). Also fix the review progress copy:
      "up to a minute" → real phase progress ("fetching datasheets 4/13").
- [ ] **C5 — Tool-result size audit.** Confirm `list_components`,
      `get_board_topology`, and `search_documents` outputs stay bounded on
      large boards (truncated chunks, top-N plus counts) so one tool round
      cannot blow up the context.

Already cost-sane (do not redo): MpnCache + DatasheetLibrary make
enrichment one-time per part globally; re-reviews skip fetching; output
ceilings are 1500 tokens (assistant) / 4096 (review).

## 4. Explicitly not doing

- Hosted embedding APIs (OpenAI, Voyage, ...) — see W4.
- RAG over raw `.kicad_pcb` / netlist text — structured tools already
  answer layout and connectivity exactly; coordinate soup in FTS adds noise.
- Cheaper model for the review loop itself — findings quality is the
  product; revisit only with an eval harness proving parity.

## 5. Related backlog from this session (not retrieval — do not lose)

- **Sticky folder imports**: remember `project_folder` selections and
  re-import on mtime change at sync; dialog defaults — pre-check top-level
  PDFs, uncheck `gerber/`, `production_files/`, `*-backups/`.
- **CPL miscategorization**: `CPL-*` pick-and-place CSVs are ingested as
  BOMs and pollute `BomItem` rows. Fix `fileTypes.ts` categorization.
- **Layout parse is invisible**: surface the sync's returned `layout`
  summary in the banner; optionally a synthetic read-only "Board layout"
  row in the Files tab sourced from the `Board` table. Do NOT fake a
  `ProjectFile` row — the storage layer owns and deletes those paths.
- **Dev-mode key gap**: the Settings key saves to the Electron keychain
  but `next dev` only reads `.env` — add a dev-mode hint in Settings.
