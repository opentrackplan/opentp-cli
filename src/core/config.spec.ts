import { describe, expect, it } from "vitest";
import type { OpenTPConfig } from "../types";
import { validateConfig } from "./config";

function makeConfig(): OpenTPConfig {
  return {
    opentp: "2026-01",
    info: { title: "Config test", version: "1.0.0" },
    spec: {
      paths: { events: { root: "/events", template: "{area}/{event}.yaml" } },
      events: {
        key: { pattern: "^[a-z:]+$" },
        "x-opentp": {
          keygen: { template: "{area | slug}::{event | slug}", transforms: { slug: ["lower"] } },
        },
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

  it("reports keygen problems once per problem", () => {
    const config = makeConfig();
    config.spec.events["x-opentp"] = {
      keygen: {
        template: "{area | slugify}::{event | slugify}::{team | slug}",
        transforms: { slug: ["lower"], broken: "lower" as unknown as string[] },
      },
    };
    expect(validateConfig(config)).toEqual([
      {
        path: "spec.events.x-opentp.keygen.transforms.broken",
        message: "Keygen pipeline 'broken' must be a list of steps",
      },
      {
        path: "spec.events.x-opentp.keygen.template",
        message:
          "Unknown keygen pipeline 'slugify'. Define it in spec.events.x-opentp.keygen.transforms.",
      },
      {
        path: "spec.events.x-opentp.keygen.template",
        message:
          "Unknown variable '{team}': keygen variables must be taxonomy fields or fragments declared in spec.events.taxonomy",
      },
    ]);
  });

  it("reports unknown and malformed keygen steps once, at their pipeline index", () => {
    const config = makeConfig();
    config.spec.events["x-opentp"] = {
      keygen: {
        template: "{area | slug}::{event | slug}",
        transforms: {
          slug: [
            "lower",
            "slugify",
            { truncate: 10 },
            { replace: { from: " ", to: "_" }, trim: true },
          ],
          // Unused pipelines are checked too
          spare: [{ "to-kebab-case": true }, 7 as unknown as string],
        },
      },
    };
    expect(validateConfig(config)).toEqual([
      {
        path: "spec.events.x-opentp.keygen.transforms.slug[1]",
        message:
          "Unknown transform step 'slugify' (custom steps are loaded with --external-transforms)",
      },
      {
        path: "spec.events.x-opentp.keygen.transforms.slug[3]",
        message:
          'Invalid transform step {"replace":{"from":" ","to":"_"},"trim":true}: expected a step name or a single-key mapping { <step>: <params> }',
      },
      {
        path: "spec.events.x-opentp.keygen.transforms.spare[0]",
        message:
          "Unknown transform step 'to-kebab-case' (custom steps are loaded with --external-transforms)",
      },
      {
        path: "spec.events.x-opentp.keygen.transforms.spare[1]",
        message:
          "Invalid transform step 7: expected a step name or a single-key mapping { <step>: <params> }",
      },
    ]);
  });

  it("accepts fragments as keygen variables and reports a missing keygen template", () => {
    const config = makeConfig();
    config.spec.events["x-opentp"] = { keygen: { template: "{verb}::{object}" } };
    expect(validateConfig(config)).toEqual([]);

    config.spec.events["x-opentp"] = {
      keygen: { transforms: {} } as unknown as { template: string },
    };
    expect(validateConfig(config)).toEqual([
      {
        path: "spec.events.x-opentp.keygen.template",
        message: "Missing required field: spec.events.x-opentp.keygen.template",
      },
    ]);
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
          "Unknown target 'desktop'. Keys of spec.targets must be listed in spec.events.payload.targets.all.",
      },
    ]);
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
