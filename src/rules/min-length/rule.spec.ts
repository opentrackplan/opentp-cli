import { describe, expect, it } from "vitest";
import { minLength } from "./index";

const ctx = { fieldName: "test", fieldPath: "test", eventKey: "test" };

describe("min-length rule", () => {
  it("should pass when string is longer than min", async () => {
    const result = await minLength.validate("hello", 3, ctx);
    expect(result.valid).toBe(true);
  });

  it("should pass when string equals min length", async () => {
    const result = await minLength.validate("hello", 5, ctx);
    expect(result.valid).toBe(true);
  });

  it("should fail when string is shorter than min", async () => {
    const result = await minLength.validate("hi", 3, ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("MIN_LENGTH_NOT_MET");
  });

  it("should fail for non-string values", async () => {
    const result = await minLength.validate(12345, 3, ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("TYPE_MISMATCH");
  });

  it("should fail for empty string when min > 0", async () => {
    const result = await minLength.validate("", 1, ctx);
    expect(result.valid).toBe(false);
  });

  it("should pass for empty string when min = 0", async () => {
    const result = await minLength.validate("", 0, ctx);
    expect(result.valid).toBe(true);
  });

  it("counts Unicode code points, not UTF-16 code units", async () => {
    // Two emoji are 2 code points (4 UTF-16 code units)
    expect((await minLength.validate("😀😀", 3, ctx)).valid).toBe(false);
    expect(await minLength.validate("😀😀", 3, ctx)).toMatchObject({
      error: "Length 2 is less than minimum 3",
    });
    expect((await minLength.validate("日本", 2, ctx)).valid).toBe(true);
  });
});
