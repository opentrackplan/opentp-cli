import { describe, expect, it } from "vitest";
import { transliterate } from "./index";

describe("transliterate", () => {
  // German umlauts mapping
  const germanMap = {
    ä: "ae",
    ö: "oe",
    ü: "ue",
    ß: "ss",
  };

  // Greek alphabet mapping
  const greekMap = {
    α: "a",
    β: "b",
    γ: "g",
    δ: "d",
    ε: "e",
    ζ: "z",
    η: "h",
    θ: "th",
    ι: "i",
    κ: "k",
    λ: "l",
    μ: "m",
  };

  it("transliterates characters using provided map", () => {
    const transform = transliterate.factory({ map: germanMap });
    expect(transform("über")).toBe("ueber");
  });

  it("preserves case (capitalizes first char of mapping)", () => {
    const transform = transliterate.factory({ map: germanMap });
    expect(transform("Über")).toBe("Ueber");
    // Only first char of mapping is capitalized: Ü -> Ue, rest unchanged
    expect(transform("ÜBER")).toBe("UeBER");
  });

  it("keeps unmapped characters", () => {
    const transform = transliterate.factory({ map: germanMap });
    expect(transform("hello wörld")).toBe("hello woerld");
  });

  it("handles multi-character mappings", () => {
    const transform = transliterate.factory({ map: greekMap });
    expect(transform("θεμα")).toBe("thema");
  });

  it("handles empty map", () => {
    const transform = transliterate.factory({ map: {} });
    expect(transform("hello")).toBe("hello");
  });

  it("handles empty string", () => {
    const transform = transliterate.factory({ map: germanMap });
    expect(transform("")).toBe("");
  });

  it("works with custom mappings", () => {
    const transform = transliterate.factory({
      map: { ñ: "n", ç: "c", é: "e" },
    });
    expect(transform("señor")).toBe("senor");
    expect(transform("façade")).toBe("facade");
    expect(transform("café")).toBe("cafe");
  });
});
