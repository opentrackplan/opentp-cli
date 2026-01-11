import { describe, expect, it } from "vitest";
import { minLength } from "./index";

const ctx = { fieldName: "test", fieldPath: "test", eventKey: "test" };

describe("min-length rule", () => {
  it("should pass when string is longer than min", () => {
    const result = minLength.validate("hello", 3, ctx);
    expect(result.valid).toBe(true);
  });

  it("should pass when string equals min length", () => {
    const result = minLength.validate("hello", 5, ctx);
    expect(result.valid).toBe(true);
  });

  it("should fail when string is shorter than min", () => {
    const result = minLength.validate("hi", 3, ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("MIN_LENGTH_NOT_MET");
  });

  it("should fail for non-string values", () => {
    const result = minLength.validate(12345, 3, ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("TYPE_MISMATCH");
  });

  it("should fail for empty string when min > 0", () => {
    const result = minLength.validate("", 1, ctx);
    expect(result.valid).toBe(false);
  });

  it("should pass for empty string when min = 0", () => {
    const result = minLength.validate("", 0, ctx);
    expect(result.valid).toBe(true);
  });
});
