import { describe, expect, it } from "vitest";
import { toUnderscore } from "./index";

describe("to-underscore", () => {
  const transform = toUnderscore.factory();

  it("replaces spaces with underscore", () => {
    expect(transform("hello world")).toBe("hello_world");
  });

  it("replaces special characters with underscore", () => {
    expect(transform("hello-world")).toBe("hello_world");
    expect(transform("hello.world")).toBe("hello_world");
    expect(transform("hello!world")).toBe("hello_world");
  });

  it("collapses multiple underscores", () => {
    expect(transform("hello   world")).toBe("hello_world");
    expect(transform("hello---world")).toBe("hello_world");
  });

  it("trims underscores from edges", () => {
    expect(transform("  hello  ")).toBe("hello");
    expect(transform("--hello--")).toBe("hello");
  });

  it("preserves alphanumeric characters", () => {
    expect(transform("hello123world")).toBe("hello123world");
  });

  it("handles empty string", () => {
    expect(transform("")).toBe("");
  });

  it("handles string with only special chars", () => {
    expect(transform("---")).toBe("");
  });
});
