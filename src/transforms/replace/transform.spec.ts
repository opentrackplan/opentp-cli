import { describe, expect, it } from "vitest";
import { replace } from "./index";

describe("replace", () => {
  it("replaces pattern with string", () => {
    const transform = replace.factory({ pattern: "\\s+", with: "_" });
    expect(transform("hello world")).toBe("hello_world");
  });

  it("replaces all occurrences by default", () => {
    const transform = replace.factory({ pattern: "a", with: "X" });
    expect(transform("banana")).toBe("bXnXnX");
  });

  it("can limit to first occurrence with flags", () => {
    const transform = replace.factory({ pattern: "a", with: "X", flags: "" });
    expect(transform("banana")).toBe("bXnana");
  });

  it("removes matched text when with is empty", () => {
    const transform = replace.factory({ pattern: "[0-9]", with: "" });
    expect(transform("abc123def")).toBe("abcdef");
  });

  it("handles empty pattern", () => {
    const transform = replace.factory({ pattern: "", with: "X" });
    expect(transform("hello")).toBe("hello");
  });

  it("handles no params", () => {
    const transform = replace.factory();
    expect(transform("hello")).toBe("hello");
  });

  it("handles complex regex", () => {
    const transform = replace.factory({ pattern: "[^a-z0-9]", with: "-" });
    expect(transform("Hello World!")).toBe("-ello--orld-");
  });
});
