import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useGenerateDownload } from "./useGenerateDownload";

describe("useGenerateDownload", () => {
  const originalFetch = globalThis.fetch;
  const originalCreateElement = document.createElement.bind(document);
  const mockAnchor = { href: "", download: "", click: vi.fn() };

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    // Only intercept anchor element creation, pass through everything else
    document.createElement = ((tag: string) => {
      if (tag === "a") return mockAnchor as unknown as HTMLAnchorElement;
      return originalCreateElement(tag);
    }) as typeof document.createElement;
    URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    URL.revokeObjectURL = vi.fn();
    mockAnchor.click.mockReset();
    mockAnchor.href = "";
    mockAnchor.download = "";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.createElement = originalCreateElement;
  });

  it("triggers download for a specific generator", async () => {
    const blob = new Blob(["code"], { type: "text/plain" });
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      headers: new Headers({
        "Content-Disposition": 'attachment; filename="tracker.ts"',
      }),
      blob: () => Promise.resolve(blob),
    });

    const { result } = renderHook(() => useGenerateDownload(""));

    await act(async () => {
      result.current.download("ts-sdk", "web");
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/generate/ts-sdk?target=web",
    );
    expect(mockAnchor.download).toBe("tracker.ts");
    expect(mockAnchor.click).toHaveBeenCalled();
    expect(result.current.downloading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("triggers bundle download", async () => {
    const blob = new Blob(["zip"], { type: "application/zip" });
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      headers: new Headers({
        "Content-Disposition": 'attachment; filename="tracking-plan.zip"',
      }),
      blob: () => Promise.resolve(blob),
    });

    const { result } = renderHook(() => useGenerateDownload(""));

    await act(async () => {
      result.current.downloadBundle();
    });

    expect(globalThis.fetch).toHaveBeenCalledWith("/api/export/bundle");
    expect(mockAnchor.download).toBe("tracking-plan.zip");
    expect(mockAnchor.click).toHaveBeenCalled();
  });

  it("handles error response from API", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Generator not found" }),
    });

    const { result } = renderHook(() => useGenerateDownload(""));

    await act(async () => {
      result.current.download("unknown");
    });

    expect(result.current.error).toBe("Generator not found");
    expect(result.current.downloading).toBe(false);
  });

  it("shows loading state during download", async () => {
    let resolveBlob!: (blob: Blob) => void;
    const blobPromise = new Promise<Blob>((r) => {
      resolveBlob = r;
    });

    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      headers: new Headers(),
      blob: () => blobPromise,
    });

    const { result } = renderHook(() => useGenerateDownload(""));

    // Start the download (don't await)
    let downloadPromise: Promise<void>;
    act(() => {
      downloadPromise = result.current.download("ts-sdk") as unknown as Promise<void>;
    });

    // Should be downloading
    await waitFor(() => expect(result.current.downloading).toBe(true));

    // Resolve the blob
    await act(async () => {
      resolveBlob(new Blob(["code"]));
      await downloadPromise;
    });

    expect(result.current.downloading).toBe(false);
  });
});
