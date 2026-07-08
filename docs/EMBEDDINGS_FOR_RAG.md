# Embeddings for RAG

**Date:**   2026-07-06 (Lance + phx) · revised 2026-07-07 (re-verified against code; work items reordered for data quality, W5 added, §5 CPL item confirmed fixed) · revised 2026-07-07 again (W6 AND-relaxation added; W1 gains a production feedback loop; W3 must test precision, not just recall)
**Status:** Reference + backlog. Checked items were implemented 2026-07-07
(W2/W5/W6/W1/W3, C1/C2 — gated by `retrieval-eval.db.test.ts`); W1's synonym
table now grows from the `RetrievalLog` miss log.

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

### Work items (priority order — remove the codified failure first, then broaden recall)

- [x] **W2 — Honest empty results. Do this first.** The false negative is
      currently *codified*, not accidental: `search_documents` returns
      `{results: [], count: 0}` on a vocabulary miss, and prompt rule H
      tells the model "absence of a document is an answer". Fix both
      halves: (a) the empty-result branch in `board-tools.ts` returns a
      hint — "no keyword match; the document may use different wording —
      retry with synonyms/related terms before concluding absence"; (b)
      rule H splits "searched with multiple phrasings and absent" from
      "search may have missed the wording". The tool-side half
      automatically grounds the design-review loop too — it shares
      `boardTools`.
- [x] **W5 — Porter stemming in the FTS index.** `document_chunks_fts` is
      created with FTS5's default unicode61 tokenizer — no stemming, so
      "current limiting" never matches "current limit". Add
      `tokenize = 'porter unicode61'` to the CREATE VIRTUAL TABLE in
      `lib/fts.ts`. Gotcha: `ensureFtsSchema`'s shape check only looks for
      `content='DocumentChunk'`, so an existing table would be kept as-is —
      extend the check to also require the tokenize clause so pre-stemming
      tables drop and rebuild (the rebuild path already exists and is
      cheap). Stemming does not alter part-number tokens (LM317, MAX232).
- [x] **W6 — Relax AND-only conjunction.** `escapeFtsQuery` joins quoted
      terms with spaces — implicit AND in FTS5 — so "maximum current
      limit" fails against a chunk that says "current limit is 500mA"
      purely because "maximum" is absent. Any qualifier word
      (typical/maximum/absolute/recommended) breaks the whole match; this
      is the same class of codified false negative as W2, at the
      query-composition level, and neither stemming nor synonyms touches
      it. Fix: **AND first, OR-with-BM25 fallback on zero hits** inside
      `searchDocuments` — preserves today's precision when strict search
      works, relaxes only when it would otherwise return the dangerous
      empty result, and BM25 already ranks multi-term matches to the top
      under LIMIT 5. Composes with W2: the empty hint then honestly means
      "strict and relaxed search both found nothing". Do NOT implement the
      drop-qualifier-words variant: qualifiers are semantically
      load-bearing in datasheets (max vs typical are different numbers —
      the distinction rules C and G protect), and OR-ranking gets the same
      recall without a stopword list to maintain.
- [x] **W1 — Synonym retry inside `search_documents`.** Static domain
      table, zero API calls: current limit / OCP / overcurrent,
      quiescent / IQ, UVLO / undervoltage lockout, RDS(on) / on-resistance…
      Demoted below W2: the model already knows these synonyms — what it
      lacks is permission to retry. Still worth having: it fixes recall in
      one tool round instead of several. **Seed the table from production,
      not guesswork:** once W2 ships, log zero-hit queries (and the
      rephrasing that eventually succeeded, if any) locally in the
      `search_documents` executor — those retry moments are a live list of
      real vocabulary gaps. Recurring misses also feed W3's eval set.
- [x] **W3 — Retrieval eval set.** ~20 question-to-expected-chunk pairs
      from real ingested datasheets, run as a vitest suite. Must include
      the false-negative cases W2/W5/W6/W1 target so they cannot regress,
      **and at least one precision case** — a query that should NOT match
      a given chunk — so W5's stemming gate tests both directions (porter
      collides ordinary words, e.g. universal/universe → "univers";
      part numbers are safe since unicode61 tokenizes before porter runs,
      and BM25 + LIMIT 5 bounds the damage, but a recall-only suite would
      wave the change through blind). Gates every retrieval change and
      decides when W4 is justified. Grow it from W1's production miss log.
- [ ] **W4 — Local embeddings (only when W3 says keyword search stalled).**
      Small on-device model (ONNX MiniLM / bge-small) for hybrid
      FTS + vector retrieval. No hosted embedding APIs — that would be the
      first non-Anthropic data dependency and needs its own settings gate.
      (Anthropic has no embeddings endpoint, so local is the only option
      consistent with that rule anyway.) Notes for when it lands: the
      existing 1000-char page-scoped chunks are already embedding-sized,
      so ingestion barely changes; `sqlite-vec` keeps vectors in the same
      SQLite file; fuse FTS and vector rankings with RRF rather than
      picking one ranker. Page provenance (and therefore citations) is
      unchanged — retrieval strategy swaps under the same chunk store.

## 3. Token & cost efficiency

Subordinate to §2 per rule 2: never trade retrieval/grounding quality for
tokens. C1 is the exception — zero quality risk, can ship any time.

Verified against the code on 2026-07-06; C1 and C2 implemented 2026-07-07:

- [x] **C1 — Prompt caching (biggest win, zero quality risk).** Neither
      the assistant route nor the review loop sets `cache_control`. Both
      resend the same system prompt + tool schemas every round (review:
      up to 10 rounds per run; assistant: every turn). Caching them is
      roughly a 90% discount on those input tokens. Do this first.
- [x] **C2 — Cap assistant history.** The route forwards the client's
      entire `messages[]` unbounded; long chats grow cost linearly. Keep
      the last ~12 turns server-side. With C1 in place, history becomes
      the dominant uncached cost. Nuance: a *sliding* window changes the
      message prefix every turn, so the history portion of C1's cache
      invalidates each slide (tools + system stay cached — the bulk of
      the win). Fine to ship as-is; if history cost dominates later,
      switch to summarize-and-pin rather than sliding.
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
- ~~**CPL miscategorization**~~ **Fixed** (verified 2026-07-07):
  `fileTypes.ts` routes pick-and-place-named `.csv`/`.xlsx` to "other" via
  `PICK_AND_PLACE_NAME_RE` (audit #3), and `bomParser` rejects them by
  content as a second line of defense.
- **Layout parse is invisible**: surface the sync's returned `layout`
  summary in the banner; optionally a synthetic read-only "Board layout"
  row in the Files tab sourced from the `Board` table. Do NOT fake a
  `ProjectFile` row — the storage layer owns and deletes those paths.
- **Dev-mode key gap**: the Settings key saves to the Electron keychain
  but `next dev` only reads `.env` — add a dev-mode hint in Settings.
