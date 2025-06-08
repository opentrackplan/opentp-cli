import { describe, expect, it } from "vitest";
import { createTransform, createTransforms, getStep, getStepNames } from "./index";

describe("transforms/index", () => {
	describe("getStepNames", () => {
		it("returns all registered step names", () => {
			const names = getStepNames();
			expect(names).toContain("lower");
			expect(names).toContain("upper");
			expect(names).toContain("trim");
			expect(names).toContain("replace");
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
			const transform = createTransform({
				steps: [{ step: "lower" }],
			});
			expect(transform("HELLO")).toBe("hello");
		});

		it("creates transform with multiple steps", () => {
			const transform = createTransform({
				steps: [{ step: "lower" }, { step: "trim" }],
			});
			expect(transform("  HELLO WORLD  ")).toBe("hello world");
		});

		it("creates transform with step params", () => {
			const transform = createTransform({
				steps: [
					{
						step: "replace",
						params: { pattern: " ", with: "_" },
					},
				],
			});
			expect(transform("hello world")).toBe("hello_world");
		});

		it("handles unknown step gracefully", () => {
			const transform = createTransform({
				steps: [{ step: "unknown" }],
			});
			expect(transform("hello")).toBe("hello");
		});
	});

	describe("createTransforms", () => {
		it("creates multiple named transforms", () => {
			const transforms = createTransforms({
				slug: {
					steps: [
						{ step: "lower" },
						{ step: "trim" },
						{ step: "replace", params: { pattern: " ", with: "_" } },
					],
				},
				upper_trimmed: {
					steps: [{ step: "upper" }, { step: "trim" }],
				},
			});

			expect(transforms.slug("  Hello World  ")).toBe("hello_world");
			expect(transforms.upper_trimmed("  hello  ")).toBe("HELLO");
		});
	});
});
