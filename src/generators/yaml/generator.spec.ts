import { describe, expect, it } from "vitest";
import type { GeneratorContext } from "../types";
import { yamlGenerator } from "./index";

const mockContext: GeneratorContext = {
  config: {
    opentp: "0.5.0",
    info: {
      title: "Test App",
      version: "1.0.0",
    },
    spec: {
      events: {
        key: { pattern: "{app}::{name}" },
        paths: {},
        taxonomy: {},
        payload: { platforms: { all: [] }, schema: {} },
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
      ignoreChecks: [],
      payload: { platforms: {} },
    },
  ],
  dictionaries: new Map([["actions", ["click", "view", "submit"]]]),
  options: {},
};

describe("yaml generator", () => {
  it("should have correct name", () => {
    expect(yamlGenerator.name).toBe("yaml");
  });

  it("should generate valid YAML to stdout", () => {
    const result = yamlGenerator.generate(mockContext);
    expect(result.stdout).toBeDefined();
    expect(result.files).toBeUndefined();

    expect(result.stdout).toContain("opentp: 0.5.0");
    expect(result.stdout).toContain("title: Test App");
    expect(result.stdout).toContain("key: app::login");
  });

  it("should output to file when --output is specified", () => {
    const result = yamlGenerator.generate({
      ...mockContext,
      options: { output: "./output/events.yaml" },
    });

    expect(result.stdout).toBeUndefined();
    expect(result.files).toHaveLength(1);
    expect(result.files![0].path).toBe("./output/events.yaml");
    expect(result.files![0].content).toContain("opentp: 0.5.0");
  });

  it("should include dictionaries", () => {
    const result = yamlGenerator.generate(mockContext);
    expect(result.stdout).toContain("dictionaries:");
    expect(result.stdout).toContain("actions:");
    expect(result.stdout).toContain("- click");
  });
});
