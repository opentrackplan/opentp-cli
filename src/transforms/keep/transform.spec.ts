import { describe, expect, it } from "vitest";
import { keep } from "./index";

describe("keep", () => {
  it("keeps only specified characters", () => {
    const transform = keep.factory({ chars: "a-z" });
    expect(transform("Hello World 123")).toBe("elloorld");
  });

  it("keeps alphanumeric characters", () => {
    const transform = keep.factory({ chars: "a-zA-Z0-9" });
    expect(transform("Hello, World! 123")).toBe("HelloWorld123");
  });

  it("keeps with underscore", () => {
    const transform = keep.factory({ chars: "a-z0-9_" });
    expect(transform("hello_world 123!")).toBe("hello_world123");
  });

  it("keeps with special characters", () => {
    const transform = keep.factory({ chars: "a-z:" });
    expect(transform("hello::world")).toBe("hello::world");
  });

  it("handles empty chars", () => {
    const transform = keep.factory({ chars: "" });
    expect(transform("hello")).toBe("hello");
  });

  it("handles no params", () => {
    const transform = keep.factory();
    expect(transform("hello")).toBe("hello");
  });

  it("handles empty input", () => {
    const transform = keep.factory({ chars: "a-z" });
    expect(transform("")).toBe("");
  });
});
