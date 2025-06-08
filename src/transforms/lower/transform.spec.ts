import { describe, expect, it } from "vitest";
import { lower } from "./index";

describe("lower", () => {
  const transform = lower.factory();

  it("converts uppercase to lowercase", () => {
    expect(transform("HELLO")).toBe("hello");
  });

  it("keeps lowercase unchanged", () => {
    expect(transform("hello")).toBe("hello");
  });

  it("handles mixed case", () => {
    expect(transform("HeLLo WoRLd")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(transform("")).toBe("");
  });

  it("handles non-latin characters", () => {
    expect(transform("ÜBER")).toBe("über");
  });
});
