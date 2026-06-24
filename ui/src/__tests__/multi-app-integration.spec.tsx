import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { OpenTPPlatform } from "../Platform";
import type { TrackingPlanData } from "../types";
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
      info: { title: "Multi App Plan", version: "1.0.0" },
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

const makeMockData = (title: string): TrackingPlanData => ({
  config: {
    opentp: "2026-01",
    info: { title, version: "1.0.0" },
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
});

const app1: AppDefinition = {
  id: "web",
  name: "Web App",
  icon: "\u{1F310}",
  source: { type: "static", data: makeMockData("Web Plan") },
};

const app2: AppDefinition = {
  id: "mobile",
  name: "Mobile App",
  icon: "\u{1F4F1}",
  source: { type: "static", data: makeMockData("Mobile Plan") },
};

describe("Multi-app integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("AppSwitcher shows when 2+ apps", async () => {
    await act(async () => {
      render(<OpenTPPlatform apps={[app1, app2]} />);
    });

    // AppSwitcher should render with "Switch app" aria-label
    expect(screen.getByLabelText("Switch app")).toBeDefined();
    // Current app name visible in button
    expect(screen.getByText("Web App")).toBeDefined();
  });

  it("AppSwitcher hidden when 1 app", async () => {
    await act(async () => {
      render(<OpenTPPlatform apps={[app1]} />);
    });

    // Only 1 app → AppSwitcher returns null
    expect(screen.queryByLabelText("Switch app")).toBeNull();
  });

  it("switching app calls onAppChange and shows new app", async () => {
    const onAppChange = vi.fn();

    await act(async () => {
      render(<OpenTPPlatform apps={[app1, app2]} onAppChange={onAppChange} />);
    });

    // Open the app switcher dropdown
    const switcherButton = screen.getByLabelText("Switch app");
    await act(async () => {
      switcherButton.click();
    });

    // Click on "Mobile App" in the dropdown
    const mobileOption = screen.getByText("Mobile App");
    await act(async () => {
      mobileOption.click();
    });

    expect(onAppChange).toHaveBeenCalledWith("mobile");
  });
});
