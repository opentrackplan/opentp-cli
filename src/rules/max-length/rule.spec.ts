import { describe, expect, it } from "vitest";
import { maxLength } from "./index";

const ctx = { fieldName: "test", fieldPath: "test", eventKey: "test" };

describe("max-length rule", () => {
  it("should pass when string is shorter than max", () => {
    const result = maxLength.validate("hello", 10, ctx);
    expect(result.valid).toBe(true);
  });

  it("should pass when string equals max length", () => {
    const result = maxLength.validate("hello", 5, ctx);
    expect(result.valid).toBe(true);
  });

  it("should fail when string exceeds max length", () => {
    const result = maxLength.validate("hello world", 5, ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("MAX_LENGTH_EXCEEDED");
  });

  it("should fail for non-string values", () => {
    const result = maxLength.validate(12345, 10, ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("TYPE_MISMATCH");
  });

  it("should handle empty string", () => {
    const result = maxLength.validate("", 5, ctx);
    expect(result.valid).toBe(true);
  });
});
