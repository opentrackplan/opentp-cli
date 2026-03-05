import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useGenerators } from "./useGenerators";

describe("useGenerators", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns empty array while loading", () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise(() => {}), // never resolves
    );

    const { result } = renderHook(() => useGenerators(""));

    expect(result.current.generators).toEqual([]);
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("fetches generator list from API on mount", async () => {
    const mockData = {
      generators: [
        { name: "ts-sdk", target: "web", standalone: true },
        { name: "swift-sdk", target: "ios" },
      ],
      bundleEnabled: true,
    };

    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const { result } = renderHook(() => useGenerators("http://localhost:3000"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/generators",
    );
  });

  it("returns generator list after successful fetch", async () => {
    const mockData = {
      generators: [
        { name: "ts-sdk", target: "web", standalone: true },
        { name: "swift-sdk", target: "ios" },
      ],
      bundleEnabled: true,
    };

    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const { result } = renderHook(() => useGenerators(""));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.generators).toEqual(mockData.generators);
    expect(result.current.bundleEnabled).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("handles API error gracefully", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => useGenerators(""));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.generators).toEqual([]);
    expect(result.current.error).toBe("HTTP 500");
  });
});
