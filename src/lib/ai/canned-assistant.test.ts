import { describe, expect, it } from "vitest";

import { getCannedResponse } from "./canned-assistant";

describe("getCannedResponse", () => {
  it("prompts when the question is empty", () => {
    expect(getCannedResponse("  ").text).toMatch(/get started/i);
  });

  it("returns a response when AI is not yet configured", () => {
    expect(getCannedResponse("What connects to U7?").text).toMatch(/not yet configured/i);
  });

  it("routes connectivity questions to get_connected_components", () => {
    expect(getCannedResponse("What connects to U7?").suggestedTool).toBe(
      "get_connected_components"
    );
  });

  it("routes net/rail questions to search_net", () => {
    expect(getCannedResponse("What is on the 5V rail?").suggestedTool).toBe(
      "search_net"
    );
  });

  it("routes design-review questions to review_design_risks", () => {
    expect(
      getCannedResponse("What design-review risks should I check?")
        .suggestedTool
    ).toBe("review_design_risks");
  });
});
