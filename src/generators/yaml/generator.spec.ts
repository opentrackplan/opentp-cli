import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { PlanStore } from "../../mcp/plan";
import { generatorContext } from "../context";
import { createEffectiveResolver } from "../effective";
import type { GeneratorContext } from "../types";
import { yamlGenerator } from "./index";

const mockContext: GeneratorContext = {
  config: {
    opentp: "2026-01",
    info: {
      title: "Test App",
      version: "1.0.0",
    },
    spec: {
      paths: {
        events: { root: "/events", template: "{area}/{event}.yaml" },
      },
      events: {
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
      expectedKey: null,
      taxonomy: { app: "myapp", name: "login" },
      lifecycle: { status: "active" },
      ignore: [],
      payload: {
        schema: {
          dimension_1: {
            type: "string",
            name: "orgType",
            title: "Organization Type",
            example: "enterprise",
          },
        },
      },
    },
  ],
  dictionaries: new Map([["actions", ["click", "view", "submit"]]]),
  options: {},
  effective: (event) =>
    createEffectiveResolver(mockContext.config, mockContext.dictionaries)(event),
};

describe("yaml generator", () => {
  it("should have correct name", () => {
    expect(yamlGenerator.name).toBe("yaml");
  });

  it("should generate valid YAML to stdout", async () => {
    const result = await yamlGenerator.generate(mockContext);
    expect(result.stdout).toBeDefined();
    expect(result.files).toBeUndefined();

    expect(result.stdout).toContain("opentp: 2026-01");
    expect(result.stdout).toContain("title: Test App");
    expect(result.stdout).toContain("key: app::login");
    expect(result.stdout).toContain("name: orgType");
    expect(result.stdout).toContain("example: enterprise");
  });

  it("should output to file when --output is specified", async () => {
    const result = await yamlGenerator.generate({
      ...mockContext,
      options: { output: "./output/events.yaml" },
    });

    expect(result.stdout).toBeUndefined();
    expect(result.files).toHaveLength(1);
    expect(result.files![0].path).toBe("./output/events.yaml");
    expect(result.files![0].content).toContain("opentp: 2026-01");
  });

  it("should include dictionaries", async () => {
    const result = await yamlGenerator.generate(mockContext);
    expect(result.stdout).toContain("dictionaries:");
    expect(result.stdout).toContain("actions:");
    expect(result.stdout).toContain("- click");
  });
});

describe("yaml export of a 2026-09 plan", () => {
  it("writes repeated definitions in full, without anchors and aliases", async () => {
    const plan = await new PlanStore(path.resolve("tests/data/coverage-valid")).current();
    const result = await yamlGenerator.generate(
      generatorContext({
        config: plan.config,
        events: plan.events,
        dictionaries: plan.dictionaries,
        options: {},
        tracker: null,
        cliConfig: null,
      }),
    );
    const text = result.stdout as string;
    expect(text).not.toMatch(/(^|\s)[&*]a\d+/m);
    const data = parse(text);
    expect(Object.keys(data)).toEqual([
      "opentp",
      "info",
      "catalog",
      "targets",
      "checks",
      "events",
      "dictionaries",
    ]);
    // Every event has the same common fields, each written out
    for (const event of data.events) {
      expect(event.effectivePayload.web.fields.build_variant).toEqual({
        type: "string",
        required: false,
      });
    }
  });
});
