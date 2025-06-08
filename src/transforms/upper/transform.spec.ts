import { describe, expect, it } from "vitest";
import { upper } from "./index";

describe("upper", () => {
  const transform = upper.factory();

  it("converts lowercase to uppercase", () => {
    expect(transform("hello")).toBe("HELLO");
  });

  it("keeps uppercase unchanged", () => {
    expect(transform("HELLO")).toBe("HELLO");
  });

  it("handles mixed case", () => {
    expect(transform("HeLLo WoRLd")).toBe("HELLO WORLD");
  });

  it("handles empty string", () => {
    expect(transform("")).toBe("");
  });

  it("handles non-latin characters", () => {
    expect(transform("über")).toBe("ÜBER");
  });
});
