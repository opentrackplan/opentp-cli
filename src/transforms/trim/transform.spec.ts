import { describe, expect, it } from "vitest";
import { trim } from "./index";

describe("trim", () => {
  it("trims specified characters from edges", () => {
    const transform = trim.factory({ chars: "_" });
    expect(transform("__hello__")).toBe("hello");
  });

  it("trims from start only", () => {
    const transform = trim.factory({ chars: "_" });
    expect(transform("___hello")).toBe("hello");
  });

  it("trims from end only", () => {
    const transform = trim.factory({ chars: "_" });
    expect(transform("hello___")).toBe("hello");
  });

  it("keeps characters in the middle", () => {
    const transform = trim.factory({ chars: "_" });
    expect(transform("__hello_world__")).toBe("hello_world");
  });

  it("trims multiple character types", () => {
    const transform = trim.factory({ chars: "_-" });
    expect(transform("-_hello_-")).toBe("hello");
  });

  it("trims whitespace by default", () => {
    const transform = trim.factory();
    expect(transform("  hello  ")).toBe("hello");
  });

  it("handles empty chars as whitespace trim", () => {
    const transform = trim.factory({ chars: "" });
    expect(transform("  hello  ")).toBe("hello");
  });

  it("handles empty input", () => {
    const transform = trim.factory({ chars: "_" });
    expect(transform("")).toBe("");
  });
});
