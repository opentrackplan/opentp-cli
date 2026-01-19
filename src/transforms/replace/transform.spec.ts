import { describe, expect, it } from "vitest";
import { replace } from "./index";

describe("replace", () => {
  it("replaces literal substring with string", () => {
    const transform = replace.factory({ from: " ", to: "_" });
    expect(transform("hello world")).toBe("hello_world");
  });

  it("replaces all occurrences by default", () => {
    const transform = replace.factory({ from: "a", to: "X" });
    expect(transform("banana")).toBe("bXnXnX");
  });

  it("removes substring when to is empty", () => {
    const transform = replace.factory({ from: "123", to: "" });
    expect(transform("abc123def")).toBe("abcdef");
  });

  it("handles empty from", () => {
    const transform = replace.factory({ from: "", to: "X" });
    expect(transform("hello")).toBe("hello");
  });

  it("handles no params", () => {
    const transform = replace.factory();
    expect(transform("hello")).toBe("hello");
  });

  it("does not treat from as regex", () => {
    const transform = replace.factory({ from: "[^a-z0-9]", to: "-" });
    expect(transform("Hello World!")).toBe("Hello World!");
  });
});
