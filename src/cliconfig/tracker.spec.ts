import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateEvents } from "../core/validator";
import type { Field, OpenTPConfig } from "../types";
import { CliConfigError, readCliConfig } from "./index";
import {
  analyzeTrackerPath,
  type CliTracker,
  getTrackerProblems,
  IGLU_URI,
  isTrackerGlob,
  mergeTrackerSections,
  resolveTracker,
  resolveTrackerBinding,
  TRACKER_TYPES,
  type TrackerType,
  trackerGlobMatches,
  trackerPathForms,
} from "./tracker";

// --- Helpers -------------------------------------------------------------------------------------

interface PlanShape {
  catalog?: Record<string, Field>;
  /** spec.targets (all and per target) */
  targets?: Record<string, Record<string, Field>>;
  targetIds?: string[];
}

/** An in-memory opentp.yaml with only what the tracker binding reads */
function plan(shape: PlanShape = {}): OpenTPConfig {
  return {
    opentp: "2026-09",
    info: { title: "Tracker", version: "1.0.0" },
    spec: {
      paths: { events: { root: "/events", template: "{event}.yaml" } },
      targets: Object.fromEntries(
        Object.entries(shape.targets ?? {}).map(([id, schema]) => [id, { schema }]),
      ),
      events: {
        taxonomy: {},
        payload: {
          targets: { all: shape.targetIds ?? ["web", "ios"], mobile: ["ios"] },
          schema: shape.catalog ?? {},
        },
      },
    },
  };
}

/** A field binding whose path has only plain segments */
function bound(path: string, setBy?: "app" | "tracker") {
  const segments = path.split(".");
  return setBy === undefined ? { path, segments } : { path, segments, setBy };
}

const str: Field = { type: "string" };

/** The plan of most cases: catalog fields, common fields on every target and on ios */
const PLAN = plan({
  catalog: {
    dimension_1: str,
    dimension_2: str,
    dimension_10: str,
    auth_method: str,
    device_is_webview: { type: "boolean" },
  },
  targets: {
    all: { application_id: str, platform: str, user_id: str },
    ios: { os_version: str },
  },
});

function tracker(value: Record<string, unknown>): CliTracker {
  return value as unknown as CliTracker;
}

function problems(value: Record<string, unknown>, config: OpenTPConfig = PLAN) {
  return getTrackerProblems(tracker(value), config).map(({ path, message }) => [path, message]);
}

function paths(value: Record<string, unknown>, targetId: string, config: OpenTPConfig = PLAN) {
  const binding = resolveTrackerBinding(tracker(value), config);
  const fields = binding?.[targetId]?.fields ?? {};
  return Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.path]));
}

const EVENT_URI = "iglu:com.acme/event/jsonschema/1-0-0";
const DIMENSIONS_URI = "iglu:com.acme/dimensions/jsonschema/1-0-0";
const MOBILE_URI = "iglu:com.acme/mobile_context/jsonschema/1-0-0";

const ALL_FIELDS = "a catalog field (spec.events.payload.schema) or a common field (spec.targets)";

// --- Shape (opentp.cli.yaml) ---------------------------------------------------------------------

describe("tracker shape in opentp.cli.yaml", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function read(section: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opentp-tracker-"));
    dirs.push(dir);
    const file = path.join(dir, "opentp.cli.yaml");
    fs.writeFileSync(file, `opentp: 2026-09\ntracker:\n${section}`);
    return readCliConfig(file);
  }

  function shapeErrors(section: string): string[] {
    try {
      read(section);
    } catch (error) {
      if (error instanceof CliConfigError) return error.lines;
      throw error;
    }
    throw new Error("expected a CliConfigError");
  }

  it("accepts the documented snowplow example", () => {
    const config = read(`  type: snowplow
  event: ${EVENT_URI}
  contexts: { dimensions: ${DIMENSIONS_URI} }
  map:
    "dimension_*": contexts.dimensions
    application_id: atomic.app_id
  setBy:
    app: [user_id]
    tracker: [platform]
  targets:
    ios: { map: { device_is_webview: contexts.mobile_context.isWebview }, contexts: { mobile_context: ${MOBILE_URI} } }
`);
    expect(config.tracker).toMatchObject({
      type: "snowplow",
      map: { "dimension_*": "contexts.dimensions" },
      targets: { ios: { contexts: { mobile_context: MOBILE_URI } } },
    });
  });

  it.each([
    "ga4",
    "amplitude",
    "segment",
    "generic",
  ])("accepts type %s with map, setBy and targets", (type) => {
    const config = read(`  type: ${type}
  map: { user_id: user_id }
  setBy: { tracker: [platform] }
  targets: { web: { map: { auth_method: auth } } }
`);
    expect(config.tracker?.type).toBe(type);
  });

  it.each([
    [
      "  type: mixpanel\n",
      "tracker.type: Expected type snowplow, ga4, amplitude, segment or generic",
    ],
    ["  map: {}\n", "tracker.type: Expected type snowplow, ga4, amplitude, segment or generic"],
    ["  type: generic\n  mapping: {}\n", 'tracker: Unrecognized key: "mapping"'],
    ["  type: generic\n  setBy: { user: [user_id] }\n", 'tracker.setBy: Unrecognized key: "user"'],
    [
      "  type: snowplow\n  targets: { ios: { setBy: { app: [user_id] } } }\n",
      'tracker.targets.ios: Unrecognized key: "setBy"',
    ],
    [
      "  type: snowplow\n  targets: { ios: { event: x } }\n",
      'tracker.targets.ios: Unrecognized key: "event"',
    ],
    [
      "  type: generic\n  map: { a: 1 }\n",
      "tracker.map.a: Invalid input: expected string, received number",
    ],
    [
      "  type: generic\n  setBy: { app: user_id }\n",
      "tracker.setBy.app: Invalid input: expected array, received string",
    ],
    ["  [snowplow]\n", "tracker: Invalid input: expected object, received array"],
  ])("rejects a wrong shape (exit 2): %j", (section, expected) => {
    expect(shapeErrors(section)).toEqual([`opentp.cli.yaml: ${expected}`]);
  });

  it("accepts event and contexts for every type (other types: validation errors, not exit 2)", () => {
    const config = read(`  type: ga4
  event: ${EVENT_URI}
  contexts: { dims: ${DIMENSIONS_URI} }
  targets: { web: { contexts: { dims: ${DIMENSIONS_URI} } } }
`);
    expect(config.tracker).toMatchObject({ type: "ga4", event: EVENT_URI });
  });
});

// --- Path grammar --------------------------------------------------------------------------------

describe("analyzeTrackerPath", () => {
  type Case = [path: string, expected: "container" | "leaf" | "invalid", alias?: string];
  const GRAMMAR_CASES: Record<TrackerType, Case[]> = {
    snowplow: [
      ["atomic.app_id", "leaf"],
      ["atomic", "invalid"],
      ["atomic.app_id.x", "invalid"],
      ["event", "container"],
      ["event.org_type", "leaf"],
      ["event.org.type", "leaf"],
      ["contexts", "invalid"],
      ["contexts.dimensions", "container", "dimensions"],
      ["contexts.mobile_context.isWebview", "leaf", "mobile_context"],
      ["contexts.mobile_context.a.b", "leaf", "mobile_context"],
      ["params.x", "invalid"],
      ["user_id", "invalid"],
    ],
    ga4: [
      ["params", "container"],
      ["params.org_type", "leaf"],
      ["params.org.type", "invalid"],
      ["user_properties", "container"],
      ["user_properties.plan", "leaf"],
      ["user_properties.a.b", "invalid"],
      ["user_id", "leaf"],
      ["client_id", "leaf"],
      ["name", "leaf"],
      ["name.x", "invalid"],
      ["event", "invalid"],
    ],
    amplitude: [
      ["event_type", "leaf"],
      ["event_properties", "container"],
      ["event_properties.org_type", "leaf"],
      ["event_properties.a.b", "invalid"],
      ["user_properties", "container"],
      ["user_properties.plan", "leaf"],
      ["groups", "container"],
      ["groups.company", "leaf"],
      ["group_properties", "container"],
      ["group_properties.size", "leaf"],
      ["user_id", "leaf"],
      ["device_id", "leaf"],
      ["device_id.x", "invalid"],
      ["params", "invalid"],
    ],
    segment: [
      ["event", "leaf"],
      ["event.x", "invalid"],
      ["properties", "container"],
      ["properties.org_type", "leaf"],
      ["properties.a.b", "invalid"],
      ["traits", "container"],
      ["traits.plan", "leaf"],
      ["context", "container"],
      ["context.page.url", "leaf"],
      ["userId", "leaf"],
      ["anonymousId", "leaf"],
      ["user_id", "invalid"],
    ],
    generic: [
      ["user_id", "leaf"],
      ["event", "leaf"],
      ["payload.user.id", "leaf"],
      ["_private-x.y_1", "leaf"],
    ],
  };

  for (const type of TRACKER_TYPES) {
    it.each(GRAMMAR_CASES[type])(`${type}: %s is %s`, (written, expected, alias) => {
      const result = analyzeTrackerPath(type, written);
      if (expected === "invalid") {
        expect(result.problem).toBe(
          `Invalid path '${written}' for tracker type ${type}: expected ${trackerPathForms(type)
            .join(", ")
            .replace(/, ([^,]*)$/, " or $1")}`,
        );
        return;
      }
      expect(result).toEqual({
        shape: { container: expected === "container", ...(alias ? { alias } : {}) },
      });
    });
  }

  it("lists the exact forms of each type", () => {
    expect(Object.fromEntries(TRACKER_TYPES.map((type) => [type, trackerPathForms(type)]))).toEqual(
      {
        snowplow: ["atomic.<column>", "event[.<path>]", "contexts.<alias>[.<path>]"],
        ga4: ["params[.<name>]", "user_properties[.<name>]", "user_id", "client_id", "name"],
        amplitude: [
          "event_type",
          "event_properties[.<name>]",
          "user_properties[.<name>]",
          "groups[.<name>]",
          "group_properties[.<name>]",
          "user_id",
          "device_id",
        ],
        segment: [
          "event",
          "properties[.<name>]",
          "traits[.<name>]",
          "context[.<path>]",
          "userId",
          "anonymousId",
        ],
        generic: ["any dot path"],
      },
    );
    expect(analyzeTrackerPath("ga4", "params.a.b").problem).toBe(
      "Invalid path 'params.a.b' for tracker type ga4: expected params[.<name>], user_properties[.<name>], user_id, client_id or name",
    );
  });

  it.each([
    "a..b",
    ".a",
    "a.",
    "",
    "1st",
    "event.1st",
    "-a",
    "a b",
    "a/b",
    "événement",
    "a[0]",
  ])("rejects the segment grammar for every type: %j", (written) => {
    for (const type of TRACKER_TYPES) {
      expect(analyzeTrackerPath(type, written).problem).toBe(
        `Invalid path '${written}': segments are separated by '.' and match [A-Za-z_][A-Za-z0-9_-]*`,
      );
    }
  });

  it("does not take prototype names for roots", () => {
    expect(analyzeTrackerPath("ga4", "constructor").problem).toMatch(
      /^Invalid path 'constructor' for/,
    );
    expect(analyzeTrackerPath("snowplow", "toString.x").problem).toMatch(/^Invalid path/);
  });
});

describe("globs and Iglu URIs", () => {
  it("treats only '*' as special; it matches any text, also none", () => {
    expect(isTrackerGlob("dimension_*")).toBe(true);
    expect(isTrackerGlob("dimension_1")).toBe(false);
    const dimensions = (name: string) => trackerGlobMatches("dimension_*", name);
    expect(["dimension_1", "dimension_10", "dimension_"].every(dimensions)).toBe(true);
    expect(dimensions("dimension")).toBe(false);
    expect(dimensions("x_dimension_1")).toBe(false);
    expect(trackerGlobMatches("*_id", "user_id")).toBe(true);
    expect(trackerGlobMatches("a*b*c", "a--b--c")).toBe(true);
    expect(trackerGlobMatches("a*b*c", "a--c--b")).toBe(false);
    expect(trackerGlobMatches("*", "anything.at all")).toBe(true);
    expect(trackerGlobMatches("*", "")).toBe(true);
    expect(trackerGlobMatches("a**b", "ab")).toBe(true);
    // The prefix and the suffix may not overlap
    expect(trackerGlobMatches("ab*ba", "aba")).toBe(false);
    expect(trackerGlobMatches("ab*ba", "abba")).toBe(true);
    expect(trackerGlobMatches("a*aa*a", "aaa")).toBe(false);
    expect(trackerGlobMatches("a*aa*a", "aaaa")).toBe(true);
    // Regex characters are literal
    expect(trackerGlobMatches("a.b*", "a.bc")).toBe(true);
    expect(trackerGlobMatches("a.b*", "axbc")).toBe(false);
    expect(trackerGlobMatches("a+(b)?*", "a+(b)?x")).toBe(true);
    expect(trackerGlobMatches("a?", "ab")).toBe(false);
  });

  it("matches a glob with many stars against a long name in linear time (no backtracking)", () => {
    const glob = `${"a*".repeat(40)}b`;
    const started = Date.now();
    expect(trackerGlobMatches(glob, "a".repeat(100_000))).toBe(false);
    expect(trackerGlobMatches(glob, `${"a".repeat(100_000)}b`)).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);

    // Through the resolution of a whole tracker section too
    const config = plan({ catalog: { [`${"a".repeat(60)}`]: str } });
    expect(problems({ type: "generic", map: { [`${"a*".repeat(10)}b`]: "x" } }, config)).toEqual([
      [
        `tracker.map.${"a*".repeat(10)}b`,
        `'${"a*".repeat(10)}b' matches no field: expected it to match ${ALL_FIELDS}`,
      ],
    ]);
  });

  it.each([
    [EVENT_URI, true],
    ["iglu:com.acme-data/mobile_context/jsonschema/10-0-12", true],
    ["iglu:com.acme/event/jsonschema/1-0", false],
    ["iglu:com.acme/event/avro/1-0-0", false],
    ["iglu:/event/jsonschema/1-0-0", false],
    ["iglu:com acme/event/jsonschema/1-0-0", false],
    ["com.acme/event/jsonschema/1-0-0", false],
    [`${EVENT_URI}\n`, false],
  ])("Iglu URI %j: %s", (uri, valid) => {
    expect(IGLU_URI.test(uri)).toBe(valid);
  });
});

// --- Resolution ----------------------------------------------------------------------------------

describe("resolveTracker", () => {
  it("returns null without a tracker section", () => {
    expect(resolveTracker(undefined, PLAN)).toBeNull();
    expect(resolveTracker(null, PLAN)).toBeNull();
    expect(getTrackerProblems(undefined, PLAN)).toEqual([]);
    expect(resolveTrackerBinding(undefined, PLAN)).toBeNull();
  });

  const EXAMPLE = {
    type: "snowplow",
    event: EVENT_URI,
    contexts: { dimensions: DIMENSIONS_URI },
    map: {
      "dimension_*": "contexts.dimensions",
      application_id: "atomic.app_id",
      platform: "atomic.platform",
      user_id: "atomic.user_id",
    },
    setBy: { app: ["user_id", "application_id"], tracker: ["platform", "device_*"] },
    targets: {
      ios: {
        map: { device_is_webview: "contexts.mobile_context.isWebview" },
        contexts: { mobile_context: MOBILE_URI },
      },
    },
  };

  it("resolves the documented example per target, with setBy and contexts", () => {
    const resolution = resolveTracker(tracker(EXAMPLE), PLAN);
    expect(resolution?.problems).toEqual([]);
    expect(resolution?.binding).toEqual({
      web: {
        type: "snowplow",
        event: EVENT_URI,
        contexts: { dimensions: DIMENSIONS_URI },
        fields: {
          application_id: bound("atomic.app_id", "app"),
          auth_method: bound("event.auth_method"),
          device_is_webview: bound("event.device_is_webview", "tracker"),
          dimension_1: bound("contexts.dimensions.dimension_1"),
          dimension_2: bound("contexts.dimensions.dimension_2"),
          dimension_10: bound("contexts.dimensions.dimension_10"),
          platform: bound("atomic.platform", "tracker"),
          user_id: bound("atomic.user_id", "app"),
        },
      },
      ios: {
        type: "snowplow",
        event: EVENT_URI,
        contexts: { dimensions: DIMENSIONS_URI, mobile_context: MOBILE_URI },
        fields: {
          application_id: bound("atomic.app_id", "app"),
          auth_method: bound("event.auth_method"),
          device_is_webview: bound("contexts.mobile_context.isWebview", "tracker"),
          dimension_1: bound("contexts.dimensions.dimension_1"),
          dimension_2: bound("contexts.dimensions.dimension_2"),
          dimension_10: bound("contexts.dimensions.dimension_10"),
          os_version: bound("event.os_version"),
          platform: bound("atomic.platform", "tracker"),
          user_id: bound("atomic.user_id", "app"),
        },
      },
    });
    // Natural order of field names, targets in targets.all order
    expect(Object.keys(resolution?.binding.ios.fields ?? {})).toEqual([
      "application_id",
      "auth_method",
      "device_is_webview",
      "dimension_1",
      "dimension_2",
      "dimension_10",
      "os_version",
      "platform",
      "user_id",
    ]);
    expect(Object.keys(resolution?.binding ?? {})).toEqual(["web", "ios"]);
  });

  it("follows the resolution order: exact target, exact global, target globs, global globs", () => {
    const config = plan({ catalog: { a_b: str } });
    const all = {
      type: "generic",
      map: { a_b: "exact_global", "a_*": "glob_global" },
      targets: { web: { map: { a_b: "exact_target", "*_b": "glob_target" } } },
    };
    expect(paths(all, "web", config)).toEqual({ a_b: "exact_target" });
    expect(paths(all, "ios", config)).toEqual({ a_b: "exact_global" });

    // An exact global entry beats a glob of the target's map
    const exactGlobal = { ...all, targets: { web: { map: { "*_b": "glob_target" } } } };
    expect(paths(exactGlobal, "web", config)).toEqual({ a_b: "exact_global" });

    const globsOnly = {
      type: "generic",
      map: { "a_*": "glob_global" },
      targets: { web: { map: { "*_b": "glob_target" } } },
    };
    expect(paths(globsOnly, "web", config)).toEqual({ a_b: "glob_target" });
    expect(paths(globsOnly, "ios", config)).toEqual({ a_b: "glob_global" });
    for (const value of [all, exactGlobal, globsOnly]) expect(problems(value, config)).toEqual([]);
  });

  it.each([
    ["snowplow", "event.f"],
    ["ga4", "params.f"],
    ["amplitude", "event_properties.f"],
    ["segment", "properties.f"],
    ["generic", "f"],
  ])("puts an unmapped field of a %s tracker at %s", (type, expected) => {
    const config = plan({ catalog: { f: str } });
    expect(paths({ type }, "web", config)).toEqual({ f: expected });
    expect(problems({ type }, config)).toEqual([]);
  });

  it.each([
    ["snowplow", "event", "event.f"],
    ["snowplow", "contexts.dims", "contexts.dims.f"],
    ["snowplow", "contexts.dims.custom", "contexts.dims.custom"],
    ["snowplow", "atomic.app_id", "atomic.app_id"],
    ["ga4", "params", "params.f"],
    ["ga4", "user_properties", "user_properties.f"],
    ["ga4", "user_properties.plan", "user_properties.plan"],
    ["ga4", "user_id", "user_id"],
    ["amplitude", "event_properties", "event_properties.f"],
    ["amplitude", "user_properties", "user_properties.f"],
    ["amplitude", "groups", "groups.f"],
    ["amplitude", "group_properties", "group_properties.f"],
    ["amplitude", "device_id", "device_id"],
    ["segment", "properties", "properties.f"],
    ["segment", "traits", "traits.f"],
    ["segment", "context", "context.f"],
    ["segment", "context.page", "context.page"],
    ["segment", "anonymousId", "anonymousId"],
    // generic has no containers: the path is used as written
    ["generic", "payload", "payload"],
    ["generic", "payload.data.f2", "payload.data.f2"],
  ])("%s: a field mapped to %s goes to %s", (type, mapped, expected) => {
    const config = plan({ catalog: { f: str } });
    const value = {
      type,
      map: { f: mapped },
      ...(type === "snowplow" ? { contexts: { dims: DIMENSIONS_URI } } : {}),
    };
    expect(paths(value, "web", config)).toEqual({ f: expected });
    expect(problems(value, config)).toEqual([]);
  });

  it("lets a target's contexts add aliases and replace the URI of a global one", () => {
    const binding = resolveTrackerBinding(
      tracker({
        type: "snowplow",
        contexts: { dims: DIMENSIONS_URI },
        targets: {
          ios: {
            contexts: {
              dims: "iglu:com.acme/dimensions/jsonschema/2-0-0",
              mobile_context: MOBILE_URI,
            },
          },
        },
      }),
      PLAN,
    );
    expect(binding?.web.contexts).toEqual({ dims: DIMENSIONS_URI });
    expect(binding?.ios.contexts).toEqual({
      dims: "iglu:com.acme/dimensions/jsonschema/2-0-0",
      mobile_context: MOBILE_URI,
    });
  });

  it("gives non-snowplow targets empty contexts and no event", () => {
    const binding = resolveTrackerBinding(tracker({ type: "ga4" }), PLAN);
    expect(binding?.web).toMatchObject({ type: "ga4", contexts: {} });
    expect(binding?.web).not.toHaveProperty("event");
    // A snowplow tracker without an event schema has no event either
    expect(resolveTrackerBinding(tracker({ type: "snowplow" }), PLAN)?.web).not.toHaveProperty(
      "event",
    );
  });

  it("resolves catalog fields and the common fields of each target only", () => {
    expect(Object.keys(paths({ type: "generic" }, "web"))).not.toContain("os_version");
    expect(Object.keys(paths({ type: "generic" }, "ios"))).toContain("os_version");
    // Targets without spec.targets entries get the catalog and spec.targets.all
    const config = plan({
      catalog: { a: str },
      targets: { all: { b: str } },
      targetIds: ["server"],
    });
    expect(paths({ type: "generic" }, "server", config)).toEqual({ a: "a", b: "b" });
  });
});

// --- Problems ------------------------------------------------------------------------------------

describe("tracker problems", () => {
  it("map keys and setBy entries must name plan fields; globs must match one", () => {
    expect(
      problems({
        type: "snowplow",
        map: { dimension_l: "event.x", "dim_*": "event", "": "event.y" },
        setBy: { app: ["user_id", "usr_id"], tracker: ["*_flag"] },
      }),
    ).toEqual([
      [
        "tracker.setBy.app[1]",
        `Unknown field 'usr_id': expected ${ALL_FIELDS}. Did you mean 'user_id'?`,
      ],
      ["tracker.setBy.tracker[0]", `'*_flag' matches no field: expected it to match ${ALL_FIELDS}`],
      [
        "tracker.map.dimension_l",
        `Unknown field 'dimension_l': expected ${ALL_FIELDS}. Did you mean 'dimension_1' or 'dimension_2'?`,
      ],
      ["tracker.map.dim_*", `'dim_*' matches no field: expected it to match ${ALL_FIELDS}`],
      ["tracker.map.", `Unknown field '': expected ${ALL_FIELDS}`],
    ]);
  });

  it("reports event and contexts on a type other than snowplow (validation errors)", () => {
    expect(
      problems({
        type: "ga4",
        event: EVENT_URI,
        contexts: { dims: DIMENSIONS_URI },
        targets: { web: { contexts: { dims: DIMENSIONS_URI } }, tv: { contexts: {} } },
      }),
    ).toEqual([
      ["tracker.event", "'event' is only allowed for tracker type snowplow"],
      ["tracker.contexts", "'contexts' is only allowed for tracker type snowplow"],
      ["tracker.targets.web.contexts", "'contexts' is only allowed for tracker type snowplow"],
      ["tracker.targets.tv.contexts", "'contexts' is only allowed for tracker type snowplow"],
      [
        "tracker.targets.tv",
        "Unknown target 'tv': expected one of web, ios (spec.events.payload.targets.all)",
      ],
    ]);
    // They do not reach the binding
    const binding = resolveTrackerBinding(
      tracker({ type: "segment", event: EVENT_URI, contexts: { dims: DIMENSIONS_URI } }),
      PLAN,
    );
    expect(binding?.web).toMatchObject({ type: "segment", contexts: {} });
    expect(binding?.web).not.toHaveProperty("event");
  });

  it("per-target map keys must name a catalog field or a common field of that target", () => {
    expect(
      problems({
        type: "snowplow",
        map: { os_version: "event.os" },
        targets: {
          web: { map: { os_version: "event.os", "os_*": "event" } },
          ios: { map: { os_version: "event.os" } },
        },
      }),
    ).toEqual([
      [
        "tracker.targets.web.map.os_version",
        "Unknown field 'os_version': expected a catalog field or a common field of target 'web' (spec.targets.all/web.schema)",
      ],
      [
        "tracker.targets.web.map.os_*",
        "'os_*' matches no field: expected it to match a catalog field or a common field of target 'web' (spec.targets.all/web.schema)",
      ],
    ]);
  });

  it("reports a field in both setBy.app and setBy.tracker, also through globs", () => {
    expect(
      problems({
        type: "generic",
        setBy: { app: ["user_*", "platform"], tracker: ["*_id", "platform"] },
      }),
    ).toEqual([
      ["tracker.setBy", "Field 'platform' is in both setBy.app and setBy.tracker"],
      ["tracker.setBy", "Field 'user_id' is in both setBy.app and setBy.tracker"],
    ]);
  });

  it("checks paths against the grammar of the type, in the global and per-target maps", () => {
    expect(
      problems({
        type: "ga4",
        map: { auth_method: "event_params.auth", user_id: "user_id" },
        targets: { ios: { map: { os_version: "params.os.version", platform: "platform name" } } },
      }),
    ).toEqual([
      [
        "tracker.map.auth_method",
        "Invalid path 'event_params.auth' for tracker type ga4: expected params[.<name>], user_properties[.<name>], user_id, client_id or name",
      ],
      [
        "tracker.targets.ios.map.os_version",
        "Invalid path 'params.os.version' for tracker type ga4: expected params[.<name>], user_properties[.<name>], user_id, client_id or name",
      ],
      [
        "tracker.targets.ios.map.platform",
        "Invalid path 'platform name': segments are separated by '.' and match [A-Za-z_][A-Za-z0-9_-]*",
      ],
    ]);
    // A field with an invalid path is left out of the binding (and causes no other problems)
    expect(
      paths({ type: "ga4", map: { auth_method: "event_params.auth" } }, "web"),
    ).not.toHaveProperty("auth_method");
  });

  it("checks Iglu URIs and context aliases (snowplow)", () => {
    expect(
      problems({
        type: "snowplow",
        event: "iglu:com.acme/event/jsonschema/1-0",
        contexts: { dimensions: DIMENSIONS_URI, "1st": MOBILE_URI, web: "https://example.com/web" },
        targets: { ios: { contexts: { "mobile.context": "iglu:com.acme/mobile/jsonschema/1" } } },
      }),
    ).toEqual([
      [
        "tracker.event",
        "Invalid Iglu URI 'iglu:com.acme/event/jsonschema/1-0': expected iglu:<vendor>/<name>/jsonschema/<model>-<revision>-<addition>",
      ],
      [
        "tracker.contexts.1st",
        "Invalid context alias '1st': it must match [A-Za-z_][A-Za-z0-9_-]*",
      ],
      [
        "tracker.contexts.web",
        "Invalid Iglu URI 'https://example.com/web': expected iglu:<vendor>/<name>/jsonschema/<model>-<revision>-<addition>",
      ],
      [
        "tracker.targets.ios.contexts.mobile.context",
        "Invalid context alias 'mobile.context': it must match [A-Za-z_][A-Za-z0-9_-]*",
      ],
      [
        "tracker.targets.ios.contexts.mobile.context",
        "Invalid Iglu URI 'iglu:com.acme/mobile/jsonschema/1': expected iglu:<vendor>/<name>/jsonschema/<model>-<revision>-<addition>",
      ],
    ]);
  });

  it("needs context aliases declared globally or for the target", () => {
    const config = plan({
      catalog: { device_is_webview: { type: "boolean" }, a: str, b: str },
      targetIds: ["web", "ios", "android"],
    });
    expect(
      problems(
        {
          type: "snowplow",
          map: {
            // Used on web and android, declared only for ios
            device_is_webview: "contexts.mobile_context.isWebview",
            // Declared nowhere, and used on no target (every target maps `a` itself)
            a: "contexts.nowhere",
          },
          targets: {
            web: { map: { a: "event.a", b: "contexts.missing" } },
            ios: { contexts: { mobile_context: MOBILE_URI }, map: { a: "event.a" } },
            android: { map: { a: "event.a" } },
          },
        },
        config,
      ),
    ).toEqual([
      [
        "tracker.targets.web.map.b",
        "Context alias 'missing' is not declared in tracker.contexts or tracker.targets.web.contexts",
      ],
      ["tracker.map.a", "Context alias 'nowhere' is not declared in tracker.contexts"],
      [
        "tracker.map.device_is_webview",
        "Context alias 'mobile_context' is not declared in tracker.contexts or tracker.targets.<id>.contexts (targets: web, android)",
      ],
    ]);
    // Declared globally: fine everywhere
    expect(
      problems(
        {
          type: "snowplow",
          contexts: { mobile_context: MOBILE_URI },
          map: { device_is_webview: "contexts.mobile_context.isWebview" },
        },
        config,
      ),
    ).toEqual([]);
  });

  it("accepts only target ids from spec.events.payload.targets.all as targets keys", () => {
    expect(problems({ type: "generic", targets: { mobile: {}, desktop: {}, ios: {} } })).toEqual([
      [
        "tracker.targets.mobile",
        "Unknown target 'mobile': expected one of web, ios (spec.events.payload.targets.all)",
      ],
      [
        "tracker.targets.desktop",
        "Unknown target 'desktop': expected one of web, ios (spec.events.payload.targets.all)",
      ],
    ]);
    expect(problems({ type: "generic", targets: { web: {} } }, plan({ targetIds: [] }))).toEqual([
      [
        "tracker.targets.web",
        "Unknown target 'web': spec.events.payload.targets.all lists no targets",
      ],
    ]);
  });

  it("reports two globs of the same step that map a field to different paths", () => {
    expect(
      problems({
        type: "snowplow",
        map: {
          "dimension_*": "event.dims",
          "*_1": "event.ones",
          // Same path as dimension_*: no conflict for dimension_2
          "*_2": "event.dims",
        },
        targets: {
          ios: { map: { "dim*": "event.d", "*sion_1*": "event.e" } },
        },
      }),
    ).toEqual([
      [
        "tracker.map",
        "Field 'dimension_1' matches the globs 'dimension_*' (event.dims) and '*_1' (event.ones): add an exact entry for it or make the globs disjoint",
      ],
      [
        "tracker.targets.ios.map",
        "Field 'dimension_1' matches the globs 'dim*' (event.d) and '*sion_1*' (event.e): add an exact entry for it or make the globs disjoint",
      ],
      [
        "tracker.targets.ios.map",
        "Field 'dimension_10' matches the globs 'dim*' (event.d) and '*sion_1*' (event.e): add an exact entry for it or make the globs disjoint",
      ],
      [
        "tracker.map.dimension_*",
        "Fields 'dimension_1', 'dimension_2' and 'dimension_10' map to the same path 'event.dims' (target: web)",
      ],
      [
        "tracker.targets.ios.map.dim*",
        "Fields 'dimension_1', 'dimension_2' and 'dimension_10' map to the same path 'event.d' (target: ios)",
      ],
    ]);
  });

  it("does not report glob conflicts that an earlier step decides", () => {
    const value = {
      type: "snowplow",
      map: { "dimension_*": "contexts.dims", "*_1": "event", dimension_1: "event.org_type" },
      contexts: { dims: DIMENSIONS_URI },
    };
    expect(problems(value)).toEqual([]);
    expect(paths(value, "web").dimension_1).toBe("event.org_type");

    // A glob of targets.ios.map (step 3) decides on ios; web still reaches the global globs
    const conflicting = {
      type: "generic",
      map: { "dimension_*": "dims", "*_1": "ones" },
      targets: { ios: { map: { "dim*": "d" } } },
    };
    expect(problems(conflicting)).toEqual([
      [
        "tracker.map",
        "Field 'dimension_1' matches the globs 'dimension_*' (dims) and '*_1' (ones): add an exact entry for it or make the globs disjoint",
      ],
      [
        "tracker.map.dimension_*",
        "Fields 'dimension_1', 'dimension_2' and 'dimension_10' map to the same path 'dims' (target: web)",
      ],
      [
        "tracker.targets.ios.map.dim*",
        "Fields 'dimension_1', 'dimension_2' and 'dimension_10' map to the same path 'd' (target: ios)",
      ],
    ]);
  });

  it("reports two fields with the same final path at a map entry, also with an unmapped field", () => {
    const config = plan({ catalog: { auth_method: str, step_index: str } });
    expect(
      problems({ type: "snowplow", map: { auth_method: "event.step_index" } }, config),
    ).toEqual([
      [
        "tracker.map.auth_method",
        "Fields 'auth_method' and 'step_index' map to the same path 'event.step_index' (targets: web, ios)",
      ],
    ]);
  });

  it("reports two fields with the same final path, per target", () => {
    expect(
      problems({
        type: "snowplow",
        map: { auth_method: "event.method", user_id: "event.platform" },
        targets: { ios: { map: { os_version: "event.method" } } },
      }),
    ).toEqual([
      [
        "tracker.map.user_id",
        "Fields 'platform' and 'user_id' map to the same path 'event.platform' (targets: web, ios)",
      ],
      [
        "tracker.targets.ios.map.os_version",
        "Fields 'auth_method' and 'os_version' map to the same path 'event.method' (target: ios)",
      ],
    ]);
  });

  it("reports a path inside the path of another field", () => {
    const config = plan({ catalog: { user: str, user_id: str, page: str, page_url: str } });
    expect(problems({ type: "generic", map: { user_id: "user.id" } }, config)).toEqual([
      [
        "tracker.map.user_id",
        "Field 'user_id' maps to 'user.id', inside the path 'user' of field 'user' (targets: web, ios)",
      ],
    ]);
    expect(
      problems({ type: "segment", map: { page: "context", page_url: "context.page.url" } }, config),
    ).toEqual([
      [
        "tracker.map.page_url",
        "Field 'page_url' maps to 'context.page.url', inside the path 'context.page' of field 'page' (targets: web, ios)",
      ],
    ]);
  });

  it("appends any field name as one segment, where it is appended or the default", () => {
    const config = plan({
      catalog: { "2nd_step": str, "Item Name": str, "page.url": str, ok: str },
    });
    expect(problems({ type: "snowplow" }, config)).toEqual([]);
    expect(problems({ type: "generic" }, config)).toEqual([]);
    expect(
      problems({ type: "amplitude", map: { "Item Name": "event_properties" } }, config),
    ).toEqual([]);

    const amplitude = resolveTrackerBinding(
      tracker({ type: "amplitude", map: { "*": "user_properties" } }),
      config,
    );
    expect(amplitude?.web.fields).toEqual({
      "2nd_step": { path: "user_properties.2nd_step", segments: ["user_properties", "2nd_step"] },
      "Item Name": {
        path: "user_properties.Item Name",
        segments: ["user_properties", "Item Name"],
      },
      ok: { path: "user_properties.ok", segments: ["user_properties", "ok"] },
      "page.url": { path: "user_properties.page.url", segments: ["user_properties", "page.url"] },
    });
    expect(resolveTrackerBinding(tracker({ type: "generic" }), config)?.ios.fields).toEqual({
      "2nd_step": { path: "2nd_step", segments: ["2nd_step"] },
      "Item Name": { path: "Item Name", segments: ["Item Name"] },
      ok: { path: "ok", segments: ["ok"] },
      "page.url": { path: "page.url", segments: ["page.url"] },
    });
    // A container path written in a map still follows the segment grammar
    expect(problems({ type: "generic", map: { "Item Name": "props.Item Name" } }, config)).toEqual([
      [
        "tracker.map.Item Name",
        "Invalid path 'props.Item Name': segments are separated by '.' and match [A-Za-z_][A-Za-z0-9_-]*",
      ],
    ]);
  });

  it("keeps a field named __proto__ as an own key of the binding", () => {
    const config = plan({ catalog: JSON.parse('{"__proto__": {"type": "string"}}') });
    const fields = resolveTrackerBinding(tracker({ type: "segment" }), config)?.web.fields ?? {};
    expect(Object.keys(fields)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(fields)).toBe(Object.prototype);
  });

  it("compares paths by segments: a dot inside a field name is not a separator", () => {
    const config = plan({ catalog: { "page.url": str, page: str, url: str, page_url: str } });
    // page.url (one segment) and page_url -> page.url (two segments) do not collide
    expect(problems({ type: "generic", map: { page_url: "page.url" } }, config)).toEqual([
      [
        "tracker.map.page_url",
        "Field 'page_url' maps to 'page.url', inside the path 'page' of field 'page' (targets: web, ios)",
      ],
    ]);
    expect(problems({ type: "generic", map: { page: "p", page_url: "page.url" } }, config)).toEqual(
      [],
    );
    // The same segments still collide
    expect(
      problems({ type: "segment", map: { url: "properties", page_url: "properties.url" } }, config),
    ).toEqual([
      [
        "tracker.map.url",
        "Fields 'page_url' and 'url' map to the same path 'properties.url' (targets: web, ios)",
      ],
    ]);
  });

  it("are validation errors against opentp.cli.yaml, reported once by validateEvents", async () => {
    const results = await validateEvents([], PLAN, new Map(), {
      tracker: tracker({ type: "generic", map: { usr_id: "user" } }),
    });
    expect(results.filter((result) => result.event === "opentp.cli.yaml")).toEqual([
      {
        event: "opentp.cli.yaml",
        path: "tracker.map.usr_id",
        message: `Unknown field 'usr_id': expected ${ALL_FIELDS}. Did you mean 'user_id'?`,
        severity: "error",
      },
    ]);
    const without = await validateEvents([], PLAN, new Map(), {});
    expect(without.filter((result) => result.event === "opentp.cli.yaml")).toEqual([]);
  });
});

// --- Application repositories --------------------------------------------------------------------

describe("mergeTrackerSections", () => {
  const BASE = tracker({
    type: "snowplow",
    event: EVENT_URI,
    contexts: { dimensions: DIMENSIONS_URI },
    map: { "dimension_*": "contexts.dimensions", application_id: "atomic.app_id" },
    setBy: { app: ["user_id"], tracker: ["platform"] },
    targets: {
      ios: {
        contexts: { mobile_context: MOBILE_URI },
        map: { device_is_webview: "contexts.mobile_context.isWebview" },
      },
    },
  });

  it("returns the one section that exists", () => {
    expect(mergeTrackerSections(undefined, undefined)).toBeUndefined();
    expect(mergeTrackerSections(BASE, undefined)).toBe(BASE);
    expect(mergeTrackerSections(null, BASE)).toBe(BASE);
  });

  it("merges mappings by key (the application wins) and replaces arrays and scalars", () => {
    const app = tracker({
      type: "snowplow",
      event: "iglu:com.acme/event/jsonschema/2-0-0",
      contexts: { app_context: "iglu:com.acme/app_context/jsonschema/1-0-0" },
      map: { application_id: "event.app", auth_method: "event.method" },
      setBy: { app: ["application_id"] },
      targets: {
        ios: { map: { os_version: "contexts.mobile_context" } },
        web: { map: { auth_method: "event.web_method" } },
      },
    });
    const before = JSON.stringify(BASE);
    expect(mergeTrackerSections(BASE, app)).toEqual({
      type: "snowplow",
      event: "iglu:com.acme/event/jsonschema/2-0-0",
      contexts: {
        dimensions: DIMENSIONS_URI,
        app_context: "iglu:com.acme/app_context/jsonschema/1-0-0",
      },
      map: {
        "dimension_*": "contexts.dimensions",
        application_id: "event.app",
        auth_method: "event.method",
      },
      setBy: { app: ["application_id"], tracker: ["platform"] },
      targets: {
        ios: {
          contexts: { mobile_context: MOBILE_URI },
          map: {
            device_is_webview: "contexts.mobile_context.isWebview",
            os_version: "contexts.mobile_context",
          },
        },
        web: { map: { auth_method: "event.web_method" } },
      },
    });
    // The inputs are not changed
    expect(JSON.stringify(BASE)).toBe(before);
  });

  it("replaces the plan's section when the application names another type", () => {
    const app = tracker({ type: "ga4", map: { user_id: "user_id" } });
    expect(mergeTrackerSections(BASE, app)).toEqual(app);
  });

  it("labels the problems at keys that only the plan repository's section has (TrackerOrigin)", () => {
    const planLabel = "opentp.cli.yaml of the plan '../plan'";
    const base = tracker({
      type: "ga4",
      event: EVENT_URI,
      map: { plan_only: "params.a", both: "params.b" },
      setBy: { app: ["nobody"], tracker: ["user_id"] },
      targets: { ios: { contexts: { mobile: MOBILE_URI }, map: { ios_only: "params.c" } } },
    });
    const app = tracker({
      type: "ga4",
      map: { both: "params.b", app_only: "params.d" },
      setBy: { app: ["user_id"] },
    });
    const merged = mergeTrackerSections(base, app);
    const labelled = (origin?: { app: CliTracker | undefined; planLabel: string }) =>
      getTrackerProblems(merged, PLAN, origin).map(({ path, file }) => [path, file ?? null]);
    expect(labelled({ app, planLabel })).toEqual([
      ["tracker.event", planLabel],
      // From both sections (setBy.app is the application's list, setBy.tracker the plan's)
      ["tracker.setBy", null],
      ["tracker.map.plan_only", planLabel],
      ["tracker.map.both", null],
      ["tracker.map.app_only", null],
      ["tracker.targets.ios.contexts", planLabel],
      ["tracker.targets.ios.map.ios_only", planLabel],
    ]);
    // Without an origin (a plan repository) nothing is labelled; without an application section
    // everything is the plan's
    expect(labelled().every(([, file]) => file === null)).toBe(true);
    const planOnly = getTrackerProblems(base, PLAN, { app: undefined, planLabel });
    expect(planOnly.length).toBeGreaterThan(0);
    expect(planOnly.every((problem) => problem.file === planLabel)).toBe(true);
  });

  it("keeps a __proto__ key a plain key", () => {
    const app = JSON.parse('{ "type": "generic", "map": { "__proto__": "x" } }') as CliTracker;
    const base = tracker({ type: "generic", map: { a: "a" } });
    const merged = mergeTrackerSections(base, app) as { map: Record<string, string> };
    expect(Object.getPrototypeOf(merged.map)).toBe(Object.prototype);
    expect(Object.hasOwn(merged.map, "__proto__")).toBe(true);
    expect(merged.map.a).toBe("a");
  });
});
