import { describe, expect, it } from "vitest";
import {
  getRule,
  getRuleNames,
  hasRule,
  type RuleResult,
  registerRule,
  validateFieldExclusivity,
  validateWithRules,
} from "./index";

describe("rules registry", () => {
  it("should have all built-in rules registered", () => {
    const names = getRuleNames();
    expect(names).toContain("max-length");
    expect(names).toContain("min-length");
    expect(names).toContain("pattern");
    expect(names).toContain("starts-with");
    expect(names).toContain("ends-with");
    expect(names).toContain("contains");
    expect(names).toContain("not-empty");
    // Webhooks are bound in opentp.cli.yaml (checks.bindings.<id>.webhook), not rules
    expect(names).not.toContain("webhook");
  });

  it("should get rule by name", () => {
    const rule = getRule("max-length");
    expect(rule).toBeDefined();
    expect(rule?.name).toBe("max-length");
  });

  it("should return undefined for unknown rule", () => {
    const rule = getRule("unknown-rule");
    expect(rule).toBeUndefined();
  });

  it("should check if rule exists", () => {
    expect(hasRule("max-length")).toBe(true);
    expect(hasRule("unknown")).toBe(false);
  });
});

describe("validateWithRules", () => {
  const ctx = { fieldName: "test", fieldPath: "test", eventKey: "test" };

  it("should validate with multiple rules", async () => {
    const errors = await validateWithRules(
      "hello",
      {
        "min-length": 3,
        "max-length": 10,
      },
      ctx,
    );
    expect(errors).toHaveLength(0);
  });

  it("should collect errors from multiple failing rules", async () => {
    const errors = await validateWithRules(
      "hi",
      {
        "min-length": 5,
        "max-length": 1,
      },
      ctx,
    );
    expect(errors).toHaveLength(2);
  });

  it("skips unknown rules (reported statically) and rules disabled with false", async () => {
    const errors = await validateWithRules(
      "",
      { "unknown-rule": true, "not-empty": false, "max-length": 0 },
      ctx,
    );
    expect(errors).toEqual([]);
    expect(await validateWithRules("", { "not-empty": true }, ctx)).toHaveLength(1);
  });

  it("turns a throwing or rejecting rule into an error and keeps going", async () => {
    registerRule({
      name: "test-throws",
      validate: () => {
        throw new Error("boom");
      },
    });
    registerRule({
      name: "test-rejects",
      validate: async () => {
        throw "plain string";
      },
    });
    registerRule({
      name: "test-no-result",
      validate: () => undefined as unknown as RuleResult,
    });

    const errors = await validateWithRules(
      "hello",
      { "test-throws": true, "test-rejects": true, "test-no-result": true, "max-length": 1 },
      ctx,
    );
    expect(errors).toEqual([
      { valid: false, error: "check test-throws failed: boom", code: "CHECK_FAILED" },
      { valid: false, error: "check test-rejects failed: plain string", code: "CHECK_FAILED" },
      {
        valid: false,
        error: "check test-no-result failed: expected a result object, got undefined",
        code: "CHECK_FAILED",
      },
      { valid: false, error: "Length 5 exceeds maximum 1", code: "MAX_LENGTH_EXCEEDED" },
    ]);
  });
});

describe("validateFieldExclusivity", () => {
  it("should pass when field has no enum, dict, or value (free field)", () => {
    const result = validateFieldExclusivity({});
    expect(result).toBeNull();
  });

  it("should pass when only enum is present", () => {
    const result = validateFieldExclusivity({ enum: ["a", "b"] });
    expect(result).toBeNull();
  });

  it("should pass when only dict is present", () => {
    const result = validateFieldExclusivity({ dict: "path/to/dict" });
    expect(result).toBeNull();
  });

  it("should pass when only value is present", () => {
    const result = validateFieldExclusivity({ value: "fixed" });
    expect(result).toBeNull();
  });

  it("should fail when both enum and dict are present", () => {
    const result = validateFieldExclusivity({ enum: ["a"], dict: "path" });
    expect(result?.valid).toBe(false);
    expect(result?.code).toBe("EXCLUSIVE_FIELD_VIOLATION");
  });

  it("should fail when both enum and value are present", () => {
    const result = validateFieldExclusivity({ enum: ["a"], value: "a" });
    expect(result?.valid).toBe(false);
    expect(result?.code).toBe("EXCLUSIVE_FIELD_VIOLATION");
  });

  it("should fail when both dict and value are present", () => {
    const result = validateFieldExclusivity({ dict: "path", value: "a" });
    expect(result?.valid).toBe(false);
    expect(result?.code).toBe("EXCLUSIVE_FIELD_VIOLATION");
  });

  describe("with spec field", () => {
    it("should pass when event value is in spec enum", () => {
      const specField = { enum: ["a", "b", "c"] };
      const result = validateFieldExclusivity({ value: "b" }, specField);
      expect(result).toBeNull();
    });

    it("should fail when event value is not in spec enum", () => {
      const specField = { enum: ["a", "b", "c"] };
      const result = validateFieldExclusivity({ value: "d" }, specField);
      expect(result?.valid).toBe(false);
      expect(result?.code).toBe("VALUE_NOT_IN_ENUM");
    });

    it("should pass when event enum is subset of spec enum", () => {
      const specField = { enum: ["a", "b", "c", "d"] };
      const result = validateFieldExclusivity({ enum: ["a", "c"] }, specField);
      expect(result).toBeNull();
    });

    it("should fail when event enum has values not in spec enum", () => {
      const specField = { enum: ["a", "b", "c"] };
      const result = validateFieldExclusivity({ enum: ["a", "x", "y"] }, specField);
      expect(result?.valid).toBe(false);
      expect(result?.code).toBe("ENUM_NOT_SUBSET");
    });
  });
});
