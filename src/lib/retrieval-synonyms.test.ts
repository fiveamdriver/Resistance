import { describe, expect, it } from "vitest";

import { expandQuerySynonyms } from "./retrieval-synonyms";

describe("expandQuerySynonyms", () => {
  it("expands a known abbreviation to its full phrases", () => {
    const expanded = expandQuerySynonyms("what is the IQ");
    expect(expanded).toContain("quiescent current");
    expect(expanded).not.toContain("IQ"); // never re-adds what the query has
  });

  it("expands multi-word phrases", () => {
    const expanded = expandQuerySynonyms("current limit threshold");
    expect(expanded).toContain("overcurrent");
    expect(expanded).toContain("OCP");
  });

  it("matches whole words only — no substring false positives", () => {
    // "unique" contains "iq"; "escape" contains no group member.
    expect(expandQuerySynonyms("unique escape sequence")).toEqual([]);
  });

  it("handles phrases with regex metacharacters", () => {
    const expanded = expandQuerySynonyms("RDS(on) at 4.5V");
    expect(expanded).toContain("on-resistance");
  });

  it("is case-insensitive", () => {
    expect(expandQuerySynonyms("uvlo threshold")).toContain(
      "undervoltage lockout"
    );
  });

  it("returns empty for queries mentioning no group", () => {
    expect(expandQuerySynonyms("pinout of U1")).toEqual([]);
  });
});
