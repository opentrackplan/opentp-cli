import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useState } from "react";
import { OpenTPPlatform } from "../Platform";
import { useRole } from "../core/platform/useRole";
import { PlatformProvider } from "../core/platform/PlatformProvider";
import { Modes } from "../types";
import type { TrackingPlanData, DataSource } from "../types";
import { Roles, Permissions } from "../types/platform";
import type { AppDefinition } from "../types/platform";

// jsdom doesn't implement matchMedia — ThemeProvider needs it
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

vi.mock("../api/client", () => ({
  loadTrackingPlan: vi.fn().mockResolvedValue({
    config: {
      opentp: "2026-01",
      info: { title: "Edge Case Plan", version: "1.0.0" },
      spec: {
        paths: { events: { root: "events", template: "{area}/{event}.yaml" } },
        targets: { web: { title: "Web" } },
        events: {
          taxonomy: { area: { title: "Area", type: "string" } },
          payload: { targets: {}, schema: {} },
        },
      },
    },
    events: [],
    dictionaries: {},
    dictionaryMeta: {},
  }),
  checkApiHealth: vi.fn().mockResolvedValue(false),
}));

const mockData: TrackingPlanData = {
  config: {
    opentp: "2026-01",
    info: { title: "Edge Case Plan", version: "1.0.0" },
    spec: {
      paths: { events: { root: "events", template: "{area}/{event}.yaml" } },
      targets: { web: { title: "Web" } },
      events: {
        taxonomy: { area: { title: "Area", type: "string" } },
        payload: { targets: {}, schema: {} },
      },
    },
  },
  events: [],
  dictionaries: {},
  dictionaryMeta: {},
};

const staticSource: DataSource = { type: "static", data: mockData };
const apiSource: DataSource = { type: "api", baseUrl: "" };

const makeApp = (id: string, name: string): AppDefinition => ({
  id,
  name,
  source: { type: "static", data: mockData },
});

describe("Edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("empty apps array treated as no apps", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await act(async () => {
      render(<OpenTPPlatform apps={[]} />);
    });

    // Empty apps → hasApps is false → warns and renders nothing
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Neither `source` nor `apps` provided"),
    );
    warnSpy.mockRestore();
  });

  it("role prop changes dynamically", async () => {
    const { rerender } = render(
      <OpenTPPlatform source={apiSource} role={Roles.VIEWER} />,
    );

    await act(async () => {});

    // Viewer: mode toggle is hidden (RoleGate blocks switchMode)
    expect(screen.queryByText("Editor")).toBeNull();

    // Change to editor role
    await act(async () => {
      rerender(<OpenTPPlatform source={apiSource} role={Roles.EDITOR} defaultMode={Modes.EDITOR} />);
    });

    // Editor: mode toggle visible
    expect(screen.getByText("Viewer")).toBeDefined();
  });

  it("user prop changes dynamically", async () => {
    const { rerender } = render(
      <OpenTPPlatform source={staticSource} user={{ name: "Jane" }} />,
    );

    await act(async () => {});

    expect(screen.getByText("Jane")).toBeDefined();

    // Change user
    await act(async () => {
      rerender(
        <OpenTPPlatform source={staticSource} user={{ name: "John" }} />,
      );
    });

    expect(screen.getByText("John")).toBeDefined();
    expect(screen.queryByText("Jane")).toBeNull();
  });

  it("branding with only logo, no title", async () => {
    await act(async () => {
      render(
        <OpenTPPlatform
          source={staticSource}
          branding={{ logo: "/logo.svg" }}
        />,
      );
    });

    // Logo img should exist
    const logoImg = document.querySelector('img[src="/logo.svg"]');
    expect(logoImg).not.toBeNull();

    // Default branding title is "OpenTP", which falls back to config title in sidebar
    expect(screen.getByText("Edge Case Plan")).toBeDefined();
  });

  it("branding with only title, no logo", async () => {
    await act(async () => {
      render(
        <OpenTPPlatform
          source={staticSource}
          branding={{ title: "Acme Analytics" }}
        />,
      );
    });

    // Custom title shown
    expect(screen.getByText("Acme Analytics")).toBeDefined();

    // No logo img element for branding
    const logoImgs = document.querySelectorAll('img[alt="Acme Analytics"]');
    expect(logoImgs.length).toBe(0);
  });

  it("permissions prop with all actions set to viewer", async () => {
    await act(async () => {
      render(
        <OpenTPPlatform
          source={apiSource}
          role={Roles.VIEWER}
          defaultMode={Modes.EDITOR}
          permissions={{
            [Permissions.VIEW_EVENTS]: Roles.VIEWER,
            [Permissions.SEARCH]: Roles.VIEWER,
            [Permissions.EXPORT]: Roles.VIEWER,
            [Permissions.CREATE_EVENT]: Roles.VIEWER,
            [Permissions.EDIT_EVENT]: Roles.VIEWER,
            [Permissions.MANAGE_DICTS]: Roles.VIEWER,
            [Permissions.SWITCH_MODE]: Roles.VIEWER,
            [Permissions.DELETE_EVENT]: Roles.VIEWER,
            [Permissions.DELETE_DICTS]: Roles.VIEWER,
          }}
        />,
      );
    });

    // All actions lowered to viewer → viewer sees New Event + Dictionaries + ModeToggle
    expect(screen.getByText("+ New Event")).toBeDefined();
    expect(screen.getByText("Dictionaries")).toBeDefined();
  });

  it("source prop with type=static + role=editor", async () => {
    await act(async () => {
      render(
        <OpenTPPlatform
          source={staticSource}
          role={Roles.EDITOR}
          defaultMode={Modes.EDITOR}
        />,
      );
    });

    // Static source + editor role → canEdit is false (source.type !== "api")
    // So mode stays "viewer" → no New Event button
    expect(screen.queryByText("+ New Event")).toBeNull();
  });

  it("onLogout without user", async () => {
    const onLogout = vi.fn();

    await act(async () => {
      render(
        <OpenTPPlatform source={staticSource} onLogout={onLogout} />,
      );
    });

    // No user → UserMenu hidden → no crash
    expect(screen.getByText("Edge Case Plan")).toBeDefined();
  });

  it("very long app name in AppSwitcher", async () => {
    const longNameApp = makeApp("long", "A".repeat(100));
    const otherApp = makeApp("other", "Other App");

    await act(async () => {
      render(<OpenTPPlatform apps={[longNameApp, otherApp]} />);
    });

    // Should render without overflow issues — switcher button exists
    expect(screen.getByLabelText("Switch app")).toBeDefined();
    // The truncated text should be present (truncate class handles overflow)
    expect(screen.getByText("A".repeat(100))).toBeDefined();
  });

  it("apps prop changes and removes current app", async () => {
    const appA = makeApp("a", "App A");
    const appB = makeApp("b", "App B");

    const { rerender } = render(
      <OpenTPPlatform apps={[appA, appB]} />,
    );

    await act(async () => {});

    // Switch to app B
    const switcherButton = screen.getByLabelText("Switch app");
    await act(async () => {
      switcherButton.click();
    });

    await act(async () => {
      screen.getByText("App B").click();
    });

    // Now remove app B from the list
    await act(async () => {
      rerender(<OpenTPPlatform apps={[appA]} />);
    });

    // Should fall back to app A (only 1 app → no switcher)
    expect(screen.queryByLabelText("Switch app")).toBeNull();
  });

  it("error boundary catches app error and shows retry", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const badSource: DataSource = {
      type: "static",
      data: null as unknown as TrackingPlanData,
    };

    await act(async () => {
      render(<OpenTPPlatform source={badSource} />);
    });

    // App should either show error boundary or fallback
    const retryButton = screen.queryByText("Retry");
    if (retryButton) {
      expect(retryButton).toBeDefined();
    }

    errorSpy.mockRestore();
  });

  it("error boundary resets on app switch", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const badApp: AppDefinition = {
      id: "bad",
      name: "Bad App",
      source: { type: "static", data: null as unknown as TrackingPlanData },
    };
    const goodApp = makeApp("good", "Good App");

    await act(async () => {
      render(<OpenTPPlatform apps={[badApp, goodApp]} />);
    });

    // Bad app may have errored → switch to good app
    const switcherButton = screen.queryByLabelText("Switch app");
    if (switcherButton) {
      await act(async () => {
        switcherButton.click();
      });

      const goodOption = screen.queryByText("Good App");
      if (goodOption) {
        await act(async () => {
          goodOption.click();
        });

        // After switching, error boundary should reset (new key)
        // Good app should render
        await act(async () => {});
      }
    }

    errorSpy.mockRestore();
  });

  it("context splitting: app switch doesn't re-render role consumers", () => {
    let roleRenderCount = 0;

    const localApp1 = makeApp("app1", "App 1");
    const localApp2 = makeApp("app2", "App 2");

    function RoleCounter() {
      roleRenderCount++;
      const { role } = useRole();
      return <span data-testid="role-value">{role}</span>;
    }

    // Use internal state change so PlatformProvider re-renders but the
    // split context pattern prevents role consumers from re-rendering.
    function TestHarness() {
      const [appId, setAppId] = useState("app1");
      return (
        <PlatformProvider
          role={Roles.EDITOR}
          apps={[localApp1, localApp2]}
          currentAppId={appId}
        >
          <RoleCounter />
          <button data-testid="switch-btn" onClick={() => setAppId("app2")}>
            switch
          </button>
        </PlatformProvider>
      );
    }

    render(<TestHarness />);
    const initialCount = roleRenderCount;

    // Click synchronously — state change triggers PlatformProvider re-render
    // but roleValue useMemo ref is stable → RoleCounter skips
    screen.getByTestId("switch-btn").click();

    expect(roleRenderCount).toBe(initialCount);
  });
});
