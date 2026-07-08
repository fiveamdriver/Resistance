/**
 * Domain-synonym expansion for document retrieval (EMBEDDINGS_FOR_RAG.md W1).
 *
 * Static, conservative groups of interchangeable EE datasheet vocabulary. Used
 * only as the last retrieval fallback: when both strict-AND and relaxed-OR
 * matching return nothing, phrases from any group mentioned in the query are
 * added as OR alternatives. Zero API calls; retrieval-only, so a loose match
 * can never inject wrong facts — the model always reads the verbatim chunk.
 *
 * Grow this table from the RetrievalLog miss log (real zero-hit queries), not
 * from guesswork. Only add groups whose members genuinely denote the same
 * datasheet concept — "load regulation" and "line regulation" are different
 * numbers and must never be grouped.
 */

const SYNONYM_GROUPS: string[][] = [
  ["current limit", "current limiting", "overcurrent", "over-current", "OCP"],
  ["quiescent current", "IQ", "supply current"],
  ["UVLO", "undervoltage lockout", "under-voltage lockout"],
  ["RDS(on)", "on-resistance", "on resistance"],
  ["thermal shutdown", "TSD", "overtemperature", "over-temperature"],
  ["dropout voltage", "dropout"],
  ["ESR", "equivalent series resistance"],
  ["absolute maximum", "absolute maximum ratings", "abs max"],
  ["switching frequency", "oscillator frequency", "fsw"],
  ["soft-start", "soft start"],
  ["PSRR", "power supply rejection", "ripple rejection"],
  ["inrush", "inrush current", "surge current"],
];

/** Escape regex metacharacters in a synonym phrase (e.g. "RDS(on)"). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether `phrase` appears in `query` as whole words — "IQ" matches "typical
 * IQ" but not "unique". Boundaries are non-alphanumeric so hyphenated and
 * parenthesized phrases work.
 */
function queryMentions(query: string, phrase: string): boolean {
  const pattern = new RegExp(
    `(^|[^a-z0-9])${escapeRegExp(phrase.toLowerCase())}($|[^a-z0-9])`
  );
  return pattern.test(query.toLowerCase());
}

/**
 * Synonym phrases to OR into a retried search: for every group with a member
 * present in the query, all *other* members of that group. Deduplicated,
 * unquoted (callers apply FTS escaping).
 */
export function expandQuerySynonyms(query: string): string[] {
  const expansions = new Set<string>();
  for (const group of SYNONYM_GROUPS) {
    if (group.some((phrase) => queryMentions(query, phrase))) {
      for (const phrase of group) {
        if (!queryMentions(query, phrase)) expansions.add(phrase);
      }
    }
  }
  return [...expansions];
}
