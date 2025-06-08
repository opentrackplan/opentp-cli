import { describe, expect, it } from "vitest";
import { regex } from "./index";

const ctx = { fieldName: "test", fieldPath: "test", eventKey: "test" };

describe("regex rule", () => {
  it("should pass when string matches pattern", () => {
    const result = regex.validate("hello_world", "^[a-z_]+$", ctx);
    expect(result.valid).toBe(true);
  });

  it("should fail when string does not match pattern", () => {
    const result = regex.validate("Hello World", "^[a-z_]+$", ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("REGEX_NO_MATCH");
  });

  it("should support object params with flags", () => {
    const result = regex.validate("Hello", { pattern: "^hello$", flags: "i" }, ctx);
    expect(result.valid).toBe(true);
  });

  it("should fail with invalid regex", () => {
    const result = regex.validate("test", "[invalid", ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("INVALID_REGEX");
  });

  it("should fail for non-string values", () => {
    const result = regex.validate(12345, "^\\d+$", ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("TYPE_MISMATCH");
  });

  it("should fail with invalid params", () => {
    const result = regex.validate("test", 123, ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("INVALID_PARAMS");
  });

  it("should match complex patterns", () => {
    const result = regex.validate("user@example.com", "^[^@]+@[^@]+\\.[^@]+$", ctx);
    expect(result.valid).toBe(true);
  });
});
