import { describe, expect, it } from "vitest";
import { contains } from "./index";

const ctx = { fieldName: "test", fieldPath: "test", eventKey: "test" };

describe("contains rule", () => {
  it("should pass when string contains substring", async () => {
    const result = await contains.validate("user_click_button", "_click_", ctx);
    expect(result.valid).toBe(true);
  });

  it("should fail when string does not contain substring", async () => {
    const result = await contains.validate("user_tap_button", "_click_", ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("CONTAINS_FAILED");
  });

  it("should handle empty substring", async () => {
    const result = await contains.validate("anything", "", ctx);
    expect(result.valid).toBe(true);
  });

  it("should be case sensitive", async () => {
    const result = await contains.validate("user_Click_button", "_click_", ctx);
    expect(result.valid).toBe(false);
  });

  it("should fail for non-string values", async () => {
    const result = await contains.validate(12345, "_click_", ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("TYPE_MISMATCH");
  });

  it("should pass when substring at start", async () => {
    const result = await contains.validate("click_button", "click", ctx);
    expect(result.valid).toBe(true);
  });

  it("should pass when substring at end", async () => {
    const result = await contains.validate("button_click", "click", ctx);
    expect(result.valid).toBe(true);
  });
});
