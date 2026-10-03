import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { PlanStore } from "../../mcp/plan";
import { generatorContext } from "../context";
import { createEffectiveResolver } from "../effective";
import type { GeneratorContext } from "../types";
import { jsonGenerator } from "./index";

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

describe("json generator", () => {
  it("should have correct name", () => {
    expect(jsonGenerator.name).toBe("json");
  });

  it("should generate valid JSON to stdout", async () => {
    const result = await jsonGenerator.generate(mockContext);
    expect(result.stdout).toBeDefined();
    expect(result.files).toBeUndefined();

    const parsed = JSON.parse(result.stdout!);
    expect(parsed.opentp).toBe("2026-01");
    expect(parsed.info.title).toBe("Test App");
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].key).toBe("app::login");
    expect(parsed.events[0].payload.schema.dimension_1.name).toBe("orgType");
    expect(parsed.events[0].payload.schema.dimension_1.example).toBe("enterprise");
    expect(parsed.dictionaries.actions).toEqual(["click", "view", "submit"]);
  });

  it("should output to file when --output is specified", async () => {
    const result = await jsonGenerator.generate({
      ...mockContext,
      options: { output: "./output/events.json" },
    });

    expect(result.stdout).toBeUndefined();
    expect(result.files).toHaveLength(1);
    expect(result.files![0].path).toBe("./output/events.json");

    const parsed = JSON.parse(result.files![0].content);
    expect(parsed.events).toHaveLength(1);
  });

  it("should pretty print by default", async () => {
    const result = await jsonGenerator.generate(mockContext);
    expect(result.stdout).toContain("\n");
    expect(result.stdout).toContain("  ");
  });

  it("should not pretty print when --no-pretty", async () => {
    const result = await jsonGenerator.generate({
      ...mockContext,
      options: { pretty: false },
    });

    // One line, terminated by a newline
    expect(result.stdout?.endsWith("}\n")).toBe(true);
    expect(result.stdout?.trimEnd()).not.toContain("\n");
  });

  it("should end stdout and file content with a newline", async () => {
    const toStdout = await jsonGenerator.generate(mockContext);
    const toFile = await jsonGenerator.generate({
      ...mockContext,
      options: { output: "out.json" },
    });
    expect(toStdout.stdout?.endsWith("}\n")).toBe(true);
    expect(toFile.files?.[0].content).toBe(toStdout.stdout);
  });
});

describe("json export of a 2026-09 plan", () => {
  const ONBOARDING_KEY =
    "onboarding::onboarding_step_complete::complete::onboarding_step::p1::internal-true";

  async function exportPlan() {
    const plan = await new PlanStore(path.resolve("tests/data/coverage-valid")).current();
    const context = generatorContext({
      config: plan.config,
      events: plan.events,
      dictionaries: plan.dictionaries,
      options: {},
      tracker: plan.tracker,
      cliConfig: plan.cli?.config ?? null,
    });
    const result = await jsonGenerator.generate(context);
    return {
      plan,
      context,
      text: result.stdout as string,
      data: JSON.parse(result.stdout as string),
    };
  }

  it("adds the catalog, spec.targets and spec.checks at the top level", async () => {
    const { plan, data } = await exportPlan();
    expect(Object.keys(data)).toEqual([
      "opentp",
      "info",
      "catalog",
      "targets",
      "checks",
      "events",
      "dictionaries",
    ]);
    expect(data.catalog).toEqual(plan.config.spec.events.payload.schema);
    expect(data.targets).toEqual(plan.config.spec.targets);
    expect(data.checks).toEqual(plan.config.spec.checks);
    // Dictionaries by name, events in the given order (the CLI sorts them by file path)
    expect(Object.keys(data.dictionaries)).toEqual([...plan.dictionaries.keys()].sort());
    expect(data.events.map((event: { key: string }) => event.key)).toEqual(
      plan.events.map((event) => event.key),
    );
  });

  it("keeps the raw payload and adds the effective payload per target and version", async () => {
    const { plan, data } = await exportPlan();
    const raw = plan.events.find((event) => event.key === ONBOARDING_KEY);
    const event = data.events.find(
      (candidate: { key: string }) => candidate.key === ONBOARDING_KEY,
    );
    expect(event.payload).toEqual(raw?.payload);
    const { web, ios, android } = event.effectivePayload;
    expect(Object.keys(event.effectivePayload)).toEqual(["web", "ios", "android"]);

    // Versioned: the current version (through its alias), every version, and `fields` = current
    expect(web.current).toBe("1.1.0");
    expect(web.aliases).toEqual({ stable: "1.1.0", legacy: "1.0.0" });
    expect(Object.keys(web.versions)).toEqual(["1.0.0", "1.1.0"]);
    expect(web.versions["1.0.0"].deprecated).toBe(true);
    expect(web.versions["1.1.0"]).not.toHaveProperty("deprecated");
    expect(web.fields).toEqual(web.versions["1.1.0"].fields);
    // Common fields first, then the fields the version lists (after $ref)
    expect(Object.keys(web.fields)).toEqual([
      "application_id",
      "event_name",
      "event_category",
      "build_variant",
      "step_index",
      "auth_method",
      "device_model",
    ]);
    expect(web.fields.application_id).toEqual({
      type: "string",
      policy: "fixed",
      value: "web-app",
    });
    // The catalog type and the event's narrowing
    expect(web.fields.auth_method).toEqual({ type: "string", dict: "data/social_auth_methods" });
    expect(ios.current).toBe("ios-1");
    expect(ios.fields.device_model).toMatchObject({ type: "string", required: true });

    // Unversioned: only the fields
    expect(Object.keys(android)).toEqual(["fields"]);
    expect(android.fields.tags).toMatchObject({
      type: "array",
      items: { type: "string", minLength: 1, enum: ["onboarding", "activation"] },
    });
  });

  it("is deterministic and gives each call its own copy", async () => {
    const first = await exportPlan();
    const second = await exportPlan();
    expect(second.text).toBe(first.text);
    const event = first.plan.events[0];
    const copy = first.context.effective(event);
    copy.web.fields.application_id.title = "changed";
    expect(first.context.effective(event).web.fields.application_id).not.toHaveProperty("title");
  });
});
