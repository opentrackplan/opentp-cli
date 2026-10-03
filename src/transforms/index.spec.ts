import { describe, expect, it } from "vitest";
import { createTransform, createTransforms, getStep, getStepNames, getStepProblem } from "./index";

describe("transforms/index", () => {
  describe("getStepNames", () => {
    it("returns all registered step names", () => {
      const names = getStepNames();
      expect(names).toContain("lower");
      expect(names).toContain("upper");
      expect(names).toContain("transliterate");
      expect(names).toContain("replace");
      expect(names).toContain("keep");
      expect(names).toContain("trim");
      expect(names).toContain("to-underscore");
      expect(names).toContain("to-kebab");
      expect(names).toContain("collapse");
      expect(names).toContain("to-snake-case");
      expect(names).toContain("to-camel-case");
      expect(names).toContain("truncate");
    });
  });

  describe("getStep", () => {
    it("returns step definition by name", () => {
      const step = getStep("lower");
      expect(step).toBeDefined();
      expect(step?.name).toBe("lower");
    });

    it("returns undefined for unknown step", () => {
      const step = getStep("unknown");
      expect(step).toBeUndefined();
    });
  });

  describe("createTransform", () => {
    it("creates transform with single step", () => {
      const transform = createTransform(["lower"]);
      expect(transform("HELLO")).toBe("hello");
    });

    it("creates transform with multiple steps", () => {
      const transform = createTransform(["lower", "to-underscore"]);
      expect(transform("Hello World")).toBe("hello_world");
    });

    it("creates transform with step params", () => {
      const transform = createTransform([{ transliterate: { map: { ä: "ae", ö: "oe" } } }]);
      expect(transform("äöl")).toBe("aeoel");
    });

    it("applies truncate step", () => {
      const transform = createTransform(["lower", { truncate: 5 }]);
      expect(transform("HELLO WORLD")).toBe("hello");
    });

    it("throws on an unknown step instead of skipping it", () => {
      expect(() => createTransform(["lower", "unknown"])).toThrow(
        "Unknown transform step 'unknown' (custom steps: keygen.plugins in opentp.cli.yaml, or --external-transforms)",
      );
      expect(() => createTransform([{ unknown: { a: 1 } }])).toThrow(
        "Unknown transform step 'unknown'",
      );
    });

    it.each([
      [{ lower: true, upper: true }, '{"lower":true,"upper":true}'],
      [{}, "{}"],
      [["lower"], '["lower"]'],
      [42, "42"],
      [null, "null"],
    ])("throws on a malformed step %j", (step, shown) => {
      expect(() => createTransform([step as unknown as string])).toThrow(
        `Invalid transform step ${shown}: expected a step name or a single-key mapping { <step>: <params> }`,
      );
    });
  });

  describe("getStepProblem", () => {
    it("accepts registered steps in both forms", () => {
      expect(getStepProblem("lower")).toBeNull();
      expect(getStepProblem({ truncate: 5 })).toBeNull();
    });

    it("reports unknown and malformed steps", () => {
      expect(getStepProblem("slugify")).toBe(
        "Unknown transform step 'slugify' (custom steps: keygen.plugins in opentp.cli.yaml, or --external-transforms)",
      );
      expect(getStepProblem(undefined)).toBe(
        "Invalid transform step undefined: expected a step name or a single-key mapping { <step>: <params> }",
      );
    });
  });

  describe("createTransforms", () => {
    it("creates multiple named transforms", () => {
      const transforms = createTransforms({
        slug: ["lower", "to-underscore"],
        compact: ["lower", "collapse"],
      });

      expect(transforms.slug("Hello World")).toBe("hello_world");
      expect(transforms.compact("Hello World")).toBe("helloworld");
    });
  });

  describe("real-world transform example", () => {
    it("creates slug transform for German text", () => {
      const germanMap: Record<string, string> = {
        ä: "ae",
        ö: "oe",
        ü: "ue",
        ß: "ss",
      };

      const transform = createTransform([
        { transliterate: { map: germanMap } },
        "lower",
        "to-underscore",
        { keep: { chars: "a-z0-9_:" } },
        { truncate: 160 },
      ]);

      expect(transform("Größe")).toBe("groesse");
      expect(transform("Über - Büro - Beschreibung")).toBe("ueber_buero_beschreibung");
      expect(transform("Müller GmbH 2024")).toBe("mueller_gmbh_2024");
    });
  });
});
