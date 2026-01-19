import { describe, expect, it } from "vitest";
import type { GeneratorContext } from "../types";
import { jsonGenerator } from "./index";

const mockContext: GeneratorContext = {
  config: {
    opentp: "2025-12",
    info: {
      title: "Test App",
      version: "1.0.0",
    },
    spec: {
      events: {
        key: { pattern: "{app}::{name}" },
        paths: {},
        taxonomy: {},
        payload: { targets: { all: [] }, schema: {} },
      },
    },
  },
  events: [
    {
      filePath: "/test/events/app/login.yaml",
      relativePath: "app/login.yaml",
      key: "app::login",
      expectedKey: "app::login",
      taxonomy: { app: "myapp", name: "login" },
      lifecycle: { status: "active" },
      ignore: [],
      payload: { targets: {} },
    },
  ],
  dictionaries: new Map([["actions", ["click", "view", "submit"]]]),
  options: {},
};

describe("json generator", () => {
  it("should have correct name", () => {
    expect(jsonGenerator.name).toBe("json");
  });

  it("should generate valid JSON to stdout", () => {
    const result = jsonGenerator.generate(mockContext);
    expect(result.stdout).toBeDefined();
    expect(result.files).toBeUndefined();

    const parsed = JSON.parse(result.stdout!);
    expect(parsed.opentp).toBe("2025-12");
    expect(parsed.info.title).toBe("Test App");
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].key).toBe("app::login");
    expect(parsed.dictionaries.actions).toEqual(["click", "view", "submit"]);
  });

  it("should output to file when --output is specified", () => {
    const result = jsonGenerator.generate({
      ...mockContext,
      options: { output: "./output/events.json" },
    });

    expect(result.stdout).toBeUndefined();
    expect(result.files).toHaveLength(1);
    expect(result.files![0].path).toBe("./output/events.json");

    const parsed = JSON.parse(result.files![0].content);
    expect(parsed.events).toHaveLength(1);
  });

  it("should pretty print by default", () => {
    const result = jsonGenerator.generate(mockContext);
    expect(result.stdout).toContain("\n");
    expect(result.stdout).toContain("  ");
  });

  it("should not pretty print when --no-pretty", () => {
    const result = jsonGenerator.generate({
      ...mockContext,
      options: { pretty: false },
    });

    expect(result.stdout).not.toContain("\n");
  });
});
