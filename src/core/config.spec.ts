import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { KeygenConfig, OpenTPConfig } from "../types";
import { getKeygenProblems, loadConfig, rootToolFiles, validateConfig } from "./config";

function makeConfig(): OpenTPConfig {
  return {
    opentp: "2026-09",
    info: { title: "Config test", version: "1.0.0" },
    spec: {
      paths: { events: { root: "/events", template: "{area}/{event}.yaml" } },
      events: {
        key: { pattern: "^[a-z:]+$" },
        taxonomy: {
          area: { title: "Area", type: "string", required: true, pattern: "^[a-z]+$" },
          event: { title: "Event", type: "string", required: true },
          action: {
            title: "Action",
            type: "string",
            template: "{verb} {object}",
            fragments: {
              verb: { title: "Verb", type: "string" },
              object: { title: "Object", type: "string" },
            },
          },
        },
        payload: {
          targets: { all: ["web", "ios", "android"], mobile: ["ios", "android"] },
          schema: {},
        },
      },
      targets: { ios: { title: "iOS" } },
    },
  };
}

describe("validateConfig", () => {
  it("accepts a consistent configuration", () => {
    expect(validateConfig(makeConfig())).toEqual([]);
  });

  it.each([
    ["{area}/{area}.yaml", "Duplicate placeholder '{area}'"],
    ["{area}/{event | slug}.yaml", "Transforms are not allowed in this template: '{event | slug}'"],
    [
      "{area}/{my-event}.yaml",
      "Invalid placeholder '{my-event}': names must start with a letter, '_' or '$' and contain only letters, digits, '_' or '$'",
    ],
    ["{area}/{event.yaml", "Unclosed bracket in pattern: {area}/{event.yaml"],
    ["{area}/{}.yaml", "Empty variable in pattern: {area}/{}.yaml"],
  ])("reports an unusable path template %s", (template, message) => {
    const config = makeConfig();
    config.spec.paths.events.template = template;
    expect(validateConfig(config)).toEqual([{ path: "spec.paths.events.template", message }]);
  });

  it("reports invalid regexes, composite templates and field definitions", () => {
    const config = makeConfig();
    const taxonomy = config.spec.events.taxonomy;
    config.spec.events.key = { pattern: "[" };
    taxonomy.area.pattern = "(";
    taxonomy.action.template = "{verb | lower} {object}";
    taxonomy.action.fragments = {
      verb: { title: "Verb", type: "string", pattern: "[" },
      object: null as unknown as (typeof taxonomy)[string],
    };
    taxonomy.event = null as unknown as (typeof taxonomy)[string];

    const issues = validateConfig(config);
    expect(issues.map((issue) => issue.path)).toEqual([
      "spec.events.key.pattern",
      "spec.events.taxonomy.area.pattern",
      "spec.events.taxonomy.event",
      "spec.events.taxonomy.action.template",
      "spec.events.taxonomy.action.fragments.verb.pattern",
      "spec.events.taxonomy.action.fragments.object",
    ]);
    expect(issues[0].message).toMatch(/^Invalid regex: SyntaxError: /);
    expect(issues[2].message).toBe("Field definition must be a mapping");
    expect(issues[3].message).toBe("Transforms are not allowed in this template: '{verb | lower}'");
  });

  it("reports group members and spec.targets keys that are not in targets.all", () => {
    const config = makeConfig();
    config.spec.events.payload.targets.legacy = ["desktop", "web", "tv"];
    config.spec.events.payload.targets.broken = "web" as unknown as string[];
    config.spec.targets = { ios: { title: "iOS" }, desktop: { title: "Desktop" } };

    expect(validateConfig(config)).toEqual([
      {
        path: "spec.events.payload.targets.legacy",
        message:
          "Unknown target 'desktop' in group 'legacy'. Group members must be listed in spec.events.payload.targets.all.",
      },
      {
        path: "spec.events.payload.targets.legacy",
        message:
          "Unknown target 'tv' in group 'legacy'. Group members must be listed in spec.events.payload.targets.all.",
      },
      {
        path: "spec.events.payload.targets.broken",
        message: "Target group must be a list of target ids",
      },
      {
        path: "spec.targets.desktop",
        message:
          "Unknown target 'desktop'. Keys of spec.targets must be 'all' or listed in spec.events.payload.targets.all.",
      },
    ]);
  });

  it("accepts spec.targets.all (common fields of every target)", () => {
    const config = makeConfig();
    config.spec.targets = { all: { schema: { app_id: { type: "string" } } }, ios: {} };
    expect(validateConfig(config)).toEqual([]);
  });

  it("reports x-opentp on any object and valueRequired, once per occurrence", () => {
    const config = makeConfig() as unknown as Record<string, any>;
    config.spec.events["x-opentp"] = { keygen: { template: "{area}" } };
    config.spec.events.taxonomy.area["x-opentp"] = { checks: { "starts-with": "a" } };
    config.spec.events.payload.schema = {
      app_id: { type: "string", valueRequired: true, "x-opentp": { role: "constant" } },
      // A field named like a keyword is a name, not a keyword
      valueRequired: { type: "boolean" },
      "x-team": { type: "string" },
    };
    config.spec.targets = { all: { schema: { build: { type: "string", valueRequired: false } } } };
    const xOpentp =
      "x-opentp was removed in 2026-09: move checks to 'checks', keygen to opentp.cli.yaml 'keygen', delete 'role'";
    const valueRequired =
      "valueRequired was removed in 2026-09: set 'policy' on the catalog or common field";
    // In document order
    expect(validateConfig(config as OpenTPConfig)).toEqual([
      { path: "spec.events.taxonomy.area.x-opentp", message: xOpentp },
      { path: "spec.events.payload.schema.app_id.valueRequired", message: valueRequired },
      { path: "spec.events.payload.schema.app_id.x-opentp", message: xOpentp },
      { path: "spec.events.x-opentp", message: xOpentp },
      { path: "spec.targets.all.schema.build.valueRequired", message: valueRequired },
    ]);
  });

  it("reports payload field definitions that are not mappings once", () => {
    const config = makeConfig() as unknown as Record<string, any>;
    config.spec.events.payload.schema = { user_id: null, app_id: "string", ok: { type: "string" } };
    config.spec.targets = { ios: { schema: { device: [] } } };
    config.spec.events.pii = { schema: { owner: null } };
    expect(validateConfig(config as OpenTPConfig)).toEqual([
      {
        path: "spec.events.payload.schema.user_id",
        message: "Field definition must be a mapping (write {} to list the field)",
      },
      {
        path: "spec.events.payload.schema.app_id",
        message: "Field definition must be a mapping (write {} to list the field)",
      },
      { path: "spec.events.pii.schema.owner", message: "Field definition must be a mapping" },
      {
        path: "spec.targets.ios.schema.device",
        message: "Field definition must be a mapping (write {} to list the field)",
      },
    ]);
  });

  it("reports empty enums, conflicting value/enum/dict and invalid field regexes where written", () => {
    const config = makeConfig() as unknown as Record<string, any>;
    config.spec.events.taxonomy.event.enum = [];
    config.spec.events.payload.schema = {
      status: { type: "string", enum: ["a"], value: "a" },
      tags: { type: "array", items: { type: "string", pattern: "(" } },
    };
    config.spec.events.pii = {
      kind: { pattern: "[" },
      // pii meta fields cannot combine enum and dict either (piiMetaField in the spec schema)
      schema: { owner: { type: "string", enum: ["x"], dict: "owners" } },
    };
    expect(
      validateConfig(config as OpenTPConfig).map((issue) => [issue.path, issue.message]),
    ).toEqual([
      ["spec.events.taxonomy.event.enum", "enum must have at least one value"],
      ["spec.events.payload.schema.status", "Field can have only one of: enum, dict, or value"],
      [
        "spec.events.payload.schema.tags.items.pattern",
        expect.stringMatching(/^Invalid regex: SyntaxError/),
      ],
      ["spec.events.pii.kind.pattern", expect.stringMatching(/^Invalid regex: SyntaxError/)],
      ["spec.events.pii.schema.owner", "enum and dict cannot be used together"],
    ]);
  });

  it("reports base-layer problems once: types, conflicts, presence, policy, values, names", () => {
    const config = makeConfig();
    config.spec.events.payload.schema = {
      user_id: { type: "string" },
      size: { type: "integer", maximum: 10, enum: [1, 20], example: 30 },
      untyped: { title: "No type" },
    };
    config.spec.targets = {
      all: {
        schema: {
          user_id: { type: "number", required: false, value: "u" },
          kind: { type: "string", policy: "fixed" },
          alias: { type: "string", name: "kind" },
        },
      },
      ios: { schema: { kind: { policy: "specified" } } },
    };
    expect(validateConfig(config).map((issue) => [issue.path, issue.message])).toEqual([
      ["spec.targets.all.schema.user_id", "Field type conflict: base 'string' vs target 'number'"],
      ["spec.events.payload.schema.size.enum[1]", "Expected <= 10"],
      ["spec.events.payload.schema.size.example", "Expected <= 10"],
      ["spec.events.payload.schema.size.example", "Example 30 is not in allowed enum: [1, 20]"],
      [
        "spec.targets.all.schema.user_id",
        "Field 'user_id' is always present (it has a fixed value); remove required: false",
      ],
      [
        "spec.events.payload.schema.untyped",
        "Field 'untyped' has no type: give it a type in the catalog or in spec.targets",
      ],
      [
        "spec.targets.all.schema.alias",
        "Code-facing name 'kind' is used by both 'kind' and 'alias'",
      ],
      ["spec.targets.ios.schema.kind.policy", "Cannot lower policy 'fixed' to 'specified'"],
    ]);
  });

  it("reports broken portable checks (spec.checks)", () => {
    const config = makeConfig() as unknown as Record<string, any>;
    config.spec.checks = {
      "jira-key": { pattern: "^[A-Z]+-[0-9]+$", description: "A ticket key" },
      "mytool.short": { maxLength: 10 },
      empty: { title: "Nothing to check" },
      broken: { pattern: "(" },
      webhook: { maxLength: 1 },
      "1st": { maxLength: 1 },
      scalar: true,
    };
    const issues = validateConfig(config as OpenTPConfig);
    expect(issues.map((issue) => issue.path)).toEqual([
      "spec.checks.empty",
      "spec.checks.broken.pattern",
      "spec.checks.webhook",
      "spec.checks.1st",
      "spec.checks.scalar",
    ]);
    expect(issues[0].message).toBe(
      "A portable check needs at least one of: minLength, maxLength, pattern, format, minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf",
    );
    expect(issues[2].message).toBe(
      "Webhook checks are bound in opentp.cli.yaml (checks.bindings.<id>.webhook); refer to them by id",
    );
    expect(issues[3].message).toMatch(/^Invalid check id '1st'/);
    expect(issues[4].message).toBe("A portable check must be a mapping of keywords");
  });
  it("reports an empty targets.all", () => {
    const config = makeConfig();
    config.spec.events.payload.targets = { all: [] };
    config.spec.targets = {};
    expect(validateConfig(config)).toEqual([
      {
        path: "spec.events.payload.targets.all",
        message: "targets.all must be a non-empty list of target ids",
      },
    ]);
  });
});

describe("getKeygenProblems (keygen in opentp.cli.yaml)", () => {
  const keygen = (value: unknown) => value as KeygenConfig;

  it("accepts a usable keygen and no keygen", () => {
    const config = makeConfig();
    expect(
      getKeygenProblems(
        keygen({ template: "{area | slug}::{event | slug}", transforms: { slug: ["lower"] } }),
        config,
      ),
    ).toEqual([]);
    expect(getKeygenProblems(null, config)).toEqual([]);
  });

  it("reports keygen problems once per problem, at opentp.cli.yaml paths", () => {
    expect(
      getKeygenProblems(
        keygen({
          template: "{area | slugify}::{event | slugify}::{team | slug}",
          transforms: { slug: ["lower"], broken: "lower" },
        }),
        makeConfig(),
      ),
    ).toEqual([
      {
        path: "keygen.transforms.broken",
        message: "Keygen pipeline 'broken' must be a list of steps",
      },
      {
        path: "keygen.template",
        message: "Unknown keygen pipeline 'slugify'. Define it in keygen.transforms.",
      },
      {
        path: "keygen.template",
        message:
          "Unknown variable '{team}': keygen variables must be taxonomy fields or fragments declared in spec.events.taxonomy",
      },
    ]);
  });

  it("reports unknown and malformed keygen steps once, at their pipeline index", () => {
    expect(
      getKeygenProblems(
        keygen({
          template: "{area | slug}::{event | slug}",
          transforms: {
            slug: [
              "lower",
              "slugify",
              { truncate: 10 },
              { replace: { from: " ", to: "_" }, trim: true },
            ],
            // Unused pipelines are checked too
            spare: [{ "to-kebab-case": true }, 7],
          },
        }),
        makeConfig(),
      ),
    ).toEqual([
      {
        path: "keygen.transforms.slug[1]",
        message:
          "Unknown transform step 'slugify' (custom steps: keygen.plugins in opentp.cli.yaml, or --external-transforms)",
      },
      {
        path: "keygen.transforms.slug[3]",
        message:
          'Invalid transform step {"replace":{"from":" ","to":"_"},"trim":true}: expected a step name or a single-key mapping { <step>: <params> }',
      },
      {
        path: "keygen.transforms.spare[0]",
        message:
          "Unknown transform step 'to-kebab-case' (custom steps: keygen.plugins in opentp.cli.yaml, or --external-transforms)",
      },
      {
        path: "keygen.transforms.spare[1]",
        message:
          "Invalid transform step 7: expected a step name or a single-key mapping { <step>: <params> }",
      },
    ]);
  });

  it("accepts fragments as keygen variables and reports a missing keygen template", () => {
    const config = makeConfig();
    expect(getKeygenProblems(keygen({ template: "{verb}::{object}" }), config)).toEqual([]);
    expect(getKeygenProblems(keygen({ transforms: {} }), config)).toEqual([
      { path: "keygen.template", message: "Missing required field: keygen.template" },
    ]);
  });
});

describe("loadConfig", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function writePlan(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opentp-config-"));
    dirs.push(dir);
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    return dir;
  }

  const MINIMAL = [
    "info: { title: T, version: '1' }",
    "spec:",
    "  paths: { events: { root: /events, template: '{event}.yaml' } }",
    "  events:",
    "    taxonomy: {}",
    "    payload: { targets: { all: [web] } }",
    "",
  ].join("\n");

  it("loads a 2026-09 plan without spec.events.payload.schema (the catalog is optional)", () => {
    const dir = writePlan({ "opentp.yaml": `opentp: 2026-09\n${MINIMAL}` });
    const config = loadConfig(path.join(dir, "opentp.yaml"));
    expect(config.opentp).toBe("2026-09");
    expect(validateConfig(config)).toEqual([]);
  });

  it("checks the version first and guides 2026-01 plans to opentp migrate", () => {
    // The version check runs before anything else: the rest of this file is not even valid
    const dir = writePlan({ "opentp.yaml": "opentp: 2026-01\n" });
    expect(() => loadConfig(path.join(dir, "opentp.yaml"))).toThrow(
      /^This plan uses OpenTrackPlan 2026-01; opentp \d+\.\d+\.\d+\S* reads 2026-09\. Run "opentp migrate" to upgrade it \(or keep opentp 0\.9\.1: OPENTP_VERSION=0\.9\.1\)\.$/,
    );
    const other = writePlan({ "opentp.yaml": `opentp: 2025-12\n${MINIMAL}` });
    expect(() => loadConfig(path.join(other, "opentp.yaml"))).toThrow(
      "Unsupported OpenTrackPlan schema version '2025-12'. This CLI supports '2026-09'.",
    );
  });

  it("rejects opentp.yaml and opentp.yml in the same directory", () => {
    const dir = writePlan({
      "opentp.yaml": `opentp: 2026-09\n${MINIMAL}`,
      "opentp.yml": `opentp: 2026-09\n${MINIMAL}`,
    });
    expect(() => loadConfig(path.join(dir, "opentp.yml"))).toThrow(
      `Both opentp.yaml and opentp.yml exist in ${dir}; keep one`,
    );
  });

  it("lists the tool files of a plan root", () => {
    expect([...rootToolFiles("/plan")].sort()).toEqual([
      path.resolve("/plan/opentp.cli.yaml"),
      path.resolve("/plan/opentp.cli.yml"),
      path.resolve("/plan/opentp.yaml"),
      path.resolve("/plan/opentp.yml"),
    ]);
  });
});
