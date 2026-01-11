import { describe, expect, it } from "vitest";
import { collapse } from "./index";

describe("collapse", () => {
  const transform = collapse.factory();

  it("removes spaces", () => {
    expect(transform("hello world")).toBe("helloworld");
  });

  it("removes special characters", () => {
    expect(transform("hello-world_test.foo")).toBe("helloworldtestfoo");
  });

  it("preserves letters and numbers", () => {
    expect(transform("abc123XYZ")).toBe("abc123XYZ");
  });

  it("handles empty string", () => {
    expect(transform("")).toBe("");
  });

  it("handles string with only special chars", () => {
    expect(transform("---___...")).toBe("");
  });
});
