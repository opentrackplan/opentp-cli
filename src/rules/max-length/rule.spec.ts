import { describe, expect, it } from "vitest";
import { maxLength } from "./index";

const ctx = { fieldName: "test", fieldPath: "test", eventKey: "test" };

describe("max-length rule", () => {
  it("should pass when string is shorter than max", async () => {
    const result = await maxLength.validate("hello", 10, ctx);
    expect(result.valid).toBe(true);
  });

  it("should pass when string equals max length", async () => {
    const result = await maxLength.validate("hello", 5, ctx);
    expect(result.valid).toBe(true);
  });

  it("should fail when string exceeds max length", async () => {
    const result = await maxLength.validate("hello world", 5, ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("MAX_LENGTH_EXCEEDED");
  });

  it("should fail for non-string values", async () => {
    const result = await maxLength.validate(12345, 10, ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("TYPE_MISMATCH");
  });

  it("should handle empty string", async () => {
    const result = await maxLength.validate("", 5, ctx);
    expect(result.valid).toBe(true);
  });

  it("counts Unicode code points, not UTF-16 code units", async () => {
    // Two emoji are 2 code points (4 UTF-16 code units)
    expect((await maxLength.validate("😀😀", 2, ctx)).valid).toBe(true);
    expect(await maxLength.validate("😀😀😀", 2, ctx)).toMatchObject({
      error: "Length 3 exceeds maximum 2",
    });
  });
});
