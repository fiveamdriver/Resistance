import { describe, expect, it } from "vitest";

import { ValidationError } from "./errors";
import {
  MAX_UPLOAD_BYTES,
  createProjectSchema,
  parseOrThrow,
  uploadFileMetaSchema,
} from "./validation";

describe("createProjectSchema", () => {
  it("accepts a valid project and trims the name", () => {
    const result = createProjectSchema.parse({ name: "  Board A  " });
    expect(result.name).toBe("Board A");
  });

  it("rejects an empty name", () => {
    expect(createProjectSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("treats an empty description as undefined", () => {
    const result = createProjectSchema.parse({ name: "X", description: "" });
    expect(result.description).toBeUndefined();
  });
});

describe("uploadFileMetaSchema", () => {
  it("accepts a supported file within the size limit", () => {
    const result = uploadFileMetaSchema.safeParse({
      name: "bom.csv",
      size: 1024,
    });
    expect(result.success).toBe(true);
  });

  it("rejects unsupported file types", () => {
    const result = uploadFileMetaSchema.safeParse({
      name: "malware.exe",
      size: 10,
    });
    expect(result.success).toBe(false);
  });

  it("rejects files over the size limit", () => {
    const result = uploadFileMetaSchema.safeParse({
      name: "big.pdf",
      size: MAX_UPLOAD_BYTES + 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty files", () => {
    const result = uploadFileMetaSchema.safeParse({ name: "x.pdf", size: 0 });
    expect(result.success).toBe(false);
  });
});

describe("parseOrThrow", () => {
  it("returns parsed data on success", () => {
    expect(parseOrThrow(createProjectSchema, { name: "Y" }).name).toBe("Y");
  });

  it("throws a ValidationError with field details on failure", () => {
    try {
      parseOrThrow(createProjectSchema, { name: "" });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details?.name).toBeDefined();
    }
  });
});
