# Automatic Datasheet Ingestion — Plan

Status: proposal, not implemented. Follows from the KiCad MCP server work
(`packages/kicad-mcp/PLAN.md`) and the existing MPN spec-fetch pipeline
(`src/server/services/datasheet-service.ts`).

## Why this adds value to Resistance

Resistance's core promise is an assistant that answers from the engineer's
*actual design* and the *actual documentation for its parts* — not from
general knowledge. Today the two halves are unevenly automated:

- **Design data is automatic.** The KiCad MCP server syncs parts, nets, and
  BOM with zero manual effort, and stays fresh.
- **Datasheet depth is manual.** Full-text document search (FTS5) only
  contains PDFs a human remembered to upload. On a 30-part board with 3
  uploaded datasheets, the assistant can ground deep answers for exactly 3
  parts and comes up empty for the other 27.

The gap is expensive in a specific way: the system *already* visits each
part's datasheet online (the spec-fetch job reads it to extract ~5 rating
numbers into `MpnCache`) and then discards the document. We pay the cost of
finding and reading the datasheet, and keep almost none of the value.

Closing the gap means:

1. **Every part on every board becomes deeply answerable.** Questions like
   "what does the datasheet say about layout recommendations for U3?" work
   for all parts, not just the ones with hand-uploaded PDFs.
2. **Compliance findings get stronger grounding.** Findings can cite the
   document on file, with page numbers, instead of a 5-number summary.
3. **Cost scales with the parts catalog, not with usage.** One fetch per
   part number *ever, across all projects* (see library model below). After
   ingestion, every question is a local FTS5 search — no per-question
   web/token cost, no latency.
4. **The assistant fails less often in front of users.** Today the honest
   answer to most datasheet questions is "no document found." A self-filling
   shelf converts the most common dead-end in the product into a working
   answer — without ever substituting a guess for a document.
5. **Coverage becomes measurable.** A visible "datasheet coverage: 27/30
   parts" metric per project turns documentation completeness into something
   the product can drive toward, instead of an invisible gap.

The result: the shelf fills itself, once per part ever, shared by all
projects — and everything on it can be trusted. The assistant stops running
out of material, without ever making things up to fill the silence.

## Anti-hallucination model (hard requirement)

Goal: the assistant must never present datasheet-derived claims that don't
come from a verified document on file. "Hedging" on uncertain sources is not
sufficient — uncertain documents must be blocked at ingestion, and missing
information must surface as *missing*, never filled in. Four enforcement
layers, ordered from ingestion to answer:

### 1. Provenance tiers (what gets in, and how it's ranked)

Every ingested document carries a **provenance** level. Higher trust always
outranks lower when both exist for the same MPN:

| Tier | Source | Trust | Why |
|---|---|---|---|
| 1 | Human upload (existing flow) | verified | A person chose this exact file |
| 2 | Datasheet URL from the design's symbol properties | engineer-linked | The engineer pasted this link when placing the part |
| 3 | Auto-download during spec fetch (web search) | machine-found | Best-effort match by part number |

### 2. Verification gate (nothing unverified is ever indexed)

Auto-fetched documents (tiers 2–3) pass a gate before indexing; failures are
stored but **quarantined — never indexed into FTS5, never searchable**:

- Content check: extracted text must contain the MPN (or its normalized base
  part number — strip packaging suffixes) within the first pages. A download
  that doesn't mention the part it was fetched for is the wrong document.
- Format check: content-type and PDF magic bytes, size cap (25 MB), page
  cap. Distributor summary pages and marketing one-pagers routinely
  masquerade as datasheets; a minimum-text-length check filters image-only
  scans that extract to garbage.
- Extraction-quality check: if text extraction yields mostly non-words
  (garbled tables/OCR noise), quarantine rather than index — garbled text
  quoted confidently is a hallucination with a citation.
- Quarantined files appear in the UI ("found but unverified — review to
  approve") so a human can promote them to tier 1 with one click.

### 3. Grounding rules (how the assistant is allowed to use it)

- **Cite or stay silent**: every datasheet-derived claim must cite file name
  and page. Chunks gain page-number metadata at extraction time (today they
  only have a chunk index) to make this enforceable.
- **Numbers come from structure first**: for ratings (voltage/current/
  temperature), the assistant must prefer the structured `check_mpn` values
  and use FTS5 text as supporting context — tables are the most
  extraction-error-prone part of a PDF, so prose quotes outrank
  reconstructed table fragments for numeric claims.
- **Absence is an answer**: when no document (or no match) exists, the
  assistant states that and may offer to fetch — it must not answer from
  model memory about a specific part's specs.
- **Conflicts surface, never resolve silently**: if a tier-3 document
  contradicts a tier-1/2 document or the `MpnCache` values, the assistant
  reports the conflict instead of picking one.

### 4. Honest failure (search errors ≠ empty results)

`searchDocuments` currently swallows all errors and returns `[]` —
indistinguishable from "nothing in the docs," which invites the assistant to
fall back on its own memory. Errors must propagate as errors so the tool
result says "search failed," not "no results." (See fixes below; the query-
escaping bug makes this failure mode common for part-number queries today.)

## Scalability decisions

- **Global datasheet library, not per-project copies.** A datasheet is a
  fact about a *part*, not a project. Tier-2/3 documents are stored once,
  keyed by (MPN, content hash), in a `DatasheetLibrary` table + shared
  storage area; projects link to library entries. The same LM317 PDF is
  fetched and indexed once for the whole installation, and every future
  project containing that part gets coverage for free — cost grows with the
  size of the parts catalog, which flattens, not with project count, which
  doesn't. Tier-1 uploads stay project-scoped (they may be proprietary or
  internal documents) unless the uploader marks them shareable.
- **Storage behind an interface.** All file reads/writes go through the
  existing `storage.ts` abstraction (verify it covers writes; extend if
  not), so `uploads/` can move to blob storage (S3 etc.) unchanged when
  Resistance becomes hosted/multi-user. Same for the SQLite → Postgres path:
  keep raw SQL for FTS5 confined to `document-service.ts`, which is already
  the case.
- **FTS5 storage: stop double-storing text.** The FTS5 table currently keeps
  its own copy of every chunk. Recreate it as an external-content table
  (`content='DocumentChunk'`) so the index references the chunk table
  instead of duplicating it — roughly halves document storage and removes a
  class of drift. Cheap to do now (the table is auto-created at startup and
  can be rebuilt from `DocumentChunk`); painful to retrofit at scale.
- **Fetches run as a background queue, not inline.** Ingestion (download,
  extract, verify, index) runs from a simple DB-backed job queue with
  retry/backoff and a per-run cap — a 200-part first sync enqueues 200 jobs
  and drains calmly instead of firing 200 downloads inside a request. Review
  runs and syncs never block on ingestion; coverage just improves in the
  background.

## Plan

### Phase 1 — provenance, verification gate, ingestion path (Resistance only)

1. Schema: `provenance` (`"upload" | "design_link" | "web_fetch"`),
   `sourceUrl`, `verifyStatus` (`"verified" | "quarantined"`), and
   `contentHash` on `ProjectFile`; new `DatasheetLibrary` table (mpn,
   contentHash, filePath, sourceUrl, fetchedAt) for the global library.
2. Reusable `ingestRemotePdf(url, mpn, provenance, projectId?)` in
   `file-service.ts`: download → verification gate (§2 above) → store via
   `storage.ts` → existing `indexDocumentFile` path, extended with page
   metadata per chunk. Quarantine on any gate failure.
3. Rebuild FTS5 table as external-content; wrap chunk+index writes in a
   transaction (kills the drift bug).
4. Surface provenance + verify status in `search_documents` results and the
   files UI (badges: Uploaded / Linked / Found online / Quarantined);
   add the grounding rules (§3) to the assistant system prompt.
5. Dedupe: one live document per (project, mpn); higher tier replaces lower;
   library entries shared across projects by contentHash.
6. Add per-project datasheet coverage (parts with a verified doc / total
   parts with MPNs) to the project view.

### Phase 2 — follow the engineer's links (needs small MCP server change)

1. MCP server: confirm each symbol's `Datasheet` property flows through
   `ComponentInfo.properties` into `sync_to_resistance` (likely a no-op or
   one-line change; confirm with phx).
2. Resistance: after a sync, for each component with a datasheet URL and no
   tier-1/2 document on file, enqueue `ingestRemotePdf(..., "design_link")`.
   Skip non-HTTP values (engineers sometimes put file paths or "~").

### Phase 3 — auto-download during spec fetch

1. Extend `datasheet-service.ts`: when the web-search pass identifies the
   datasheet, also resolve the concrete PDF URL (may need a follow-up
   fetch — web search returns snippets/URLs, not files).
2. Enqueue `ingestRemotePdf(..., "web_fetch")` for MPNs that still have no
   document after Phases 1–2; the verification gate is the backstop for
   wrong-document grabs.
3. Per-run fetch cap + queue backoff (see scalability); library-first check
   means already-known MPNs cost nothing.

### Fix alongside (pre-existing, becomes load-bearing)

- **FTS5 query escaping** (`document-service.ts:76`): raw queries hit FTS5
  `MATCH`, where hyphens/parentheses are operators — `"LM317-N"` throws a
  syntax error that is swallowed and returned as "no results." Escape by
  quoting each term. Part-number searches are exactly what auto-ingestion
  makes common, so this bug graduates from cosmetic to critical.
- **Swallowed search errors** (`document-service.ts:81`): remove the blanket
  `catch → []`; return a distinguishable error so the assistant can report
  "search failed" instead of treating it as an empty library (see
  anti-hallucination §4).
- **Index drift**: fixed structurally in Phase 1 by the external-content
  FTS5 table + transactional writes; add a startup reconcile pass as a
  belt-and-suspenders (the FTS5 table is already auto-created on startup).

## Open questions for phx

1. Does `sync_to_resistance` already carry the symbol `Datasheet` property
   through, or is that the one-line addition in Phase 2?
2. Revision pinning: is "latest datasheet found online" acceptable for
   tier 2/3, or should mismatches against the design's stated revision be
   flagged? (Verification gate checks *part identity*, not *revision*.)
3. Where should per-project fetch limits/config live — env var on the MCP
   server, or Resistance-side setting?
4. Quarantine review UX: is a files-table badge + one-click approve enough,
   or should the assistant be able to request approval mid-conversation?

## Effort estimate

- Phase 1: ~2 days (schema + library table, verification gate, FTS5 rebuild,
  page metadata, badges, coverage metric)
- Phase 2: ~half day Resistance + small MCP server confirm/change
- Phase 3: ~1 day (PDF URL resolution is the fiddly part)
- Fixes alongside: ~half day (escaping + error propagation; drift is
  absorbed into Phase 1)

Phases are independently shippable; Phase 1 alone already improves the
manual-upload flow (provenance, verification, dedupe, coverage metric) and
fixes both known FTS5 bugs.
