import { describe, expect, it } from "vitest";
import { truncate } from "./index";

describe("truncate", () => {
  it("truncates string to maxLen", () => {
    const transform = truncate.factory({ maxLen: 5 });
    expect(transform("hello world")).toBe("hello");
  });

  it("does not truncate if string is shorter", () => {
    const transform = truncate.factory({ maxLen: 20 });
    expect(transform("hello")).toBe("hello");
  });

  it("does not truncate if string equals maxLen", () => {
    const transform = truncate.factory({ maxLen: 5 });
    expect(transform("hello")).toBe("hello");
  });

  it("handles no params", () => {
    const transform = truncate.factory();
    expect(transform("hello world")).toBe("hello world");
  });

  it("handles zero maxLen", () => {
    const transform = truncate.factory({ maxLen: 0 });
    expect(transform("hello")).toBe("hello");
  });

  it("handles negative maxLen", () => {
    const transform = truncate.factory({ maxLen: -1 });
    expect(transform("hello")).toBe("hello");
  });

  it("handles empty input", () => {
    const transform = truncate.factory({ maxLen: 5 });
    expect(transform("")).toBe("");
  });
});
