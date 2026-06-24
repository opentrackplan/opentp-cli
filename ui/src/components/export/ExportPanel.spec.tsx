import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nProvider } from "../../i18n";
import { ExportPanel } from "./ExportPanel";

function Wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

describe("ExportPanel", () => {
  const originalFetch = globalThis.fetch;
  const originalCreateElement = document.createElement.bind(document);

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    URL.createObjectURL = vi.fn().mockReturnValue("blob:mock");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.createElement = originalCreateElement;
  });

  function mockGeneratorsResponse(
    generators: Array<{ name: string; target?: string; standalone?: boolean }>,
    bundleEnabled = false,
  ) {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ generators, bundleEnabled }),
    });
  }

  it("renders one download button per generator", async () => {
    mockGeneratorsResponse([
      { name: "ts-sdk", target: "web", standalone: true },
      { name: "swift-sdk", target: "ios" },
      { name: "kotlin-sdk", target: "android" },
    ]);

    render(<ExportPanel baseUrl="" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText("TypeScript SDK")).toBeDefined();
    });

    expect(screen.getByText("Swift SDK")).toBeDefined();
    expect(screen.getByText("Kotlin SDK")).toBeDefined();
  });

  it("renders Export Bundle button when bundleEnabled is true", async () => {
    mockGeneratorsResponse(
      [{ name: "ts-sdk", target: "web" }],
      true,
    );

    render(<ExportPanel baseUrl="" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText("Export Bundle")).toBeDefined();
    });
  });

  it("hides Export Bundle button when bundleEnabled is false", async () => {
    mockGeneratorsResponse(
      [{ name: "ts-sdk", target: "web" }],
      false,
    );

    render(<ExportPanel baseUrl="" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText("TypeScript SDK")).toBeDefined();
    });

    expect(screen.queryByText("Export Bundle")).toBeNull();
  });

  it("triggers download on button click", async () => {
    mockGeneratorsResponse([{ name: "ts-sdk", target: "web" }]);

    render(<ExportPanel baseUrl="" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText("TypeScript SDK")).toBeDefined();
    });

    // Set up fetch mock for the download call
    const blob = new Blob(["code"]);
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      headers: new Headers(),
      blob: () => Promise.resolve(blob),
    });

    const mockAnchor = { href: "", download: "", click: vi.fn() };
    document.createElement = ((tag: string) => {
      if (tag === "a") return mockAnchor as unknown as HTMLAnchorElement;
      return originalCreateElement(tag);
    }) as typeof document.createElement;

    fireEvent.click(screen.getByText("TypeScript SDK"));

    await waitFor(() => {
      expect(mockAnchor.click).toHaveBeenCalled();
    });
  });

  it("shows loading state during download", async () => {
    mockGeneratorsResponse([{ name: "ts-sdk" }]);

    render(<ExportPanel baseUrl="" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText("TypeScript SDK")).toBeDefined();
    });

    // Set up a long-running fetch for the download
    let resolveBlob!: (b: Blob) => void;
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      headers: new Headers(),
      blob: () => new Promise<Blob>((r) => { resolveBlob = r; }),
    });

    const mockAnchor = { href: "", download: "", click: vi.fn() };
    document.createElement = ((tag: string) => {
      if (tag === "a") return mockAnchor as unknown as HTMLAnchorElement;
      return originalCreateElement(tag);
    }) as typeof document.createElement;

    fireEvent.click(screen.getByText("TypeScript SDK"));

    await waitFor(() => {
      expect(screen.getByText("Downloading...")).toBeDefined();
    });

    // Clean up
    resolveBlob(new Blob(["code"]));
  });

  it("shows target labels (web, ios, android) on buttons", async () => {
    mockGeneratorsResponse([
      { name: "ts-sdk", target: "web" },
      { name: "swift-sdk", target: "ios" },
      { name: "kotlin-sdk", target: "android" },
    ]);

    render(<ExportPanel baseUrl="" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText("TypeScript SDK")).toBeDefined();
    });

    expect(screen.getByTestId("target-ts-sdk").textContent).toBe("Web");
    expect(screen.getByTestId("target-swift-sdk").textContent).toBe("iOS");
    expect(screen.getByTestId("target-kotlin-sdk").textContent).toBe("Android");
  });
});
