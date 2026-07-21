import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { createTestWrapper, createBareWrapper } from "../../test-utils";
import { useBranding } from "./useBranding";

describe("useBranding", () => {
  it("returns defaults when no branding", () => {
    const wrapper = createTestWrapper({});
    const { result } = renderHook(() => useBranding(), { wrapper });
    expect(result.current.title).toBe("OpenTP");
    expect(result.current.accentColor).toBe("blue");
    expect(result.current.logo).toBeUndefined();
    expect(result.current.favicon).toBeUndefined();
  });

  it("returns provided branding values", () => {
    const wrapper = createTestWrapper({
      branding: { title: "Acme", logo: "/logo.svg", accentColor: "rose" },
    });
    const { result } = renderHook(() => useBranding(), { wrapper });
    expect(result.current.title).toBe("Acme");
    expect(result.current.logo).toBe("/logo.svg");
    expect(result.current.accentColor).toBe("rose");
  });

  it("no provider → returns defaults", () => {
    const wrapper = createBareWrapper();
    const { result } = renderHook(() => useBranding(), { wrapper });
    expect(result.current.title).toBe("OpenTP");
    expect(result.current.accentColor).toBe("blue");
  });

  it("returns default accent classes (blue) when no branding", () => {
    const wrapper = createTestWrapper({});
    const { result } = renderHook(() => useBranding(), { wrapper });
    expect(result.current.accentClasses.bg).toBe("bg-accent-blue");
    expect(result.current.accentClasses.hover).toBe("hover:bg-accent-blue/80");
    expect(result.current.accentClasses.text).toBe("text-accent-blue");
    expect(result.current.accentClasses.bgLight).toBe("bg-accent-blue-bg");
    expect(result.current.accentClasses.border).toBe("border-accent-blue-border");
  });

  it("returns correct accent classes for custom color", () => {
    const wrapper = createTestWrapper({
      branding: { accentColor: "rose" },
    });
    const { result } = renderHook(() => useBranding(), { wrapper });
    expect(result.current.accentClasses.bg).toBe("bg-accent-rose");
    expect(result.current.accentClasses.hover).toBe("hover:bg-accent-rose/80");
  });

  it("falls back to blue for unknown accent color", () => {
    const wrapper = createTestWrapper({
      branding: { accentColor: "magenta" as any },
    });
    const { result } = renderHook(() => useBranding(), { wrapper });
    expect(result.current.accentClasses.bg).toBe("bg-accent-blue");
  });

  it("returns custom title", () => {
    const wrapper = createTestWrapper({
      branding: { title: "Acme" },
    });
    const { result } = renderHook(() => useBranding(), { wrapper });
    expect(result.current.title).toBe("Acme");
  });

  it("returns logo URL", () => {
    const wrapper = createTestWrapper({
      branding: { logo: "/logo.svg" },
    });
    const { result } = renderHook(() => useBranding(), { wrapper });
    expect(result.current.logo).toBe("/logo.svg");
  });
});
