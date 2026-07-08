import { describe, expect, it } from "vitest";

import { escapeFtsPhrase, escapeFtsQuery, escapeFtsTerms } from "./fts";

describe("escapeFtsQuery", () => {
  it("quotes plain terms", () => {
    expect(escapeFtsQuery("thermal shutdown")).toBe(`"thermal" "shutdown"`);
  });

  it("neutralizes FTS5 operator characters in part numbers", () => {
    expect(escapeFtsQuery("LM317-N")).toBe(`"LM317-N"`);
    expect(escapeFtsQuery("MAX232(A)")).toBe(`"MAX232(A)"`);
    expect(escapeFtsQuery("NOT AND OR")).toBe(`"NOT" "AND" "OR"`);
  });

  it("doubles embedded double quotes", () => {
    expect(escapeFtsQuery(`1/4" resistor`)).toBe(`"1/4""" "resistor"`);
  });

  it("collapses whitespace and trims", () => {
    expect(escapeFtsQuery("  a\t b\n")).toBe(`"a" "b"`);
  });

  it("returns empty string for blank input", () => {
    expect(escapeFtsQuery("   ")).toBe("");
  });
});

describe("escapeFtsTerms", () => {
  it("returns individually quoted terms for OR composition", () => {
    expect(escapeFtsTerms("maximum current limit")).toEqual([
      `"maximum"`,
      `"current"`,
      `"limit"`,
    ]);
  });

  it("returns empty array for blank input", () => {
    expect(escapeFtsTerms("  ")).toEqual([]);
  });
});

describe("escapeFtsPhrase", () => {
  it("quotes a multi-word phrase as one FTS5 phrase", () => {
    expect(escapeFtsPhrase("quiescent current")).toBe(`"quiescent current"`);
  });

  it("doubles embedded quotes", () => {
    expect(escapeFtsPhrase(`1/4" fuse`)).toBe(`"1/4"" fuse"`);
  });
});
