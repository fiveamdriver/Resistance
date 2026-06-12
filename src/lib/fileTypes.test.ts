import { describe, expect, it } from "vitest";

import { categorizeFile, getExtension, isAcceptedFile } from "./fileTypes";

describe("getExtension", () => {
  it("returns the lowercased extension with the dot", () => {
    expect(getExtension("BOM.CSV")).toBe(".csv");
    expect(getExtension("netlist.NET")).toBe(".net");
  });

  it("returns empty string when there is no extension", () => {
    expect(getExtension("README")).toBe("");
  });
});

describe("categorizeFile", () => {
  it("maps known extensions to categories", () => {
    expect(categorizeFile("design.net")).toBe("netlist");
    expect(categorizeFile("parts.csv")).toBe("bom");
    expect(categorizeFile("parts.xlsx")).toBe("bom");
    expect(categorizeFile("datasheet.pdf")).toBe("pdf");
    expect(categorizeFile("spec.md")).toBe("document");
    expect(categorizeFile("notes.docx")).toBe("document");
  });

  it("defaults ambiguous .txt to document", () => {
    expect(categorizeFile("notes.txt")).toBe("document");
  });

  it("returns 'other' for unknown extensions", () => {
    expect(categorizeFile("image.png")).toBe("other");
  });
});

describe("isAcceptedFile", () => {
  it("accepts supported types and rejects others", () => {
    expect(isAcceptedFile("a.pdf")).toBe(true);
    expect(isAcceptedFile("a.exe")).toBe(false);
  });
});
