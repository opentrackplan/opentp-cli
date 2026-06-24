import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolvePlatformConfig, parseJsonAttr } from "./resolvePlatformConfig";
import type { PlatformJsonConfig } from "../types/platform";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("resolvePlatformConfig", () => {
  it("returns parsed attributes when no config URL", async () => {
    const attrs: Partial<PlatformJsonConfig> = {
      role: "viewer",
      apps: [
        {
          id: "web",
          name: "Web App",
          source: { type: "api", baseUrl: "/api" },
        },
      ],
    };

    const result = await resolvePlatformConfig(null, attrs);

    expect(result.error).toBeUndefined();
    expect(result.config?.role).toBe("viewer");
    expect(result.config?.apps).toHaveLength(1);
    expect(result.config?.apps?.[0].id).toBe("web");
  });

  it("fetches and parses config URL", async () => {
    const serverConfig: PlatformJsonConfig = {
      role: "editor",
      apps: [
        {
          id: "mobile",
          name: "Mobile",
          source: { type: "api", baseUrl: "/api/mobile" },
        },
      ],
      branding: { title: "Acme" },
    };

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(serverConfig),
    } as Response);

    const result = await resolvePlatformConfig(
      "https://example.com/config",
      {},
    );

    expect(result.error).toBeUndefined();
    expect(result.config?.role).toBe("editor");
    expect(result.config?.apps?.[0].id).toBe("mobile");
    expect(result.config?.branding?.title).toBe("Acme");
  });

  it("attributes override config URL values", async () => {
    const serverConfig: PlatformJsonConfig = {
      role: "viewer",
      branding: { title: "Server Title" },
    };

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(serverConfig),
    } as Response);

    const result = await resolvePlatformConfig(
      "https://example.com/config",
      { role: "admin" },
    );

    expect(result.config?.role).toBe("admin");
    // Non-overridden values preserved from server
    expect(result.config?.branding?.title).toBe("Server Title");
  });

  it("handles fetch error gracefully", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(
      new Error("Network failure"),
    );

    const result = await resolvePlatformConfig(
      "https://example.com/config",
      {},
    );

    expect(result.error).toBe("fetch-error");
    expect(result.errorMessage).toContain("Network failure");
    expect(result.config).toBeUndefined();
  });

  it("handles 401 response", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    } as Response);

    const result = await resolvePlatformConfig(
      "https://example.com/config",
      {},
    );

    expect(result.error).toBe("unauthorized");
    expect(result.errorMessage).toBe("Not authenticated");
  });

  it("handles non-401 error response", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    } as Response);

    const result = await resolvePlatformConfig(
      "https://example.com/config",
      {},
    );

    expect(result.error).toBe("fetch-error");
    expect(result.errorMessage).toContain("500");
  });

  it("handles malformed config URL response", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("Invalid JSON")),
    } as Response);

    const result = await resolvePlatformConfig(
      "https://example.com/config",
      {},
    );

    expect(result.error).toBe("parse-error");
    expect(result.errorMessage).toContain("invalid JSON");
  });

  it("sends credentials with fetch", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as Response);

    await resolvePlatformConfig("https://example.com/config", {});

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://example.com/config",
      { credentials: "include" },
    );
  });

  it("handles missing config URL and no attributes", async () => {
    const result = await resolvePlatformConfig(null, {});

    expect(result.error).toBeUndefined();
    expect(result.config).toEqual({});
  });
});

describe("parseJsonAttr", () => {
  it("returns parsed JSON for valid input", () => {
    const result = parseJsonAttr<{ title: string }>(
      "branding",
      '{"title":"Acme"}',
    );
    expect(result).toEqual({ title: "Acme" });
  });

  it("returns undefined for null input", () => {
    expect(parseJsonAttr("branding", null)).toBeUndefined();
  });

  it("warns on console and returns undefined for invalid JSON", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = parseJsonAttr("apps", "not json");

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid JSON"),
      "not json",
    );
  });

  it("parses arrays", () => {
    const result = parseJsonAttr<string[]>("apps", '[{"id":"web"}]');
    expect(result).toEqual([{ id: "web" }]);
  });
});
