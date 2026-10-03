import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KeygenConfig, OpenTPConfig } from "../types";
import { rootToolFiles } from "./config";
import { loadEvents } from "./event";
import { errorsOnly, validateEvents } from "./validator";

/** keygen from opentp.cli.yaml */
const KEYGEN: KeygenConfig = {
  template: "{area | slug}::{event | slug}::{verb | slug}",
  transforms: { slug: ["lower"] },
};

function makeConfig(): OpenTPConfig {
  return {
    opentp: "2026-09",
    info: { title: "Load test", version: "1.0.0" },
    spec: {
      paths: { events: { root: "/events", template: "{area}/{event}.yaml" } },
      events: {
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

function eventYaml(key: string, taxonomy: string, extra = "", version = "2026-09"): string {
  return `opentp: ${version}\nevent:\n  key: ${key}\n  taxonomy: ${taxonomy}\n${extra}  payload:\n    schema: {}\n`;
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
    write("auth/syntax.yaml", "opentp: 2026-09\nevent:\n  key: a: b\n");
    write("auth/empty.yaml", "");
    write("auth/list.yaml", "- event\n");
    write("auth/no_event.yaml", "opentp: 2026-09\n");
    write("auth/event_scalar.yaml", "opentp: 2026-09\nevent: 5\n");
    write("auth/no_taxonomy.yaml", "opentp: 2026-09\nevent:\n  key: auth::no_taxonomy::x\n");
    write("auth/taxonomy_list.yaml", eventYaml("auth::taxonomy_list::x", "[a, b]"));
    // Not matched by the path template: skipped without an issue
    write("auth/nested/deep.yaml", "not: [valid");
    write("README.md", "# notes");

    const { events, issues } = loadEvents(eventsPath, "{area}/{event}.yaml", makeConfig(), {
      keygen: KEYGEN,
    });

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
    const { events, issues } = loadEvents(eventsPath, "{area}/{event}.yaml", config, {
      keygen: KEYGEN,
    });
    expect(issues).toEqual([]);
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.expectedKey).toBeNull();
      expect(event.keygenError).toBe("Variable 'verb' not found in variables");
    }

    // Both events have the same payload: their overlap warning is not what this test is about
    const errors = errorsOnly(await validateEvents(events, config, new Map(), { keygen: KEYGEN }));
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
    const keygen: KeygenConfig = {
      template: "{area | nope}::{event}",
      transforms: { slug: ["lower"] },
    };
    const { events, issues } = loadEvents(eventsPath, "{area}/{event}.yaml", config, { keygen });
    expect(issues).toEqual([]);
    expect(events.map((e) => [e.expectedKey, e.keygenError])).toEqual([
      [null, undefined],
      [null, undefined],
    ]);

    const errors = errorsOnly(await validateEvents(events, config, new Map(), { keygen }));
    expect(errors).toEqual([
      {
        event: "opentp.cli.yaml",
        path: "keygen.template",
        message: "Unknown keygen pipeline 'nope'. Define it in keygen.transforms.",
        severity: "error",
      },
    ]);
  });

  it("generates no key and compares no key without keygen", async () => {
    write("auth/a.yaml", eventYaml("anything_goes", "{ verb: X }"));
    const config = makeConfig();
    const { events } = loadEvents(eventsPath, "{area}/{event}.yaml", config);
    expect(events[0].expectedKey).toBeNull();
    expect(await validateEvents(events, config, new Map())).toEqual([]);
  });

  it("matches a template ending in .yaml with .yml files too", () => {
    write("auth/a.yaml", eventYaml("auth::a::x", "{ verb: X }"));
    write("auth/b.yml", eventYaml("auth::b::x", "{ verb: X }"));
    const { events } = loadEvents(eventsPath, "{area}/{event}.yaml", makeConfig(), {
      keygen: KEYGEN,
    });
    expect(events.map((e) => [e.relativePath, e.taxonomy.event, e.expectedKey]).sort()).toEqual([
      ["auth/a.yaml", "a", "auth::a::x"],
      ["auth/b.yml", "b", "auth::b::x"],
    ]);
    // A .yml template matches .yaml files as well
    expect(loadEvents(eventsPath, "{area}/{event}.yml", makeConfig()).events).toHaveLength(2);
  });

  it("never reads the plan root's tool files as events", () => {
    // Events root = plan root, with a template that would match the tool files
    const config = makeConfig();
    for (const name of ["opentp.yaml", "opentp.cli.yaml", "opentp.cli.yml", "opentp.yml"]) {
      write(name, "opentp: 2026-09\n");
    }
    write("login.yaml", eventYaml("login", "{ verb: X }"));
    const { events, issues } = loadEvents(eventsPath, "{event}.yaml", config, {
      skipFiles: rootToolFiles(eventsPath),
    });
    expect(events.map((e) => e.relativePath)).toEqual(["login.yaml"]);
    expect(issues).toEqual([]);
  });

  it("reports removed keywords, field definitions that are not mappings and written check ids once per file", async () => {
    write(
      "auth/old.yaml",
      [
        "opentp: 2026-01",
        "x-opentp: {}",
        "event:",
        "  key: auth::old::x",
        "  taxonomy: { verb: X }",
        "  lifecycle: { status: active, x-opentp: { note: 1 } }",
        "  payload:",
        "    web:",
        "      current: '1.0'",
        "      '1.0':",
        "        schema:",
        "          app_id: { value: web, valueRequired: true, x-opentp: { role: constant } }",
        "          user_id:",
        "          name: { checks: { not-empty: true, mytool.check: { a: 1 }, off: false } }",
        "          x-opentp: { type: string }",
        "",
      ].join("\n"),
    );
    const config = makeConfig();
    config.spec.events.payload.targets = { all: ["web"] };
    // In the catalog: only the per-file problems remain (`x-opentp` is a field name here)
    config.spec.events.payload.schema = {
      app_id: { type: "string" },
      user_id: { type: "string" },
      name: { type: "string" },
      "x-opentp": { type: "string" },
    };
    const { events } = loadEvents(eventsPath, "{area}/{event}.yaml", config);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event.fileIssues).toEqual([
      {
        path: "x-opentp",
        message:
          "x-opentp was removed in 2026-09: move checks to 'checks', keygen to opentp.cli.yaml 'keygen', delete 'role'",
      },
      { path: "event.lifecycle.x-opentp", message: expect.stringMatching(/^x-opentp was removed/) },
      {
        path: "payload.web.1.0.schema.app_id.valueRequired",
        message:
          "valueRequired was removed in 2026-09: set 'policy' on the catalog or common field",
      },
      {
        path: "payload.web.1.0.schema.app_id.x-opentp",
        message: expect.stringMatching(/^x-opentp was removed/),
      },
      {
        path: "payload.web.1.0.schema.user_id",
        message: "Field definition must be a mapping (write {} to list the field)",
      },
    ]);
    expect(event.checkRefs).toEqual([
      { path: "payload.web.1.0.schema.name.checks", id: "not-empty", params: true, field: "name" },
      {
        path: "payload.web.1.0.schema.name.checks",
        id: "mytool.check",
        params: { a: 1 },
        field: "name",
      },
      { path: "payload.web.1.0.schema.name.checks", id: "off", params: false, field: "name" },
    ]);

    // Never ignorable, reported once (not per target or version); the unknown check is a warning
    event.ignore = [{ path: "payload::app_id" }, { path: "opentp" }];
    const results = await validateEvents(events, config, new Map());
    expect(results.map((result) => [result.path, result.severity])).toEqual([
      ["x-opentp", "error"],
      ["event.lifecycle.x-opentp", "error"],
      ["payload.web.1.0.schema.app_id.valueRequired", "error"],
      ["payload.web.1.0.schema.app_id.x-opentp", "error"],
      ["payload.web.1.0.schema.user_id", "error"],
      ["payload.web.1.0.schema.name.checks.mytool.check", "warning"],
    ]);
  });

  it("reports policy, empty enums, conflicting restrictions and invalid regexes once per file", () => {
    write(
      "auth/fields.yaml",
      [
        "opentp: 2026-09",
        "event:",
        "  key: auth::fields::x",
        "  taxonomy: { verb: X }",
        "  payload:",
        "    schema:",
        "      a: { value: x, policy: fixed }",
        "      b: { enum: [] }",
        "      c: { enum: [x], dict: d }",
        "      d: { pattern: '(', items: { pattern: '[' } }",
        "      e: { dict: data/apps, items: { dict: data/tags } }",
        "",
      ].join("\n"),
    );
    const { events } = loadEvents(eventsPath, "{area}/{event}.yaml", makeConfig());
    expect(events[0].fileIssues?.map((issue) => [issue.path, issue.message])).toEqual([
      [
        "payload.schema.a.policy",
        "policy is set on catalog and common fields in opentp.yaml, not in events",
      ],
      ["payload.schema.b.enum", "enum must have at least one value"],
      ["payload.schema.c", "Field can have only one of: enum, dict, or value"],
      ["payload.schema.d.pattern", expect.stringMatching(/^Invalid regex: SyntaxError/)],
      ["payload.schema.d.items.pattern", expect.stringMatching(/^Invalid regex: SyntaxError/)],
    ]);
    expect(events[0].dictRefs).toEqual([
      { path: "payload.schema.c.dict", dict: "d", field: "c" },
      { path: "payload.schema.e.dict", dict: "data/apps", field: "e" },
      { path: "payload.schema.e.items.dict", dict: "data/tags", field: "e" },
    ]);
  });

  it("adds the migrate hint to an event file still on 2026-01", async () => {
    write("auth/old.yaml", eventYaml("auth::old::x", "{ verb: X }", "", "2026-01"));
    write("auth/other.yaml", eventYaml("auth::other::x", "{ verb: X }", "", "2025-12"));
    const config = makeConfig();
    const { events } = loadEvents(eventsPath, "{area}/{event}.yaml", config);
    const errors = errorsOnly(await validateEvents(events, config, new Map()));
    expect(errors.map((error) => [error.event, error.message]).sort()).toEqual([
      [
        "auth/old.yaml",
        "Unsupported OpenTrackPlan schema version '2026-01'. Expected '2026-09'. Run \"opentp migrate\" to upgrade it.",
      ],
      [
        "auth/other.yaml",
        "Unsupported OpenTrackPlan schema version '2025-12'. Expected '2026-09'.",
      ],
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
