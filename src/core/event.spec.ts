import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenTPConfig } from "../types";
import { loadEvents } from "./event";
import { validateEvents } from "./validator";

function makeConfig(): OpenTPConfig {
  return {
    opentp: "2026-01",
    info: { title: "Load test", version: "1.0.0" },
    spec: {
      paths: { events: { root: "/events", template: "{area}/{event}.yaml" } },
      events: {
        "x-opentp": {
          keygen: {
            template: "{area | slug}::{event | slug}::{verb | slug}",
            transforms: { slug: ["lower"] },
          },
        },
        taxonomy: {
          area: { title: "Area", type: "string", required: true },
          event: { title: "Event", type: "string", required: true },
          verb: { title: "Verb", type: "string" },
        },
        payload: { targets: { all: ["web"] }, schema: {} },
      },
    },
  };
}

function eventYaml(key: string, taxonomy: string, extra = ""): string {
  return `opentp: 2026-01\nevent:\n  key: ${key}\n  taxonomy: ${taxonomy}\n${extra}  payload:\n    schema: {}\n`;
}

describe("loadEvents", () => {
  let root: string;
  let eventsPath: string;

  const write = (relativePath: string, content: string): void => {
    const filePath = path.join(eventsPath, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "opentp-load-"));
    eventsPath = path.join(root, "events");
    fs.mkdirSync(eventsPath);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reports files that cannot be loaded and keeps the others", () => {
    write("auth/ok.yaml", eventYaml("auth::ok::click", "{ verb: Click }"));
    write("auth/syntax.yaml", "opentp: 2026-01\nevent:\n  key: a: b\n");
    write("auth/empty.yaml", "");
    write("auth/list.yaml", "- event\n");
    write("auth/no_event.yaml", "opentp: 2026-01\n");
    write("auth/event_scalar.yaml", "opentp: 2026-01\nevent: 5\n");
    write("auth/no_taxonomy.yaml", "opentp: 2026-01\nevent:\n  key: auth::no_taxonomy::x\n");
    write("auth/taxonomy_list.yaml", eventYaml("auth::taxonomy_list::x", "[a, b]"));
    // Not matched by the path template: skipped without an issue
    write("auth/nested/deep.yaml", "not: [valid");
    write("README.md", "# notes");

    const { events, issues } = loadEvents(eventsPath, "{area}/{event}.yaml", makeConfig());

    expect(events.map((e) => e.relativePath)).toEqual(["auth/ok.yaml"]);
    expect(events[0].expectedKey).toBe("auth::ok::click");
    expect([...issues].sort((a, b) => (a.file < b.file ? -1 : 1))).toEqual([
      {
        file: "auth/empty.yaml",
        path: "",
        message: "Expected a mapping with 'opentp' and 'event'",
      },
      {
        file: "auth/event_scalar.yaml",
        path: "event",
        message: "Invalid field: event must be a mapping",
      },
      { file: "auth/list.yaml", path: "", message: "Expected a mapping with 'opentp' and 'event'" },
      { file: "auth/no_event.yaml", path: "event", message: "Missing required field: event" },
      {
        file: "auth/no_taxonomy.yaml",
        path: "event.taxonomy",
        message: "Missing required field: event.taxonomy",
      },
      {
        file: "auth/syntax.yaml",
        path: "",
        message:
          "Invalid YAML at line 3, column 8: Nested mappings are not allowed in compact mappings",
      },
      {
        file: "auth/taxonomy_list.yaml",
        path: "event.taxonomy",
        message: "Invalid field: event.taxonomy must be a mapping",
      },
    ]);
  });

  it("keeps an event whose key cannot be generated and reports it as an event.key error", async () => {
    write("auth/no_verb.yaml", eventYaml("auth::no_verb::x", "{}"));
    write(
      "auth/ignored.yaml",
      eventYaml(
        "auth::ignored::x",
        "{}",
        "  ignore:\n    - path: event.key\n      reason: legacy key\n",
      ),
    );

    const config = makeConfig();
    const { events, issues } = loadEvents(eventsPath, "{area}/{event}.yaml", config);
    expect(issues).toEqual([]);
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.expectedKey).toBeNull();
      expect(event.keygenError).toBe("Variable 'verb' not found in variables");
    }

    const errors = await validateEvents(events, config, new Map());
    expect(errors).toEqual([
      {
        event: "auth/no_verb.yaml",
        path: "event.key",
        message: "Cannot generate the expected key: Variable 'verb' not found in variables",
        severity: "error",
      },
    ]);
  });

  it("does not generate keys (and reports no per-event error) when keygen is misconfigured", async () => {
    write("auth/a.yaml", eventYaml("auth::a::x", "{ verb: X }"));
    write("auth/b.yaml", eventYaml("auth::b::x", "{ verb: X }"));

    const config = makeConfig();
    config.spec.events["x-opentp"] = {
      keygen: { template: "{area | nope}::{event}", transforms: { slug: ["lower"] } },
    };
    const { events, issues } = loadEvents(eventsPath, "{area}/{event}.yaml", config);
    expect(issues).toEqual([]);
    expect(events.map((e) => [e.expectedKey, e.keygenError])).toEqual([
      [null, undefined],
      [null, undefined],
    ]);

    const errors = await validateEvents(events, config, new Map());
    expect(errors).toEqual([
      {
        event: "opentp.yaml",
        path: "spec.events.x-opentp.keygen.template",
        message:
          "Unknown keygen pipeline 'nope'. Define it in spec.events.x-opentp.keygen.transforms.",
        severity: "error",
      },
    ]);
  });

  it("loads nothing and reports nothing per file when the path template is unusable", () => {
    write("auth/a.yaml", eventYaml("auth::a::x", "{}"));

    for (const template of [
      "{area}/{area}.yaml",
      "{area | slug}/{event}.yaml",
      "{area/{event}.yaml",
    ]) {
      expect(loadEvents(eventsPath, template, makeConfig())).toEqual({ events: [], issues: [] });
    }
  });

  it("reports a missing events directory against opentp.yaml", () => {
    const missing = path.join(root, "no-such-dir");
    expect(loadEvents(missing, "{area}/{event}.yaml", makeConfig())).toEqual({
      events: [],
      issues: [
        {
          file: "opentp.yaml",
          path: "spec.paths.events.root",
          message: `Events directory not found: ${missing}`,
        },
      ],
    });
  });
});
