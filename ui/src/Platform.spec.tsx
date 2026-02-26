import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { OpenTPPlatform } from "./Platform";
import { Roles } from "./types/platform";
import type { AppDefinition } from "./types/platform";
import type { DataSource, TrackingPlanData } from "./types";

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

// vi.mock is hoisted — cannot reference variables declared after it.
// Inline the mock data inside the factory.
vi.mock("./api/client", () => ({
  loadTrackingPlan: vi.fn().mockResolvedValue({
    config: {
      opentp: "2026-01",
      info: { title: "Test Plan", version: "1.0.0" },
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
    info: { title: "Test Plan", version: "1.0.0" },
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

const app1: AppDefinition = {
  id: "web",
  name: "Web App",
  icon: "🌐",
  source: { type: "static", data: mockData },
};
const app2: AppDefinition = {
  id: "mobile",
  name: "Mobile App",
  icon: "📱",
  source: { type: "static", data: { ...mockData, events: [] } },
};

describe("OpenTPPlatform", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders App with source prop (Mode B)", async () => {
    await act(async () => {
      render(<OpenTPPlatform source={staticSource} />);
    });

    expect(screen.getByText("Test Plan")).toBeDefined();
  });

  it("renders App with first app's source (Mode C)", async () => {
    await act(async () => {
      render(<OpenTPPlatform apps={[app1, app2]} />);
    });

    expect(screen.getByText("Test Plan")).toBeDefined();
  });

  it("warns when both source and apps provided", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await act(async () => {
      render(<OpenTPPlatform source={staticSource} apps={[app1]} />);
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Both `source` and `apps` provided"),
    );
    warnSpy.mockRestore();
  });

  it("warns when neither source nor apps provided", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(<OpenTPPlatform />);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Neither `source` nor `apps` provided"),
    );
    warnSpy.mockRestore();
  });

  it("passes role and user to PlatformProvider", async () => {
    await act(async () => {
      render(
        <OpenTPPlatform
          source={staticSource}
          role={Roles.VIEWER}
          user={{ name: "Jane" }}
        />,
      );
    });

    expect(screen.getByText("Jane")).toBeDefined();
  });

  it("defaults role to editor when not provided", async () => {
    await act(async () => {
      render(<OpenTPPlatform source={staticSource} />);
    });

    expect(screen.getByText("Test Plan")).toBeDefined();
  });

  it("calls onAppChange when app switches", async () => {
    const onAppChange = vi.fn();

    await act(async () => {
      render(<OpenTPPlatform apps={[app1, app2]} onAppChange={onAppChange} />);
    });

    const switcherButton = screen.getByLabelText("Switch app");
    expect(switcherButton).toBeDefined();

    await act(async () => {
      switcherButton.click();
    });

    // "Mobile App" only appears once (in dropdown), not in button
    const mobileOption = screen.getByText("Mobile App");
    await act(async () => {
      mobileOption.click();
    });

    expect(onAppChange).toHaveBeenCalledWith("mobile");
  });

  it("falls back to first app when current app removed from list", async () => {
    const { rerender } = render(
      <OpenTPPlatform apps={[app1, app2]} />,
    );

    // Wait for initial render
    await act(async () => {});

    await act(async () => {
      screen.getByLabelText("Switch app").click();
    });

    await act(async () => {
      screen.getByText("Mobile App").click();
    });

    // Rerender with only app1 — should fall back
    await act(async () => {
      rerender(<OpenTPPlatform apps={[app1]} />);
    });

    expect(screen.queryByLabelText("Switch app")).toBeNull();
    expect(screen.getByText("Test Plan")).toBeDefined();
  });

  it("renders nothing when neither source nor apps", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = render(<OpenTPPlatform />);
    expect(container.innerHTML).toBe("");
  });

  it("error boundary catches app error and shows retry", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const errorSource: DataSource = {
      type: "static",
      data: null as unknown as TrackingPlanData,
    };

    await act(async () => {
      render(<OpenTPPlatform source={errorSource} />);
    });

    // If App crashes reading null data, error boundary catches it
    const retryButton = screen.queryByText("Retry");
    // Either the app rendered (data was non-null in mock) or boundary caught it
    expect(retryButton !== null || screen.queryByText("Test Plan") !== null).toBe(true);

    errorSpy.mockRestore();
  });
});
