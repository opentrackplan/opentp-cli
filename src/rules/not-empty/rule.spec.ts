import { describe, expect, it } from "vitest";
import { notEmpty } from "./index";

const ctx = { fieldName: "test", fieldPath: "test", eventKey: "test" };

describe("not-empty rule", () => {
  describe("strings", () => {
    it("should pass for non-empty string", () => {
      const result = notEmpty.validate("hello", true, ctx);
      expect(result.valid).toBe(true);
    });

    it("should fail for empty string", () => {
      const result = notEmpty.validate("", true, ctx);
      expect(result.valid).toBe(false);
      expect(result.code).toBe("EMPTY_STRING");
    });

    it("should fail for whitespace-only string when trim is true", () => {
      const result = notEmpty.validate("   ", { trim: true }, ctx);
      expect(result.valid).toBe(false);
      expect(result.code).toBe("EMPTY_STRING");
    });

    it("should pass for whitespace-only string when trim is false", () => {
      const result = notEmpty.validate("   ", true, ctx);
      expect(result.valid).toBe(true);
    });
  });

  describe("arrays", () => {
    it("should pass for non-empty array", () => {
      const result = notEmpty.validate([1, 2, 3], true, ctx);
      expect(result.valid).toBe(true);
    });

    it("should fail for empty array", () => {
      const result = notEmpty.validate([], true, ctx);
      expect(result.valid).toBe(false);
      expect(result.code).toBe("EMPTY_ARRAY");
    });
  });

  describe("objects", () => {
    it("should pass for non-empty object", () => {
      const result = notEmpty.validate({ key: "value" }, true, ctx);
      expect(result.valid).toBe(true);
    });

    it("should fail for empty object", () => {
      const result = notEmpty.validate({}, true, ctx);
      expect(result.valid).toBe(false);
      expect(result.code).toBe("EMPTY_OBJECT");
    });
  });

  describe("null and undefined", () => {
    it("should fail for null", () => {
      const result = notEmpty.validate(null, true, ctx);
      expect(result.valid).toBe(false);
      expect(result.code).toBe("EMPTY_VALUE");
    });

    it("should fail for undefined", () => {
      const result = notEmpty.validate(undefined, true, ctx);
      expect(result.valid).toBe(false);
      expect(result.code).toBe("EMPTY_VALUE");
    });
  });

  describe("other types", () => {
    it("should pass for numbers", () => {
      const result = notEmpty.validate(0, true, ctx);
      expect(result.valid).toBe(true);
    });

    it("should pass for booleans", () => {
      const result = notEmpty.validate(false, true, ctx);
      expect(result.valid).toBe(true);
    });
  });
});
