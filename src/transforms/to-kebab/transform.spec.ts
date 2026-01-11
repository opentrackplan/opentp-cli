import { describe, expect, it } from "vitest";
import { toKebab } from "./index";

describe("to-kebab", () => {
  const transform = toKebab.factory();

  it("replaces spaces with dash", () => {
    expect(transform("hello world")).toBe("hello-world");
  });

  it("replaces special characters with dash", () => {
    expect(transform("hello_world")).toBe("hello-world");
    expect(transform("hello.world")).toBe("hello-world");
    expect(transform("hello!world")).toBe("hello-world");
  });

  it("collapses multiple dashes", () => {
    expect(transform("hello   world")).toBe("hello-world");
    expect(transform("hello___world")).toBe("hello-world");
  });

  it("trims dashes from edges", () => {
    expect(transform("  hello  ")).toBe("hello");
    expect(transform("__hello__")).toBe("hello");
  });

  it("preserves alphanumeric characters", () => {
    expect(transform("hello123world")).toBe("hello123world");
  });

  it("handles empty string", () => {
    expect(transform("")).toBe("");
  });

  it("handles string with only special chars", () => {
    expect(transform("___")).toBe("");
  });
});
