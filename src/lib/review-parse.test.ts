import { describe, expect, it } from "vitest";

import { parseSubmitReview } from "./review-parse";

describe("parseSubmitReview", () => {
  it("normalizes a valid submission", () => {
    const result = parseSubmitReview({
      summary: "  Reviewed power and LO.  ",
      findings: [
        {
          block: "LO Synthesizer",
          severity: "possible_bug",
          title: "Termination impedance mismatch",
          rationale: "82||130 = 50.3Ω but line is 75Ω.",
          refdes: ["r1", "R1", " r2 "],
          hw_review_required: true,
        },
      ],
    });

    expect(result.summary).toBe("Reviewed power and LO.");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].refDes).toEqual(["R1", "R2"]); // deduped, uppercased
    expect(result.findings[0].hwReviewRequired).toBe(true);
  });

  it("drops findings with unknown severity or missing title", () => {
    const result = parseSubmitReview({
      summary: "x",
      findings: [
        { severity: "made_up", title: "bad", refdes: [] },
        { severity: "verify", title: "", refdes: [] },
        { severity: "watch", title: "ok one", rationale: "r", refdes: ["U1"] },
      ],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe("ok one");
  });

  it("defaults block to General and refDes to empty", () => {
    const result = parseSubmitReview({
      findings: [{ severity: "minor", title: "t" }],
    });
    expect(result.findings[0].block).toBe("General");
    expect(result.findings[0].refDes).toEqual([]);
    expect(result.summary).toBe("");
  });

  it("handles non-object input gracefully", () => {
    expect(parseSubmitReview(null).findings).toEqual([]);
    expect(parseSubmitReview("nope").findings).toEqual([]);
  });
});
