# Automatic Datasheet Ingestion — Plan

Status: proposal, not implemented. Follows from the KiCad MCP server work
(`packages/kicad-mcp/PLAN.md`) and the existing MPN spec-fetch pipeline
(`src/server/services/datasheet-service.ts`).

## Why this adds value to Resistance

Resistance's core promise is an assistant that reviews a design the way a
careful engineer would: against the actual netlist and the actual
manufacturer documentation — not from an LLM's general recollection of what
an LM317 probably does. Today the two halves of that promise are unevenly
automated.

**Design data is automatic.** The KiCad MCP server syncs components, nets,
and BOM with zero manual effort and stays current with the board.

**Datasheet depth is manual, and thin.** The assistant's per-part knowledge
comes from two places:

- `MpnCache`: ~5 headline numbers per MPN (abs-max voltage, max current,
  operating temp range, derating notes), auto-extracted by a one-time web
  lookup. Enough to catch "16V-rated cap on a 24V rail." Not enough for
  anything that lives in the body of the datasheet.
- FTS5 full-text search: the complete document, but only for PDFs a human
  manually uploaded. On a 30-part BOM with 3 uploaded datasheets, deep
  review coverage is exactly 3 parts.

The difference matters because most of what makes a datasheet review
valuable is *not* in the headline ratings table. It's in the body and the
footnotes: electrolytic ripple-current ratings at temperature, derating
curves rather than single-point maxima, "abs max applies only below
T_A = 70°C" footnotes, minimum-load requirements on regulators, dropout vs.
temperature, startup/sequencing behavior, SW-node layout guidance,
pin-specific limits. A 5-number summary structurally cannot catch the class
of problems that experienced reviewers catch — and those are precisely the
findings that justify an AI review tool to a skeptical EE.

The gap is also cheap to close: the spec-fetch job *already* locates and
reads each part's datasheet online, extracts five numbers, and discards the
document. The marginal cost of keeping what was already fetched is close to
zero; today we pay for the trip and leave the book.

What closing the gap buys, in review terms:

1. **Full-BOM depth instead of upload-dependent depth.** Every MPN on every
   board becomes answerable at datasheet depth — application/layout
   guidance, conditions and footnotes, behavior over temperature — not just
   the parts someone remembered to upload. The assistant's usefulness stops
   being a function of upload discipline.
2. **Findings an engineer can verify, not take on faith.** Every
   datasheet-derived claim must cite the document and page on file — the
   same standard you'd hold a colleague's design-review redline to. A
   finding that says "per the datasheet on file, p.7, ripple current is
   rated at 105°C ambient" can be checked in thirty seconds; "the AI thinks
   the rating is X" cannot. Reviewability is what makes the findings
   actionable.
3. **A trust chain that mirrors engineering practice.** The document
   hierarchy matches how an EE already ranks sources: the PDF you attached
   to the project outranks the link you put on the symbol, which outranks
   whatever a web search turned up — and nothing enters the searchable
   record without passing incoming inspection (does the document actually
   contain this MPN? is it a real datasheet and not a distributor summary
   page? did the text extract cleanly?). Rejects are quarantined for human
   approval, never silently trusted.
4. **No fabricated specs, by construction.** The assistant is barred from
   answering part-spec questions out of model memory: verified-document
   citation, or an explicit "no datasheet on file." Missing documents stay
   visibly missing; conflicting sources are flagged rather than silently
   resolved — the same way a reviewer treats two datasheet revisions that
   disagree.
5. **Cost amortizes like a parts library, because it is one.** Datasheets
   are stored once per MPN globally (content-hashed), shared across all
   projects — the same economics as a team's approved-parts library. The
   tenth board using the same buck controller costs nothing new; the
   library compounds in value as the parts catalog grows, while per-question
   cost stays a local index lookup (no web, no tokens, no latency).
6. **BOM documentation coverage becomes a visible, driveable number.**
   "27/30 parts have a verified datasheet on file" is a meaningful
   pre-review/pre-release gate — the same completeness check an EE does by
   hand before a design review, maintained automatically.

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
