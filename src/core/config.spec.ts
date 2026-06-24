import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config";

vi.mock("../meta", () => ({
  SPEC_VERSION: "2026-01",
}));

vi.mock("../util", () => ({
  fileExists: vi.fn(() => true),
  loadYaml: vi.fn(),
}));

import { loadYaml } from "../util";

function baseConfig() {
  return {
    opentp: "2026-01",
    info: { title: "Test", version: "1.0.0" },
    spec: {
      paths: { events: { root: "/events", template: "{area}/{event}.yaml" } },
      events: {
        taxonomy: { area: { title: "Area", type: "string" } },
        payload: { targets: { all: ["web"] }, schema: {} },
      },
    },
  };
}

function loadWith(override: (cfg: ReturnType<typeof baseConfig>) => void) {
  const cfg = baseConfig();
  override(cfg);
  vi.mocked(loadYaml).mockReturnValue(cfg);
  return loadConfig("/fake/opentp.yaml");
}

describe("config validation — export section", () => {
  it("loads config with export.generators list", () => {
    const result = loadWith((cfg) => {
      cfg.spec.export = {
        generators: [
          { name: "ts-sdk", target: "web", standalone: true },
          { name: "swift-sdk", target: "ios" },
        ],
      };
    });
    expect(result.spec.export?.generators).toHaveLength(2);
    expect(result.spec.export?.generators?.[0].name).toBe("ts-sdk");
  });

  it("loads config with export.bundle flag", () => {
    const result = loadWith((cfg) => {
      cfg.spec.export = { bundle: true };
    });
    expect(result.spec.export?.bundle).toBe(true);
  });

  it("loads config without export section (optional)", () => {
    const result = loadWith(() => {});
    expect(result.spec.export).toBeUndefined();
  });

  it("validates generator name is non-empty string", () => {
    expect(() =>
      loadWith((cfg) => {
        cfg.spec.export = { generators: [{ name: "" }] };
      }),
    ).toThrow("name must be a non-empty string");
  });

  it("validates target is string when provided", () => {
    expect(() =>
      loadWith((cfg) => {
        cfg.spec.export = { generators: [{ name: "ts-sdk", target: 42 as unknown as string }] };
      }),
    ).toThrow("target must be a string");
  });

  it("accepts standalone boolean", () => {
    const result = loadWith((cfg) => {
      cfg.spec.export = { generators: [{ name: "ts-sdk", standalone: true }] };
    });
    expect(result.spec.export?.generators?.[0].standalone).toBe(true);
  });
});

describe("config validation — ui section", () => {
  it("loads config with ui.theme value", () => {
    const result = loadWith((cfg) => {
      cfg.spec.ui = { theme: "dark" };
    });
    expect(result.spec.ui?.theme).toBe("dark");
  });

  it("loads config with ui.mode value", () => {
    const result = loadWith((cfg) => {
      cfg.spec.ui = { mode: "editor" };
    });
    expect(result.spec.ui?.mode).toBe("editor");
  });

  it("loads config with ui.title value", () => {
    const result = loadWith((cfg) => {
      cfg.spec.ui = { title: "My Plan" };
    });
    expect(result.spec.ui?.title).toBe("My Plan");
  });

  it("loads config without ui section (optional)", () => {
    const result = loadWith(() => {});
    expect(result.spec.ui).toBeUndefined();
  });

  it("validates theme is one of: dark, light, auto", () => {
    expect(() =>
      loadWith((cfg) => {
        cfg.spec.ui = { theme: "neon" as "dark" };
      }),
    ).toThrow("spec.ui.theme must be one of: dark, light, auto");
  });

  it("validates mode is one of: editor, viewer", () => {
    expect(() =>
      loadWith((cfg) => {
        cfg.spec.ui = { mode: "admin" as "editor" };
      }),
    ).toThrow("spec.ui.mode must be one of: editor, viewer");
  });
});
