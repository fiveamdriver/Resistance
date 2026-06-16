import { describe, expect, it } from "vitest";

import { isOle2Header } from "./altiumParser";

describe("isOle2Header", () => {
  it("accepts a buffer with the OLE2/CFB magic", () => {
    const buf = Buffer.from([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00,
    ]);
    expect(isOle2Header(buf)).toBe(true);
  });

  it("rejects a non-OLE2 buffer (e.g. a text file)", () => {
    expect(isOle2Header(Buffer.from("SCHEMATIC EXPORT v1\n"))).toBe(false);
  });

  it("rejects a buffer shorter than 8 bytes", () => {
    expect(isOle2Header(Buffer.from([0xd0, 0xcf, 0x11]))).toBe(false);
  });
});
