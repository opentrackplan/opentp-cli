import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { App } from "../App";
import { ThemeProvider } from "../hooks/useTheme";
import { I18nProvider } from "../i18n";
import { Modes } from "../types";
import type { TrackingPlanData, DataSource } from "../types";

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
      info: { title: "Backward Compat Plan", version: "2.0.0" },
      spec: {
        paths: { events: { root: "events", template: "{area}/{event}.yaml" } },
        targets: { web: { title: "Web" } },
        events: {
          taxonomy: { area: { title: "Area", type: "string" } },
          payload: { targets: {}, schema: {} },
        },
      },
    },
    events: [
      {
        key: "auth::login",
        relativePath: "auth/login.yaml",
        taxonomy: { area: "auth" },
        payload: {},
      },
    ],
    dictionaries: {},
    dictionaryMeta: {},
  }),
  checkApiHealth: vi.fn().mockResolvedValue(false),
}));

const mockData: TrackingPlanData = {
  config: {
    opentp: "2026-01",
    info: { title: "Backward Compat Plan", version: "2.0.0" },
    spec: {
      paths: { events: { root: "events", template: "{area}/{event}.yaml" } },
      targets: { web: { title: "Web" } },
      events: {
        taxonomy: { area: { title: "Area", type: "string" } },
        payload: { targets: {}, schema: {} },
      },
    },
  },
  events: [
    {
      key: "auth::login",
      relativePath: "auth/login.yaml",
      taxonomy: { area: "auth" },
      payload: {},
    },
  ],
  dictionaries: {},
  dictionaryMeta: {},
};

const staticSource: DataSource = { type: "static", data: mockData };

/** Mode A wrapper: ThemeProvider + I18nProvider, no PlatformProvider */
function ModeAWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>{children}</I18nProvider>
    </ThemeProvider>
  );
}

describe("Backward compatibility (Mode A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("App renders without PlatformProvider", async () => {
    await act(async () => {
      render(
        <ModeAWrapper>
          <App source={staticSource} />
        </ModeAWrapper>,
      );
    });

    // Layout renders with the plan title
    expect(screen.getByText("Backward Compat Plan")).toBeDefined();
  });

  it("editor mode works without PlatformProvider", async () => {
    const apiSource: DataSource = { type: "api", baseUrl: "" };

    await act(async () => {
      render(
        <ModeAWrapper>
          <App source={apiSource} mode={Modes.EDITOR} />
        </ModeAWrapper>,
      );
    });

    // "New Event" button should be visible (canEdit=true because role defaults to editor)
    expect(screen.getByText("+ New Event")).toBeDefined();
  });

  it("search works without PlatformProvider", async () => {
    await act(async () => {
      render(
        <ModeAWrapper>
          <App source={staticSource} />
        </ModeAWrapper>,
      );
    });

    // Search input is present and functional
    const searchInput = screen.getByPlaceholderText("Search events...");
    expect(searchInput).toBeDefined();
  });

  it("no UserMenu visible in Mode A", async () => {
    await act(async () => {
      render(
        <ModeAWrapper>
          <App source={staticSource} />
        </ModeAWrapper>,
      );
    });

    // UserMenu returns null when no PlatformProvider user — no user-related elements
    // "Log out" button and role badges should be absent; no menu dropdown
    expect(screen.queryByText("Log out")).toBeNull();
    expect(screen.queryByText("Admin")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("no AppSwitcher visible in Mode A", async () => {
    await act(async () => {
      render(
        <ModeAWrapper>
          <App source={staticSource} />
        </ModeAWrapper>,
      );
    });

    // AppSwitcher returns null when no apps — "Switch app" button should not exist
    expect(screen.queryByLabelText("Switch app")).toBeNull();
  });
});
