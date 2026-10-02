import { describe, expect, it } from "vitest";
import { endsWith } from "./index";

const ctx = { fieldName: "test", fieldPath: "test", eventKey: "test" };

describe("ends-with rule", () => {
  it("should pass when string ends with suffix", async () => {
    const result = await endsWith.validate("user_id", "_id", ctx);
    expect(result.valid).toBe(true);
  });

  it("should fail when string does not end with suffix", async () => {
    const result = await endsWith.validate("user_name", "_id", ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("ENDS_WITH_FAILED");
  });

  it("should handle empty suffix", async () => {
    const result = await endsWith.validate("anything", "", ctx);
    expect(result.valid).toBe(true);
  });

  it("should be case sensitive", async () => {
    const result = await endsWith.validate("user_ID", "_id", ctx);
    expect(result.valid).toBe(false);
  });

  it("should fail for non-string values", async () => {
    const result = await endsWith.validate(12345, "_id", ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("TYPE_MISMATCH");
  });

  it("should pass when value equals suffix", async () => {
    const result = await endsWith.validate("_id", "_id", ctx);
    expect(result.valid).toBe(true);
  });
});
