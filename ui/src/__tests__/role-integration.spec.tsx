import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { OpenTPPlatform } from "../Platform";
import { Modes } from "../types";
import type { DataSource } from "../types";
import { Roles, Permissions } from "../types/platform";

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
      info: { title: "Role Test Plan", version: "1.0.0" },
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

const apiSource: DataSource = { type: "api", baseUrl: "" };

describe("Role-based rendering integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("viewer cannot see New Event button", async () => {
    await act(async () => {
      render(
        <OpenTPPlatform source={apiSource} role={Roles.VIEWER} />,
      );
    });

    // viewer role: canEdit is false → mode stays "viewer" → New Event button is inside editor mode block
    // Even if we tried editor mode, RoleGate would block createEvent
    expect(screen.queryByText("+ New Event")).toBeNull();
  });

  it("viewer cannot see ModeToggle", async () => {
    await act(async () => {
      render(
        <OpenTPPlatform source={apiSource} role={Roles.VIEWER} />,
      );
    });

    // ModeToggle is wrapped in RoleGate action="switchMode" which requires editor+
    // Viewer cannot see mode toggle text buttons
    expect(screen.queryByText("Editor")).toBeNull();
  });

  it("viewer cannot see Manage Dictionaries button", async () => {
    await act(async () => {
      render(
        <OpenTPPlatform source={apiSource} role={Roles.VIEWER} />,
      );
    });

    // Dictionaries button is wrapped in RoleGate action="manageDicts"
    expect(screen.queryByText("Dictionaries")).toBeNull();
  });

  it("editor can see New Event and ModeToggle", async () => {
    await act(async () => {
      render(
        <OpenTPPlatform source={apiSource} role={Roles.EDITOR} defaultMode={Modes.EDITOR} />,
      );
    });

    // Editor mode: New Event button visible via RoleGate action="createEvent"
    expect(screen.getByText("+ New Event")).toBeDefined();

    // ModeToggle visible via RoleGate action="switchMode"
    expect(screen.getByText("Viewer")).toBeDefined();
  });

  it("admin can see everything including ModeToggle", async () => {
    await act(async () => {
      render(
        <OpenTPPlatform source={apiSource} role={Roles.ADMIN} defaultMode={Modes.EDITOR} />,
      );
    });

    expect(screen.getByText("+ New Event")).toBeDefined();
    expect(screen.getByText("Viewer")).toBeDefined();
    // Dictionaries button also visible
    expect(screen.getByText("Dictionaries")).toBeDefined();
  });

  it("custom permissions: viewer can create events", async () => {
    await act(async () => {
      render(
        <OpenTPPlatform
          source={apiSource}
          role={Roles.VIEWER}
          defaultMode={Modes.EDITOR}
          permissions={{ [Permissions.CREATE_EVENT]: Roles.VIEWER, [Permissions.EDIT_EVENT]: Roles.VIEWER, [Permissions.SWITCH_MODE]: Roles.VIEWER }}
        />,
      );
    });

    // With permissions override, viewer can see New Event
    expect(screen.getByText("+ New Event")).toBeDefined();
  });

  it("authorize callback overrides everything", async () => {
    const authorize = vi.fn().mockReturnValue(false);

    await act(async () => {
      render(
        <OpenTPPlatform
          source={apiSource}
          role={Roles.ADMIN}
          authorize={authorize}
        />,
      );
    });

    // authorize always returns false → canEdit is false → mode stays viewer → no New Event
    expect(screen.queryByText("+ New Event")).toBeNull();
    // authorize should have been called
    expect(authorize).toHaveBeenCalled();
  });
});
