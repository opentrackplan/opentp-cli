import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createTestWrapper, createBareWrapper } from "../../test-utils";
import { useCurrentApp } from "./useCurrentApp";
import type { AppDefinition } from "../../types/platform";

const app1: AppDefinition = {
  id: "app1",
  name: "Web App",
  source: { type: "api", baseUrl: "/api/web" },
};

const app2: AppDefinition = {
  id: "app2",
  name: "Mobile App",
  source: { type: "api", baseUrl: "/api/mobile" },
};

describe("useCurrentApp", () => {
  it("returns undefined app when no apps", () => {
    const wrapper = createTestWrapper({ apps: [] });
    const { result } = renderHook(() => useCurrentApp(), { wrapper });
    expect(result.current.app).toBeUndefined();
    expect(result.current.apps).toEqual([]);
  });

  it("returns first app as default", () => {
    const wrapper = createTestWrapper({ apps: [app1, app2] });
    const { result } = renderHook(() => useCurrentApp(), { wrapper });
    expect(result.current.app).toEqual(app1);
  });

  it("switchApp changes current app", () => {
    const wrapper = createTestWrapper({ apps: [app1, app2] });
    const { result } = renderHook(() => useCurrentApp(), { wrapper });

    act(() => {
      result.current.switchApp("app2");
    });

    expect(result.current.app).toEqual(app2);
  });

  it("switchApp with invalid ID stays on current and warns", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = createTestWrapper({ apps: [app1, app2] });
    const { result } = renderHook(() => useCurrentApp(), { wrapper });

    act(() => {
      result.current.switchApp("nonexistent");
    });

    expect(result.current.app).toEqual(app1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("nonexistent"),
    );
    warnSpy.mockRestore();
  });

  it("no provider → returns empty state", () => {
    const wrapper = createBareWrapper();
    const { result } = renderHook(() => useCurrentApp(), { wrapper });
    expect(result.current.apps).toEqual([]);
    expect(result.current.app).toBeUndefined();
  });
});
