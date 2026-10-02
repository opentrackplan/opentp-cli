import { describe, expect, it } from "vitest";
import { startsWith } from "./index";

const ctx = { fieldName: "test", fieldPath: "test", eventKey: "test" };

describe("starts-with rule", () => {
  it("should pass when string starts with prefix", async () => {
    const result = await startsWith.validate("app_login", "app_", ctx);
    expect(result.valid).toBe(true);
  });

  it("should fail when string does not start with prefix", async () => {
    const result = await startsWith.validate("login_app", "app_", ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("STARTS_WITH_FAILED");
  });

  it("should handle empty prefix", async () => {
    const result = await startsWith.validate("anything", "", ctx);
    expect(result.valid).toBe(true);
  });

  it("should be case sensitive", async () => {
    const result = await startsWith.validate("App_login", "app_", ctx);
    expect(result.valid).toBe(false);
  });

  it("should fail for non-string values", async () => {
    const result = await startsWith.validate(12345, "app_", ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("TYPE_MISMATCH");
  });

  it("should pass when value equals prefix", async () => {
    const result = await startsWith.validate("app_", "app_", ctx);
    expect(result.valid).toBe(true);
  });
});
