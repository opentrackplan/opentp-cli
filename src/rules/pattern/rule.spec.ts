import { describe, expect, it } from "vitest";
import { pattern } from "./index";

const ctx = { fieldName: "test", fieldPath: "test", eventKey: "test" };

describe("pattern rule", () => {
  it("should pass when string matches pattern", async () => {
    const result = await pattern.validate("hello_world", "^[a-z_]+$", ctx);
    expect(result.valid).toBe(true);
  });

  it("should fail when string does not match pattern", async () => {
    const result = await pattern.validate("Hello World", "^[a-z_]+$", ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("PATTERN_NO_MATCH");
  });

  it("should support object params with flags", async () => {
    const result = await pattern.validate("Hello", { pattern: "^hello$", flags: "i" }, ctx);
    expect(result.valid).toBe(true);
  });

  it("should fail with invalid regex", async () => {
    const result = await pattern.validate("test", "[invalid", ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("INVALID_REGEX");
  });

  it("should fail for non-string values", async () => {
    const result = await pattern.validate(12345, "^\\d+$", ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("TYPE_MISMATCH");
  });

  it("should fail with invalid params", async () => {
    const result = await pattern.validate("test", 123, ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("INVALID_PARAMS");
  });

  it("should match complex patterns", async () => {
    const result = await pattern.validate("user@example.com", "^[^@]+@[^@]+\\.[^@]+$", ctx);
    expect(result.valid).toBe(true);
  });
});
