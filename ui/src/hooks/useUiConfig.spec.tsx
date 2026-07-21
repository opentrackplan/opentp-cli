import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "./useTheme";
import { useUiConfig } from "./useUiConfig";
import { Modes } from "../types";

// Wrap hook in ThemeProvider since useUiConfig calls useTheme
function wrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe("useUiConfig", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    // jsdom doesn't implement matchMedia
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reads ui config from API response", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          info: { title: "My Tracking Plan" },
          spec: {
            ui: {
              theme: "dark",
              mode: "editor",
              title: "Custom Title",
            },
          },
        }),
    });

    const { result } = renderHook(() => useUiConfig(""), { wrapper });

    await waitFor(() => expect(result.current.title).toBe("Custom Title"));

    expect(result.current.theme).toBe("dark");
    expect(result.current.mode).toBe(Modes.EDITOR);
  });

  it("applies default theme (auto) when not configured", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          info: { title: "Plan" },
          spec: {},
        }),
    });

    const { result } = renderHook(() => useUiConfig(""), { wrapper });

    await waitFor(() => expect(result.current.title).toBe("Plan"));

    expect(result.current.theme).toBe("auto");
  });

  it("applies default mode (viewer) when not configured", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          info: { title: "Plan" },
          spec: {},
        }),
    });

    const { result } = renderHook(() => useUiConfig(""), { wrapper });

    await waitFor(() => expect(result.current.title).toBe("Plan"));

    expect(result.current.mode).toBe(Modes.VIEWER);
  });

  it("returns configured title", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          info: { title: "Fallback Title" },
          spec: {
            ui: { title: "Explicit Title" },
          },
        }),
    });

    const { result } = renderHook(() => useUiConfig(""), { wrapper });

    await waitFor(() =>
      expect(result.current.title).toBe("Explicit Title"),
    );
  });
});
