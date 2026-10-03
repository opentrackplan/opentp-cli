import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../cli";
import type { EventPayload, Field, OpenTPConfig, ResolvedEvent } from "../types";
import { setLogLevel } from "../util/logger";
import { parseYaml } from "../util/yaml";
import { naturalCompare } from "./fields";
import {
  ABSENT,
  compareVersions,
  eventPredicates,
  fieldTerm,
  findOverlaps,
  intersects,
  isWithin,
  OverlapIndex,
  type OverlapStats,
  overlapIgnores,
  overlapResults,
  overlapsWith,
  type VersionPredicate,
  valueToken,
  versionPredicate,
} from "./overlap";
import { BaseFieldCache, effectiveFields, resolveEventPayload } from "./payload";
import { validateEvents } from "./validator";

// findOverlaps is wrapped in a spy: severity `off` must skip the computation
vi.mock("./overlap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./overlap")>();
  return { ...actual, findOverlaps: vi.fn(actual.findOverlaps) };
});

const fixture = (name: string) => path.join(process.cwd(), "tests", "data", name);

// --- Helpers -------------------------------------------------------------------------------------

interface ConfigOptions {
  catalog?: Record<string, Field>;
  common?: Record<string, Field>;
  targets?: string[];
}

function makeConfig(options: ConfigOptions = {}): OpenTPConfig {
  return {
    opentp: "2026-09",
    info: { title: "Overlap", version: "1.0.0" },
    spec: {
      paths: { events: { root: "/events", template: "{area}/{event}.yaml" } },
      targets: { all: { schema: options.common ?? {} } },
      events: {
        taxonomy: {},
        payload: {
          targets: { all: options.targets ?? ["web", "ios"] },
          schema: options.catalog ?? {},
        },
      },
    },
  };
}

/** An event at `<relativePath>` whose key is the path without `.yaml`, `/` replaced by `::` */
function makeEvent(
  relativePath: string,
  payload: unknown,
  extra: Partial<ResolvedEvent> = {},
): ResolvedEvent {
  return {
    filePath: `/plan/events/${relativePath}`,
    relativePath,
    key: relativePath.replace(/\.yaml$/, "").replace("/", "::"),
    expectedKey: null,
    taxonomy: {},
    ignore: [],
    payload: payload as EventPayload,
    ...extra,
  };
}

const CATALOG: Record<string, Field> = {
  event_name: { type: "string" },
  label: { type: "string" },
  screen: { type: "string", enum: ["home", "settings", "checkout"] },
  auth_method: { type: "string", dict: "auth_methods" },
  tags: { type: "array", items: { type: "string", enum: ["a", "b"] } },
  code: { type: "string" },
  count: { type: "integer" },
};

const CONFIG = makeConfig({
  catalog: CATALOG,
  common: {
    application_id: { type: "string", value: "acme-app" },
    event_category: { type: "string", policy: "restricted" },
  },
});

const DICTIONARIES = new Map([["auth_methods", ["email", "google", "github"]]]);

function messages(events: ResolvedEvent[], config = CONFIG): Array<[string, string]> {
  return overlapResults(
    findOverlaps(events, config, { dictionaries: DICTIONARIES }),
    "warning",
  ).map((result) => [result.event, result.message]);
}

const predicate = (
  fields: Record<string, Field>,
  options: { exempt?: boolean } = {},
): VersionPredicate =>
  versionPredicate(Object.entries(fields), options.exempt ?? false, (dict) =>
    dict === "auth_methods" ? ["email", "google", "github"] : null,
  );

// --- Predicates ----------------------------------------------------------------------------------

describe("fieldTerm", () => {
  const lookup = (dict: string) => (dict === "methods" ? ["email", "google"] : null);

  it("a fixed value allows exactly that value, by type and value", () => {
    expect(fieldTerm({ value: "1" }, false)).toEqual(new Set([valueToken("1")]));
    expect(valueToken("1")).not.toBe(valueToken(1));
    expect(valueToken(true)).not.toBe(valueToken("true"));
    // Always present: no ABSENT even when the field is not required
    expect(fieldTerm({ type: "string", value: "x" }, true)?.has(ABSENT)).toBe(false);
  });

  it("an enum allows its members, plus ABSENT when the field is optional", () => {
    const optional = fieldTerm({ type: "string", enum: ["a", "b"] }, false);
    expect(optional).toEqual(new Set([valueToken("a"), valueToken("b"), ABSENT]));
    expect(fieldTerm({ type: "string", enum: ["a"], required: true }, false)).toEqual(
      new Set([valueToken("a")]),
    );
  });

  it("a restricted or fixed policy makes the field present, except in deprecated versions", () => {
    const restricted: Field = { type: "string", enum: ["a"], policy: "restricted" };
    expect(fieldTerm(restricted, false)).toEqual(new Set([valueToken("a")]));
    expect(fieldTerm(restricted, true)).toEqual(new Set([valueToken("a"), ABSENT]));
    expect(
      fieldTerm({ type: "string", enum: ["a"], policy: "specified" }, false)?.has(ABSENT),
    ).toBe(true);
    // required: true wins over the exemption
    expect(fieldTerm({ ...restricted, required: true }, true)?.has(ABSENT)).toBe(false);
  });

  it("a known dictionary allows its values; an unknown dictionary leaves the field free", () => {
    expect(fieldTerm({ type: "string", dict: "methods" }, false, lookup)).toEqual(
      new Set([valueToken("email"), valueToken("google"), ABSENT]),
    );
    expect(fieldTerm({ type: "string", dict: "nope" }, false, lookup)).toBeNull();
    expect(fieldTerm({ type: "string", dict: "methods" }, false)).toBeNull();
  });

  it("arrays without a value and fields without restrictions are free; items.enum is not identity", () => {
    expect(fieldTerm({ type: "array", items: { type: "string", enum: ["a"] } }, false)).toBeNull();
    expect(fieldTerm({ type: "string" }, false)).toBeNull();
    expect(fieldTerm({}, false)).toBeNull();
    expect(fieldTerm({ type: "array", value: ["a", "b"] }, false)).toEqual(
      new Set([valueToken(["a", "b"])]),
    );
    expect(valueToken(["a", "b"])).not.toBe(valueToken(["b", "a"]));
    expect(valueToken([1])).not.toBe(valueToken(["1"]));
  });
});

describe("eventPredicates", () => {
  it("lists the version predicates per target (targets.all order, versions in file order)", () => {
    const event = makeEvent("a/one.yaml", {
      ios: {
        current: "2.0.0",
        "1.0.0": {
          meta: { deprecated: { reason: "Old builds" } },
          schema: { event_category: { enum: ["auth"] } },
        },
        "2.0.0": { schema: { event_category: { value: "auth" }, auth_method: {} } },
      },
      // A required field whose dictionary is empty: this version matches no hit
      web: { schema: { auth_method: { dict: "empty", required: true } } },
    });
    const predicates = eventPredicates(event, CONFIG, {
      dictionaries: new Map([
        ["auth_methods", ["email"]],
        ["empty", []],
      ]),
    });
    expect([...predicates.keys()]).toEqual(["ios"]);
    const ios = predicates.get("ios") ?? [];
    expect(ios.map(({ version, index }) => [version, index])).toEqual([
      ["1.0.0", 0],
      ["2.0.0", 1],
    ]);
    // The deprecated version is exempt from the restricted policy: event_category may be absent
    expect(ios[0].predicate.constrained.get("event_category")).toEqual(
      new Set([valueToken("auth"), ABSENT]),
    );
    expect(ios[1].predicate.constrained.get("event_category")).toEqual(
      new Set([valueToken("auth")]),
    );
    expect(ios[1].predicate.constrained.get("auth_method")).toEqual(
      new Set([valueToken("email"), ABSENT]),
    );
    expect([...ios[1].predicate.fields].sort()).toEqual([
      "application_id",
      "auth_method",
      "event_category",
    ]);
  });

  it("keeps the file order of integer-like version keys ('2' before '1')", () => {
    const document = parseYaml(
      [
        "payload:",
        '  current: "2"',
        '  "2": { schema: { event_category: { value: c } } }',
        '  "1": { schema: { event_category: { value: c }, screen: { value: home } } }',
        "",
      ].join("\n"),
    ) as { payload: EventPayload };
    const predicates = eventPredicates(makeEvent("a/a.yaml", document.payload), CONFIG);
    expect(predicates.get("web")?.map(({ version, index }) => [version, index])).toEqual([
      ["2", 0],
      ["1", 1],
    ]);
  });
});

describe("comparing version predicates", () => {
  it("fields constrained by only one side, or free, do not tell them apart", () => {
    const p = predicate({ event_name: { value: "login" }, screen: { value: "home" } });
    const q = predicate({ event_name: { value: "login" }, label: {} });
    expect(intersects(p, q)).toBe(true);
    expect(compareVersions(p, q)).toEqual({ kind: "contains", broader: "second" });
    expect(compareVersions(q, p)).toEqual({ kind: "contains", broader: "first" });
  });

  it("a field constrained by both separates them when the allowed sets are disjoint", () => {
    expect(
      compareVersions(
        predicate({ event_name: { value: "a" } }),
        predicate({ event_name: { value: "b" } }),
      ),
    ).toBeNull();
    // By type: "1" is not 1
    expect(
      compareVersions(predicate({ code: { value: "1" } }), predicate({ code: { value: 1 } })),
    ).toBeNull();
    // Arrays by JSON equality
    expect(
      compareVersions(
        predicate({ tags: { value: ["a", "b"] } }),
        predicate({ tags: { value: ["b", "a"] } }),
      ),
    ).toBeNull();
    expect(
      compareVersions(
        predicate({ tags: { value: ["a", "b"] } }),
        predicate({ tags: { value: ["a", "b"] } }),
      ),
    ).toEqual({ kind: "identical" });
  });

  it("ABSENT counts: two optional enums intersect even with disjoint members", () => {
    const optionalA = predicate({ screen: { enum: ["home"] } });
    const optionalB = predicate({ screen: { enum: ["checkout"] } });
    expect(compareVersions(optionalA, optionalB)).toEqual({ kind: "overlaps" });
    const requiredB = predicate({ screen: { enum: ["checkout"], required: true } });
    expect(compareVersions(optionalA, requiredB)).toBeNull();
  });

  it("containment compares allowed sets with ABSENT included", () => {
    const fixed = predicate({ screen: { value: "home" } });
    const optional = predicate({ screen: { enum: ["home", "settings"] } });
    const required = predicate({ screen: { enum: ["home", "settings"], required: true } });
    expect(isWithin(fixed, optional)).toBe(true);
    expect(isWithin(fixed, required)).toBe(true);
    expect(isWithin(required, optional)).toBe(true);
    // The optional enum also allows hits without the field
    expect(isWithin(optional, required)).toBe(false);
    expect(compareVersions(optional, required)).toEqual({ kind: "contains", broader: "first" });
    const other = predicate({ screen: { enum: ["settings", "checkout"], required: true } });
    expect(compareVersions(required, other)).toEqual({ kind: "overlaps" });
  });

  it("an unknown dictionary leaves the field free", () => {
    const unknown = predicate({ code: { dict: "missing" } });
    expect(unknown.constrained.size).toBe(0);
    expect(compareVersions(unknown, predicate({ code: { value: "x" } }))).toEqual({
      kind: "contains",
      broader: "first",
    });
  });
});

// --- Pairs, kinds, messages, attachment ----------------------------------------------------------

describe("findOverlaps", () => {
  const login = (extra: Record<string, Field> = {}) => ({
    schema: { event_category: { value: "auth" }, event_name: { value: "login" }, ...extra },
  });

  it("reports nothing for events that a constrained field tells apart", () => {
    expect(
      messages([
        makeEvent("auth/login.yaml", login()),
        makeEvent("auth/logout.yaml", {
          schema: { event_category: { value: "auth" }, event_name: { value: "logout" } },
        }),
      ]),
    ).toEqual([]);
  });

  it("identical: attached to the event whose path sorts first, with the free fields that differ", () => {
    expect(
      messages([
        makeEvent("b/second.yaml", login({ label: {}, count: {} })),
        makeEvent("a/first.yaml", login()),
      ]),
    ).toEqual([
      [
        "a/first.yaml",
        "Overlaps with event 'b::second' (b/second.yaml) on web, ios: identical: no constrained field tells them apart; they differ only in free fields: count, label",
      ],
    ]);
    expect(
      messages([makeEvent("b/second.yaml", login()), makeEvent("a/first.yaml", login())]),
    ).toEqual([
      [
        "a/first.yaml",
        "Overlaps with event 'b::second' (b/second.yaml) on web, ios: identical: no constrained field tells them apart",
      ],
    ]);
  });

  it("contains: attached to the broader event, even when its path sorts last", () => {
    expect(
      messages([
        makeEvent("z/broad.yaml", login()),
        makeEvent("a/narrow.yaml", login({ screen: { value: "home" } })),
      ]),
    ).toEqual([
      [
        "z/broad.yaml",
        "Overlaps with event 'a::narrow' (a/narrow.yaml) on web, ios: every hit of 'a::narrow' also matches 'z::broad'",
      ],
    ]);
  });

  it("overlaps: attached to the event whose path sorts first", () => {
    expect(
      messages([
        makeEvent(
          "b/two.yaml",
          login({ screen: { enum: ["settings", "checkout"], required: true } }),
        ),
        makeEvent("a/one.yaml", login({ screen: { enum: ["home", "settings"], required: true } })),
      ]),
    ).toEqual([
      ["a/one.yaml", "Overlaps with event 'b::two' (b/two.yaml) on web, ios: some hits match both"],
    ]);
  });

  it("lists the targets with an intersecting version pair in targets.all order", () => {
    const config = makeConfig({ catalog: CATALOG, targets: ["web", "ios", "android"] });
    expect(
      messages(
        [
          makeEvent("a/one.yaml", {
            android: { schema: { event_name: { value: "x" } } },
            ios: { schema: { event_name: { value: "other" } } },
            web: { schema: { event_name: { value: "x" } } },
          }),
          makeEvent("b/two.yaml", { schema: { event_name: { value: "x" } } }),
        ],
        config,
      ),
    ).toEqual([
      [
        "a/one.yaml",
        "Overlaps with event 'b::two' (b/two.yaml) on web, android: identical: no constrained field tells them apart",
      ],
    ]);
  });

  it("takes the strongest kind over targets and versions; the first contains triple decides", () => {
    // web: one contains two; ios: two contains one; the web triple comes first
    const one = makeEvent("a/one.yaml", {
      web: { schema: { event_name: { value: "x" } } },
      ios: { schema: { event_name: { value: "x" }, screen: { value: "home" } } },
    });
    const two = makeEvent("b/two.yaml", {
      web: { schema: { event_name: { value: "x" }, screen: { value: "home" } } },
      ios: { schema: { event_name: { value: "x" } } },
    });
    expect(messages([one, two])).toEqual([
      [
        "a/one.yaml",
        "Overlaps with event 'b::two' (b/two.yaml) on web, ios: every hit of 'b::two' also matches 'a::one'",
      ],
    ]);

    // Versions in file order: version 1.0.0 of three is narrower than four, 2.0.0 broader
    const three = makeEvent("c/three.yaml", {
      current: "2.0.0",
      "1.0.0": { schema: { event_name: { value: "y" }, screen: { value: "home" } } },
      "2.0.0": { schema: { event_name: { value: "y" }, label: {} } },
    });
    const four = makeEvent("d/four.yaml", {
      schema: { event_name: { value: "y" }, screen: { enum: ["home", "settings"] } },
    });
    expect(messages([four, three])).toEqual([
      [
        "d/four.yaml",
        "Overlaps with event 'c::three' (c/three.yaml) on web, ios: every hit of 'c::three' also matches 'd::four'",
      ],
    ]);

    // An identical version pair on one target makes the pair identical
    const five = makeEvent("e/five.yaml", {
      web: { schema: { event_name: { value: "z" } } },
      ios: { schema: { event_name: { value: "z" }, screen: { value: "home" } } },
    });
    const six = makeEvent("f/six.yaml", { schema: { event_name: { value: "z" } } });
    expect(messages([five, six])).toEqual([
      [
        "e/five.yaml",
        "Overlaps with event 'f::six' (f/six.yaml) on web, ios: identical: no constrained field tells them apart",
      ],
    ]);
  });

  it("deprecated versions are exempt from policy: a restricted field may be absent there", () => {
    const version = (category: string, deprecated: boolean) => ({
      current: "1.0.0",
      "1.0.0": {
        ...(deprecated ? { meta: { deprecated: { reason: "old builds" } } } : {}),
        schema: { event_category: { enum: [category] } },
      },
    });
    // Both deprecated: event_category may be absent in both, so they overlap
    expect(
      messages([
        makeEvent("a/one.yaml", version("auth", true)),
        makeEvent("b/two.yaml", version("shop", true)),
      ]),
    ).toEqual([
      ["a/one.yaml", "Overlaps with event 'b::two' (b/two.yaml) on web, ios: some hits match both"],
    ]);
    expect(
      messages([
        makeEvent("a/one.yaml", version("auth", true)),
        makeEvent("b/two.yaml", version("shop", false)),
      ]),
    ).toEqual([]);
  });

  it("compares every loaded event, whatever its lifecycle status", () => {
    expect(
      messages([
        makeEvent("a/one.yaml", login(), { lifecycle: { status: "deprecated" } }),
        makeEvent("b/two.yaml", login(), { lifecycle: { status: "draft" } }),
      ]),
    ).toHaveLength(1);
  });

  it("skips a pair in which one event names the other in replacedBy or aliases", () => {
    const old = makeEvent("a/old.yaml", login(), {
      lifecycle: { status: "deprecated", replacedBy: "b::new" },
    });
    const renamed = makeEvent("b/new.yaml", login(), { aliases: [{ key: "a::old" }] });
    const other = makeEvent("c/other.yaml", login());
    expect(messages([old, makeEvent("b/new.yaml", login())])).toEqual([]);
    expect(messages([makeEvent("a/old.yaml", login()), renamed])).toEqual([]);
    // Other pairs are still compared
    expect(messages([old, renamed, other]).map(([event]) => event)).toEqual([
      "a/old.yaml",
      "b/new.yaml",
    ]);
  });

  it("ignore: `overlap` silences every pair of an event, `overlap.<key>` one pair, on either side", () => {
    const events = (ignore: Record<string, string[]>) =>
      ["a/one.yaml", "b/two.yaml", "c/three.yaml"].map((file) =>
        makeEvent(file, login(), {
          ignore: (ignore[file] ?? []).map((entry) => ({ path: entry })),
        }),
      );
    const pairs = (ignore: Record<string, string[]>) =>
      messages(events(ignore)).map(([event, message]) => `${event} ${message.split(" ")[3]}`);

    expect(pairs({})).toEqual([
      "a/one.yaml 'b::two'",
      "a/one.yaml 'c::three'",
      "b/two.yaml 'c::three'",
    ]);
    expect(pairs({ "b/two.yaml": ["overlap"] })).toEqual(["a/one.yaml 'c::three'"]);
    expect(pairs({ "a/one.yaml": ["overlap.c::three"] })).toEqual([
      "a/one.yaml 'b::two'",
      "b/two.yaml 'c::three'",
    ]);
    expect(pairs({ "c/three.yaml": ["overlap.a::one"] })).toEqual([
      "a/one.yaml 'b::two'",
      "b/two.yaml 'c::three'",
    ]);
    // Other ignore paths do not silence overlap
    expect(pairs({ "a/one.yaml": ["payload.event_name", "overlap.nobody"] })).toHaveLength(3);
  });

  it("parses the overlap ignore forms (reason optional, malformed entries skipped)", () => {
    expect(
      overlapIgnores([
        { path: "overlap.auth::login.v2", reason: "x" },
        { path: "overlap" },
        { reason: "no path" },
        "overlap",
        { path: "overlaps" },
      ]),
    ).toEqual({ all: true, keys: new Set(["auth::login.v2"]) });
    expect(overlapIgnores(undefined)).toEqual({ all: false, keys: new Set() });
  });

  it("a field outside one field set, or a catalog field an event does not list, does not separate", () => {
    expect(
      messages([
        makeEvent("a/screen.yaml", login({ screen: { enum: ["home"], required: true } })),
        makeEvent("b/plain.yaml", login()),
      ]),
    ).toEqual([
      [
        "b/plain.yaml",
        "Overlaps with event 'a::screen' (a/screen.yaml) on web, ios: every hit of 'a::screen' also matches 'b::plain'",
      ],
    ]);
  });

  it("dictionaries: known values constrain, unknown dictionaries leave the field free", () => {
    const withDict = makeEvent("a/dict.yaml", login({ auth_method: {} }));
    const google = makeEvent("b/google.yaml", login({ auth_method: { value: "google" } }));
    const other = makeEvent("c/other.yaml", login({ auth_method: { value: "apple" } }));
    expect(messages([withDict, google, other])).toEqual([
      [
        "a/dict.yaml",
        "Overlaps with event 'b::google' (b/google.yaml) on web, ios: every hit of 'b::google' also matches 'a::dict'",
      ],
    ]);
    // Without the dictionary, auth_method in a/dict.yaml is free: it contains both
    const unknown = overlapResults(findOverlaps([withDict, google, other], CONFIG), "warning");
    expect(unknown.map((result) => result.event)).toEqual(["a/dict.yaml", "a/dict.yaml"]);
  });

  it("returns results with rule overlap at path payload, with the requested severity", () => {
    const overlaps = findOverlaps(
      [makeEvent("a/one.yaml", login()), makeEvent("b/two.yaml", login())],
      CONFIG,
    );
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({
      kind: "identical",
      targets: ["web", "ios"],
      freeFields: [],
    });
    expect(overlapResults(overlaps, "error")).toEqual([
      {
        event: "a/one.yaml",
        path: "payload",
        message:
          "Overlaps with event 'b::two' (b/two.yaml) on web, ios: identical: no constrained field tells them apart",
        severity: "error",
        rule: "overlap",
      },
    ]);
  });
});

describe("overlapsWith (drafts)", () => {
  const plan = [
    makeEvent("a/broad.yaml", { schema: { event_name: { value: "x" } } }),
    makeEvent("m/draft.yaml", { schema: { event_name: { value: "x" }, label: {} } }),
    makeEvent("z/narrow.yaml", {
      schema: { event_name: { value: "x" }, screen: { value: "home" } },
    }),
    makeEvent("z/unrelated.yaml", { schema: { event_name: { value: "y" } } }),
  ];

  it("compares a draft with every plan event except the one at its path; all go to the draft", () => {
    const draft = makeEvent("m/draft.yaml", {
      schema: { event_name: { value: "x" }, screen: { enum: ["home", "settings"] } },
    });
    expect(
      overlapResults(overlapsWith(draft, plan, CONFIG), "warning").map((result) => [
        result.event,
        result.message,
      ]),
    ).toEqual([
      [
        "m/draft.yaml",
        "Overlaps with event 'a::broad' (a/broad.yaml) on web, ios: every hit of 'm::draft' also matches 'a::broad'",
      ],
      [
        "m/draft.yaml",
        "Overlaps with event 'z::narrow' (z/narrow.yaml) on web, ios: every hit of 'z::narrow' also matches 'm::draft'",
      ],
    ]);
  });

  it("reuses one index for several drafts and honours the draft's ignore entries", () => {
    const index = new OverlapIndex(plan, CONFIG);
    const draft = (ignore: string[]) =>
      makeEvent(
        "n/new.yaml",
        { schema: { event_name: { value: "x" } } },
        {
          ignore: ignore.map((entry) => ({ path: entry })),
        },
      );
    expect(index.pairsWith(draft([])).map((overlap) => overlap.other.relativePath)).toEqual([
      "a/broad.yaml",
      "m/draft.yaml",
      "z/narrow.yaml",
    ]);
    expect(index.pairsWith(draft(["overlap.a::broad"])).map((o) => o.other.relativePath)).toEqual([
      "m/draft.yaml",
      "z/narrow.yaml",
    ]);
    expect(index.with(draft(["overlap"]))).toEqual([]);
    // The plan itself: broad contains draft and narrow, draft contains narrow
    expect([...index.pairs()].map((o) => [o.event.relativePath, o.other.relativePath])).toEqual([
      ["a/broad.yaml", "m/draft.yaml"],
      ["a/broad.yaml", "z/narrow.yaml"],
      ["m/draft.yaml", "z/narrow.yaml"],
    ]);
  });
});

describe("more than 20 overlaps on one event", () => {
  const numbered = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(2, "0")}`);

  /**
   * a/hub.yaml: 3 identical (b/), 10 contained in it (c/) and 8 partial (d/) overlaps = 21, so one
   * summary. b/i01.yaml: 2 identical, 10 contained, 8 partial = 20, so 20 warnings.
   */
  function hubPlan(hubIgnore: string[] = []): ResolvedEvent[] {
    const hubSchema = { event_category: { value: "x" }, screen: { enum: ["home", "settings"] } };
    return [
      makeEvent(
        "a/hub.yaml",
        { schema: hubSchema },
        { ignore: hubIgnore.map((entry) => ({ path: entry })) },
      ),
      ...numbered("i", 3).map((name) => makeEvent(`b/${name}.yaml`, { schema: hubSchema })),
      ...numbered("n", 10).map((name) =>
        makeEvent(`c/${name}.yaml`, {
          schema: {
            event_category: { value: "x" },
            event_name: { value: name },
            screen: { value: "home" },
          },
        }),
      ),
      ...numbered("p", 8).map((name) =>
        makeEvent(`d/${name}.yaml`, {
          schema: {
            event_category: { value: "x" },
            event_name: { value: name },
            screen: { enum: ["home", "checkout"] },
          },
        }),
      ),
    ];
  }

  it("replaces them with one summary warning; an event with 20 keeps one warning per pair", () => {
    const results = messages(hubPlan());
    expect(results.filter(([event]) => event === "a/hub.yaml")).toEqual([
      [
        "a/hub.yaml",
        "Overlaps with 21 other events on web, ios (3 identical, 10 contained in this event, 8 partial); for example 'b::i01' (b/i01.yaml), 'b::i02' (b/i02.yaml), 'b::i03' (b/i03.yaml)",
      ],
    ]);
    const i01 = results.filter(([event]) => event === "b/i01.yaml");
    expect(i01).toHaveLength(20);
    expect(i01[0]).toEqual([
      "b/i01.yaml",
      "Overlaps with event 'b::i02' (b/i02.yaml) on web, ios: identical: no constrained field tells them apart",
    ]);
    // Events in relative-path order, each one's overlaps in the relative-path order of the other
    expect([...new Set(results.map(([event]) => event))]).toEqual([
      "a/hub.yaml",
      "b/i01.yaml",
      "b/i02.yaml",
      "b/i03.yaml",
    ]);
    expect(results).toHaveLength(1 + 20 + 19 + 18);

    // The pairs themselves are unchanged: 21 of them go to a/hub.yaml
    const pairs = [...new OverlapIndex(hubPlan(), CONFIG).pairs()];
    expect(pairs.filter((pair) => pair.event.relativePath === "a/hub.yaml")).toHaveLength(21);
  });

  it("counts only the pairs attached to an event: in 22 identical events only the first is summarized", () => {
    const schema = { event_category: { value: "x" } };
    const plan = numbered("e", 22).map((name) => makeEvent(`a/${name}.yaml`, { schema }));
    const results = messages(plan);
    const perEvent = plan.map(
      (event) => results.filter(([file]) => file === event.relativePath).length,
    );
    // Every event overlaps 21 others; each identical pair goes to the event whose path sorts first
    expect(perEvent).toEqual([
      1, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
    ]);
    expect(results[0][1]).toMatch(/^Overlaps with 21 other events on web, ios \(21 identical\)/);
    expect(results[1]).toEqual([
      "a/e02.yaml",
      "Overlaps with event 'a::e03' (a/e03.yaml) on web, ios: identical: no constrained field tells them apart",
    ]);
  });

  it("does not count pairs silenced by ignore", () => {
    const results = messages(hubPlan(["overlap.d::p08"]));
    const hub = results.filter(([event]) => event === "a/hub.yaml");
    expect(hub).toHaveLength(20);
    expect(hub.every(([, message]) => message.startsWith("Overlaps with event '"))).toBe(true);
  });

  it("summarizes a draft's overlaps too, including the events that contain it", () => {
    const plan = [
      ...numbered("b", 8).map((name) =>
        makeEvent(`a/${name}.yaml`, { schema: { event_category: { value: "x" } } }),
      ),
      ...numbered("i", 6).map((name) =>
        makeEvent(`y/${name}.yaml`, {
          schema: {
            event_category: { value: "x" },
            event_name: { value: "d" },
            screen: { enum: ["home", "settings"] },
          },
        }),
      ),
      ...numbered("n", 7).map((name) =>
        makeEvent(`z/${name}.yaml`, {
          schema: {
            event_category: { value: "x" },
            event_name: { value: "d" },
            screen: { value: "home" },
          },
        }),
      ),
    ];
    const draft = makeEvent("m/draft.yaml", {
      schema: {
        event_category: { value: "x" },
        event_name: { value: "d" },
        screen: { enum: ["home", "settings"] },
      },
    });
    const index = new OverlapIndex(plan, CONFIG);
    expect(overlapResults(index.with(draft), "warning").map((result) => result.message)).toEqual([
      "Overlaps with 21 other events on web, ios (6 identical, 7 contained in this event, 8 containing this event); for example 'a::b01' (a/b01.yaml), 'a::b02' (a/b02.yaml), 'a::b03' (a/b03.yaml)",
    ]);
    expect(index.pairsWith(draft)).toHaveLength(21);
    // With 20, every pair is listed
    const fewer = new OverlapIndex(plan.slice(1), CONFIG);
    expect(overlapResults(fewer.with(draft), "warning")).toHaveLength(20);
  });
});

// --- validateEvents and the CLI ------------------------------------------------------------------

describe("severity", () => {
  const events = [
    makeEvent("a/one.yaml", { schema: { event_name: { value: "x" } } }),
    makeEvent("b/two.yaml", { schema: { event_name: { value: "x" } } }),
  ];
  const config = makeConfig({ catalog: CATALOG });
  const run = async (overlap: "off" | "warning" | "error") =>
    (
      await validateEvents(events, config, DICTIONARIES, {
        severities: { overlap, unknownCheck: "warning" },
      })
    ).filter((result) => result.rule === "overlap");

  beforeEach(() => {
    vi.mocked(findOverlaps).mockClear();
  });

  it("off skips the computation; warning and error set the severity", async () => {
    expect(await run("off")).toEqual([]);
    expect(findOverlaps).not.toHaveBeenCalled();

    const warnings = await run("warning");
    expect(findOverlaps).toHaveBeenCalledTimes(1);
    expect(warnings).toEqual([
      expect.objectContaining({ event: "a/one.yaml", severity: "warning", rule: "overlap" }),
    ]);
    expect(await run("error")).toEqual([
      expect.objectContaining({ event: "a/one.yaml", severity: "error", rule: "overlap" }),
    ]);
  });

  it("summarizes the overlaps of every event that has more than 20", async () => {
    // 600 identical events: 179,700 pairs; event k (in path order) carries 599 - k of them
    const same = Array.from({ length: 600 }, (_, index) =>
      makeEvent(`a/e${String(index).padStart(3, "0")}.yaml`, {
        schema: { event_name: { value: "x" } },
      }),
    );
    const results = (await validateEvents(same, config, DICTIONARIES)).filter(
      (result) => result.rule === "overlap",
    );
    // 579 summaries (k = 0..578), then 20 + 19 + ... + 1 warnings
    expect(results).toHaveLength(579 + 210);
    expect(results[0]).toEqual({
      event: "a/e000.yaml",
      path: "payload",
      message:
        "Overlaps with 599 other events on web, ios (599 identical); for example 'a::e001' (a/e001.yaml), 'a::e002' (a/e002.yaml), 'a::e003' (a/e003.yaml)",
      severity: "warning",
      rule: "overlap",
    });
    expect(results[578].message).toMatch(/^Overlaps with 21 other events /);
    expect(results[579].message).toBe(
      "Overlaps with event 'a::e580' (a/e580.yaml) on web, ios: identical: no constrained field tells them apart",
    );
  }, 60_000);
});

describe("opentp validate", () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opentp-overlap-"));
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const spies = [
      vi.spyOn(console, "log").mockImplementation((...parts) => {
        stdout.push(parts.join(" "));
      }),
      vi.spyOn(console, "error").mockImplementation((...parts) => {
        stderr.push(parts.join(" "));
      }),
      vi.spyOn(console, "warn").mockImplementation((...parts) => {
        stderr.push(parts.join(" "));
      }),
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        stdout.push(String(chunk));
        return true;
      }),
    ];
    try {
      const code = await main(args);
      return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
    } finally {
      for (const spy of spies) spy.mockRestore();
      setLogLevel("info");
    }
  }

  const FIXTURE_WARNINGS = [
    {
      event: "auth/login.yaml",
      path: "payload",
      message:
        "Overlaps with event 'auth::login_with_label' (auth/login_with_label.yaml) on web, ios: identical: no constrained field tells them apart; they differ only in free fields: event_label",
      severity: "warning",
      rule: "overlap",
    },
    {
      event: "checkout/purchase.yaml",
      path: "payload",
      message:
        "Overlaps with event 'checkout::purchase_duplicate' (checkout/purchase_duplicate.yaml) on web, ios: identical: no constrained field tells them apart",
      severity: "warning",
      rule: "overlap",
    },
    {
      event: "search/results.yaml",
      path: "payload",
      message:
        "Overlaps with event 'search::suggest' (search/suggest.yaml) on web: some hits match both",
      severity: "warning",
      rule: "overlap",
    },
    {
      event: "settings/view.yaml",
      path: "payload",
      message:
        "Overlaps with event 'settings::home_view' (settings/home_view.yaml) on web, ios: every hit of 'settings::home_view' also matches 'settings::view'",
      severity: "warning",
      rule: "overlap",
    },
  ];

  it("reports the overlaps of tests/data/overlap as warnings (exit 0)", async () => {
    const json = await runCli(["validate", "--json", "--root", fixture("overlap")]);
    expect(json.code).toBe(0);
    const document = JSON.parse(json.stdout);
    expect(document).toMatchObject({ success: true, events: 12, errors: [] });
    expect(document.warnings).toEqual(FIXTURE_WARNINGS);

    const text = await runCli(["validate", "--root", fixture("overlap")]);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain(
      "[settings/view.yaml]\n  ⚠ payload: Overlaps with event 'settings::home_view' (settings/home_view.yaml) on web, ios: every hit of 'settings::home_view' also matches 'settings::view'",
    );
    expect(text.stderr).toBe("✓ All events are valid warnings=4 count=12");
  });

  it("--fail-on overlap and checks.severity.overlap: error fail the run (exit 1)", async () => {
    const failed = await runCli([
      "validate",
      "--json",
      "--root",
      fixture("overlap"),
      "--fail-on",
      "overlap",
    ]);
    expect(failed.code).toBe(1);
    const document = JSON.parse(failed.stdout);
    expect(document.success).toBe(false);
    expect(document.warnings).toEqual([]);
    expect(document.errors).toEqual(
      FIXTURE_WARNINGS.map((warning) => ({ ...warning, severity: "error" })),
    );

    const root = path.join(tmpRoot, "severity-error");
    fs.cpSync(fixture("overlap"), root, { recursive: true });
    fs.writeFileSync(
      path.join(root, "opentp.cli.yaml"),
      "opentp: 2026-09\nchecks:\n  severity:\n    overlap: error\n",
    );
    const text = await runCli(["validate", "--root", root]);
    expect(text.code).toBe(1);
    expect(text.stdout).toContain("  ✗ payload: Overlaps with event 'search::suggest'");
  });

  it("checks.severity.overlap: off reports nothing and skips the computation", async () => {
    const root = path.join(tmpRoot, "severity-off");
    fs.cpSync(fixture("overlap"), root, { recursive: true });
    fs.writeFileSync(
      path.join(root, "opentp.cli.yaml"),
      "opentp: 2026-09\nchecks:\n  severity:\n    overlap: off\n",
    );
    vi.mocked(findOverlaps).mockClear();
    const off = await runCli(["validate", "--json", "--root", root]);
    expect(off.code).toBe(0);
    expect(JSON.parse(off.stdout).warnings).toEqual([]);
    expect(findOverlaps).not.toHaveBeenCalled();

    // --fail-on wins over checks.severity
    expect((await runCli(["validate", "--root", root, "--fail-on", "overlap"])).code).toBe(1);
  });

  it("takes versions in file order for the contains direction, also with keys '2' before '1'", async () => {
    // Version "2" of a/a.yaml contains a/b.yaml, and a/b.yaml contains version "1": the first
    // version in the file decides, so the warning goes to a/a.yaml
    const write = (root: string, file: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
    };
    const plan = (root: string, first: string, second: string) => {
      write(
        root,
        "opentp.yaml",
        [
          "opentp: 2026-09",
          "info: { title: Versions, version: 1.0.0 }",
          "spec:",
          "  paths:",
          "    events: { root: /events, template: '{area}/{event}.yaml' }",
          "  events:",
          "    taxonomy: {}",
          "    payload:",
          "      targets: { all: [web, ios] }",
          "      schema:",
          "        event_category: { type: string }",
          "        event_name: { type: string }",
          "        screen: { type: string }",
          "        auth_method: { type: string }",
          "",
        ].join("\n"),
      );
      write(
        root,
        "events/a/a.yaml",
        [
          "opentp: 2026-09",
          "event:",
          "  key: a::a",
          "  taxonomy: {}",
          "  payload:",
          `    current: "${first.replaceAll('"', "")}"`,
          `    ${first}:`,
          "      schema: { event_category: { value: c }, event_name: { value: x } }",
          `    ${second}:`,
          "      meta: { deprecated: { reason: Old builds } }",
          "      schema:",
          "        event_category: { value: c }",
          "        event_name: { value: x }",
          "        screen: { value: home }",
          "        auth_method: { value: email }",
          "",
        ].join("\n"),
      );
      write(
        root,
        "events/a/b.yaml",
        [
          "opentp: 2026-09",
          "event:",
          "  key: a::b",
          "  taxonomy: {}",
          "  payload:",
          "    schema: { event_category: { value: c }, event_name: { value: x }, screen: { value: home } }",
          "",
        ].join("\n"),
      );
      return root;
    };
    const expected = [
      {
        event: "a/a.yaml",
        path: "payload",
        message:
          "Overlaps with event 'a::b' (a/b.yaml) on web, ios: every hit of 'a::b' also matches 'a::a'",
        severity: "warning",
        rule: "overlap",
      },
    ];
    for (const [first, second] of [
      ['"2"', '"1"'],
      ["v2", "v1"],
      ["10", "9"],
    ]) {
      const root = plan(path.join(tmpRoot, `versions-${first.replaceAll('"', "")}`), first, second);
      const json = await runCli(["validate", "--json", "--root", root]);
      expect(json.code).toBe(0);
      expect(JSON.parse(json.stdout).warnings).toEqual(expected);
    }
  });

  describe("plans with millions of overlapping pairs", () => {
    /**
     * `count` events on 3 targets in 10 areas. An event with identity has `event_name` (unique) and
     * a fixed `event_category`; an event without it has neither, so it contains every other event.
     */
    function generatedPlan(name: string, count: number, identityLess: (index: number) => boolean) {
      const root = path.join(tmpRoot, name);
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(
        path.join(root, "opentp.yaml"),
        [
          "opentp: 2026-09",
          "info: { title: Generated, version: 1.0.0 }",
          "spec:",
          "  paths:",
          "    events: { root: /events, template: '{area}/{event}.yaml' }",
          "  events:",
          "    taxonomy: {}",
          "    payload:",
          "      targets: { all: [web, ios, android] }",
          "      schema:",
          "        event_name: { type: string }",
          "        event_category: { type: string }",
          "        event_label: { type: string }",
          "",
        ].join("\n"),
      );
      for (let area = 0; area < 10; area += 1) {
        fs.mkdirSync(path.join(root, "events", `area${area}`), { recursive: true });
      }
      for (let index = 0; index < count; index += 1) {
        const area = `area${index % 10}`;
        const schema = identityLess(index)
          ? "{ event_category: {}, event_label: {} }"
          : `{ event_category: { value: c${index % 6} }, event_name: { value: e${index} }, event_label: {} }`;
        fs.writeFileSync(
          path.join(root, "events", area, `event_${index}.yaml`),
          `opentp: 2026-09\nevent:\n  key: ${area}::event_${index}\n  taxonomy: {}\n  payload:\n    schema: ${schema}\n`,
        );
      }
      return root;
    }

    /** At most 20 overlap results per event, and a summary only alone */
    function expectBounded(results: Array<{ event: string; message: string }>) {
      const byEvent = new Map<string, string[]>();
      for (const result of results) {
        byEvent.set(result.event, [...(byEvent.get(result.event) ?? []), result.message]);
      }
      for (const messages of byEvent.values()) {
        expect(messages.length).toBeLessThanOrEqual(20);
        if (messages.some((message) => /^Overlaps with \d+ other events /.test(message))) {
          expect(messages).toHaveLength(1);
        }
      }
    }

    it("3,000 events without an identity field (4,498,500 pairs): --json and --fail-on overlap", async () => {
      const root = generatedPlan("no-identity", 3000, () => true);
      // Event k (in path order) is identical to the 2,999 - k events after it: 2,979 summaries,
      // then 20 + 19 + ... + 1 warnings
      const json = await runCli(["validate", "--json", "--root", root]);
      expect(json.code).toBe(0);
      expect(json.stdout.length).toBeLessThan(2_000_000);
      const document = JSON.parse(json.stdout);
      expect(document).toMatchObject({ success: true, events: 3000, errors: [] });
      expect(document.warnings).toHaveLength(2979 + 210);
      expect(document.warnings[0].message).toBe(
        "Overlaps with 2999 other events on web, ios, android (2999 identical); for example 'area0::event_10' (area0/event_10.yaml), 'area0::event_100' (area0/event_100.yaml), 'area0::event_1000' (area0/event_1000.yaml)",
      );
      expectBounded(document.warnings);

      const failed = await runCli(["validate", "--root", root, "--fail-on", "overlap"]);
      expect(failed.code).toBe(1);
      expect(failed.stderr).toBe(
        "✗ Validation failed errorCount=3189 warningCount=0 eventCount=3000",
      );
      expect(failed.stdout.split("\n").filter((line) => line.startsWith("  ✗ "))).toHaveLength(
        3189,
      );
    }, 120_000);

    it("5,000 events, 10% without the identity field (2,374,750 pairs): --json and --fail-on overlap", async () => {
      const root = generatedPlan("partly-identity", 5000, (index) => index % 10 === 0);
      // Each of the 500 events without identity contains the 4,500 others and is identical to the
      // other 499: one summary each
      const json = await runCli(["validate", "--json", "--root", root]);
      expect(json.code).toBe(0);
      const document = JSON.parse(json.stdout);
      expect(document).toMatchObject({ success: true, events: 5000, errors: [] });
      expect(document.warnings).toHaveLength(500);
      expect(document.warnings[0].message).toMatch(
        /^Overlaps with 4999 other events on web, ios, android \(499 identical, 4500 contained in this event\); for example /,
      );
      expectBounded(document.warnings);

      const failed = await runCli(["validate", "--json", "--root", root, "--fail-on", "overlap"]);
      expect(failed.code).toBe(1);
      const errors = JSON.parse(failed.stdout);
      expect(errors).toMatchObject({ success: false, warnings: [] });
      expect(errors.errors).toHaveLength(500);
    }, 120_000);
  });

  it("prints at most 20 overlap warnings in text mode, then how many more (--json lists all)", async () => {
    const root = path.join(tmpRoot, "cap");
    fs.mkdirSync(path.join(root, "events"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "opentp.yaml"),
      [
        "opentp: 2026-09",
        "info: { title: Cap, version: 1.0.0 }",
        "spec:",
        "  paths:",
        "    events: { root: /events, template: '{area}/{event}.yaml' }",
        "  events:",
        "    taxonomy: {}",
        "    payload:",
        "      targets: { all: [web] }",
        "      schema:",
        "        event_name: { type: string }",
        "        event_category: { type: string }",
        "",
      ].join("\n"),
    );
    const write = (file: string, key: string, schema: string) => {
      fs.mkdirSync(path.dirname(path.join(root, "events", file)), { recursive: true });
      fs.writeFileSync(
        path.join(root, "events", file),
        `opentp: 2026-09\nevent:\n  key: ${key}\n  taxonomy: {}\n  payload:\n    schema: ${schema}\n`,
      );
    };
    // Each broad event contains the narrow events of its category: z/broad.yaml 25 (one summary
    // warning), y/broad.yaml 15 and w/broad.yaml 12 (one warning per pair)
    const broad = (area: string, category: string, count: number) => {
      write(`${area}/broad.yaml`, `${area}::broad`, `{ event_category: { value: ${category} } }`);
      for (let n = 1; n <= count; n += 1) {
        const name = `n${String(n).padStart(2, "0")}`;
        write(
          `${area}_narrow/${name}.yaml`,
          `${area}_narrow::${name}`,
          `{ event_category: { value: ${category} }, event_name: { value: ${name} } }`,
        );
      }
    };
    broad("z", "x", 25);
    broad("y", "y", 15);
    broad("w", "w", 12);

    const text = await runCli(["validate", "--root", root]);
    expect(text.code).toBe(0);
    const lines = text.stdout.split("\n").filter((line) => line !== "");
    // Events with the most overlapping events first (a summary counts as its events); 20 warning
    // lines, then the overflow line
    expect(lines[0]).toBe("[z/broad.yaml]");
    expect(lines[1]).toBe(
      "  ⚠ payload: Overlaps with 25 other events on web (25 contained in this event); for example 'z_narrow::n01' (z_narrow/n01.yaml), 'z_narrow::n02' (z_narrow/n02.yaml), 'z_narrow::n03' (z_narrow/n03.yaml)",
    );
    expect(lines[2]).toBe("[y/broad.yaml]");
    expect(lines[3]).toBe(
      "  ⚠ payload: Overlaps with event 'y_narrow::n01' (y_narrow/n01.yaml) on web: every hit of 'y_narrow::n01' also matches 'y::broad'",
    );
    expect(lines[18]).toBe("[w/broad.yaml]");
    expect(lines.filter((line) => line.startsWith("  ⚠ payload: "))).toHaveLength(20);
    expect(lines.at(-1)).toBe(
      "… 8 more overlap warnings (--json lists all; set checks.severity.overlap in opentp.cli.yaml)",
    );
    expect(lines).toHaveLength(24);
    expect(text.stderr).toBe("✓ All events are valid warnings=28 count=55");

    const json = await runCli(["validate", "--json", "--root", root]);
    expect(JSON.parse(json.stdout).warnings).toHaveLength(28);
  });
});

// --- A generated plan against a naive reference ---------------------------------------------------

/** Deterministic pseudo-random numbers in [0, 1) */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GENERATED_TARGETS = ["web", "ios", "android"];
const CATEGORIES = ["auth", "cart", "checkout", "profile", "search", "settings"];
const SCREENS = ["home", "list", "detail", "cart", "checkout", "settings"];
const METHODS = ["email", "google", "github"];

const GENERATED_CONFIG: OpenTPConfig = {
  opentp: "2026-09",
  info: { title: "Generated", version: "1.0.0" },
  spec: {
    paths: { events: { root: "/events", template: "{area}/{event}.yaml" } },
    targets: {
      all: {
        schema: {
          application_id: { type: "string", value: "acme-app" },
          event_category: { type: "string", policy: "restricted" },
        },
      },
      ios: { schema: { device_model: { type: "string" } } },
    },
    events: {
      taxonomy: {},
      payload: {
        targets: { all: GENERATED_TARGETS, mobile: ["ios", "android"] },
        schema: {
          event_name: { type: "string" },
          screen: { type: "string", enum: SCREENS },
          auth_method: { type: "string", dict: "auth_methods" },
          legacy_source: { type: "string", dict: "missing/dictionary" },
          label: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          step: { type: "integer" },
        },
      },
    },
  },
};

const GENERATED_DICTIONARIES = new Map([["auth_methods", METHODS]]);

/**
 * 1,000 events on 3 targets with 2 versions each (the older one marked deprecated); every tenth
 * event has no event_name (its identity field was lost)
 */
function generatePlan(count: number): ResolvedEvent[] {
  const random = mulberry32(20260903);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
  const subset = <T>(list: readonly T[]): T[] => {
    const chosen = list.filter(() => random() < 0.4);
    return chosen.length > 0 ? chosen : [pick(list)];
  };
  const keyOf = (index: number) => `area${index % 7}::event_${index}`;

  const events: ResolvedEvent[] = [];
  for (let index = 0; index < count; index += 1) {
    const category = pick(CATEGORIES);
    const name = `name_${Math.floor(random() * 650)}`;
    const hasIdentity = index % 10 !== 3;

    const schema = (deprecated: boolean): Record<string, Field> => {
      const fields: Record<string, Field> = {};
      fields.event_category =
        deprecated && random() < 0.5 ? { enum: [category, pick(CATEGORIES)] } : { value: category };
      if (hasIdentity) fields.event_name = { value: name };
      const screen = random();
      if (screen < 0.3) fields.screen = { value: pick(SCREENS) };
      else if (screen < 0.5) {
        fields.screen = { enum: subset(SCREENS), ...(random() < 0.5 ? { required: true } : {}) };
      } else if (screen < 0.6) fields.screen = {};
      const method = random();
      if (method < 0.2) fields.auth_method = {};
      else if (method < 0.35) fields.auth_method = { value: pick(METHODS) };
      else if (method < 0.45) fields.auth_method = { enum: subset(METHODS), required: true };
      if (random() < 0.1) fields.legacy_source = {};
      if (random() < 0.2) fields.label = {};
      const tags = random();
      if (tags < 0.1) fields.tags = { value: pick([["a"], ["a", "b"], ["b", "a"]]) };
      else if (tags < 0.2) fields.tags = {};
      if (random() < 0.1) fields.step = { value: pick([1, 2]) };
      return fields;
    };
    const versioned = () => ({
      current: "2.0.0",
      "1.0.0": { meta: { deprecated: { reason: "Old builds" } }, schema: schema(true) },
      "2.0.0": { schema: schema(false) },
    });

    const extra: Partial<ResolvedEvent> = {};
    const roll = random();
    if (roll < 0.02 && index > 0) {
      extra.lifecycle = { status: "deprecated", replacedBy: keyOf(index - 1) };
    } else if (roll < 0.04 && index + 1 < count) {
      extra.aliases = [{ key: keyOf(index + 1) }];
    } else if (roll < 0.05) {
      extra.ignore = [{ path: "overlap", reason: "aggregate" }];
    } else if (roll < 0.07) {
      extra.ignore = [{ path: `overlap.${keyOf(Math.floor(random() * count))}` }];
    }

    events.push({
      filePath: `/plan/events/area${index % 7}/event_${index}.yaml`,
      relativePath: `area${index % 7}/event_${index}.yaml`,
      key: keyOf(index),
      expectedKey: null,
      taxonomy: {},
      ignore: [],
      payload: (random() < 0.7
        ? versioned()
        : { web: versioned(), mobile: versioned() }) as EventPayload,
      ...extra,
    });
  }
  return events;
}

interface ReferencePredicate {
  constrained: Map<string, string[]>;
  fields: string[];
}

/**
 * A naive implementation of the overlap rule: every pair, every target, every version pair, no
 * index and no early exit between pairs. Returns [attached event, message] in pair order.
 */
function referenceOverlaps(
  events: ResolvedEvent[],
  config: OpenTPConfig,
  dictionaries: Map<string, string[]>,
): { results: Array<[string, string]>; comparisons: number } {
  const token = (value: unknown) =>
    value === null
      ? "ABSENT"
      : JSON.stringify([Array.isArray(value) ? "array" : typeof value, value]);
  const lookup = (dict: string) => dictionaries.get(dict) ?? null;
  const baseFields = new BaseFieldCache(config, lookup);
  const targets = config.spec.events.payload.targets.all;

  const ignoreOf = (event: ResolvedEvent) => event.ignore.map((entry) => entry.path);
  const participants = [...events]
    .filter((event) => !ignoreOf(event).includes("overlap"))
    .sort((a, b) => (a.relativePath < b.relativePath ? -1 : 1));

  const predicates = participants.map((event) => {
    const { payload } = resolveEventPayload(event.payload, config);
    return targets.map((target) => {
      const resolved = payload.targets[target];
      if (!resolved) return [];
      const versions = resolved.versionOrder.map((key) => resolved.versions[key]);
      return versions.map((version): ReferencePredicate => {
        const deprecated = Boolean(version.meta?.deprecated);
        const constrained = new Map<string, string[]>();
        const fields: string[] = [];
        for (const [name, entry] of effectiveFields(
          version.schema,
          baseFields.forTarget(target),
          lookup,
        )) {
          fields.push(name);
          const field = entry.field;
          if (field.value !== undefined) {
            constrained.set(name, [token(field.value)]);
            continue;
          }
          if (field.type === "array") continue;
          const values =
            Array.isArray(field.enum) && field.enum.length > 0
              ? field.enum
              : typeof field.dict === "string"
                ? lookup(field.dict)
                : null;
          if (!values) continue;
          const present =
            field.required === true ||
            (!deprecated && (field.policy === "restricted" || field.policy === "fixed"));
          constrained.set(name, [...values.map(token), ...(present ? [] : ["ABSENT"])]);
        }
        return { constrained, fields };
      });
    });
  });

  const intersect = (p: ReferencePredicate, q: ReferencePredicate) => {
    for (const [field, allowed] of p.constrained) {
      const other = q.constrained.get(field);
      if (other && !allowed.some((value) => other.includes(value))) return false;
    }
    return true;
  };
  const within = (p: ReferencePredicate, q: ReferencePredicate) => {
    for (const [field, allowed] of q.constrained) {
      const own = p.constrained.get(field);
      if (!own || !own.every((value) => allowed.includes(value))) return false;
    }
    return true;
  };
  const names = (event: ResolvedEvent) =>
    [event.lifecycle?.replacedBy, ...(event.aliases ?? []).map((alias) => alias.key)].filter(
      (key): key is string => typeof key === "string",
    );
  const skip = (a: ResolvedEvent, b: ResolvedEvent) =>
    ignoreOf(a).includes(`overlap.${b.key}`) ||
    ignoreOf(b).includes(`overlap.${a.key}`) ||
    names(a).includes(b.key) ||
    names(b).includes(a.key);

  let comparisons = 0;
  const results: Array<[string, string]> = [];
  for (let i = 0; i < participants.length; i += 1) {
    for (let j = i + 1; j < participants.length; j += 1) {
      const a = participants[i];
      const b = participants[j];
      if (skip(a, b)) continue;
      let kind = -1;
      const hitTargets: string[] = [];
      let contains: { broad: ResolvedEvent; narrow: ResolvedEvent } | null = null;
      const free = new Set<string>();
      for (let t = 0; t < targets.length; t += 1) {
        let hit = false;
        for (const p of predicates[i][t]) {
          for (const q of predicates[j][t]) {
            comparisons += 1;
            if (!intersect(p, q)) continue;
            hit = true;
            const pq = within(p, q);
            const qp = within(q, p);
            const k = pq && qp ? 2 : pq || qp ? 1 : 0;
            kind = Math.max(kind, k);
            // Targets, then versions in file order: the first contains triple decides
            if (k === 1 && !contains) {
              contains = pq ? { broad: b, narrow: a } : { broad: a, narrow: b };
            }
            if (k === 2) {
              for (const name of p.fields) if (!q.fields.includes(name)) free.add(name);
              for (const name of q.fields) if (!p.fields.includes(name)) free.add(name);
            }
          }
        }
        if (hit) hitTargets.push(targets[t]);
      }
      if (kind < 0) continue;
      const on = hitTargets.join(", ");
      if (kind === 1 && contains) {
        results.push([
          contains.broad.relativePath,
          `Overlaps with event '${contains.narrow.key}' (${contains.narrow.relativePath}) on ${on}: every hit of '${contains.narrow.key}' also matches '${contains.broad.key}'`,
        ]);
        continue;
      }
      const text =
        kind === 2
          ? `identical: no constrained field tells them apart${free.size > 0 ? `; they differ only in free fields: ${[...free].sort(naturalCompare).join(", ")}` : ""}`
          : "some hits match both";
      results.push([
        a.relativePath,
        `Overlaps with event '${b.key}' (${b.relativePath}) on ${on}: ${text}`,
      ]);
    }
  }
  return { results, comparisons };
}

describe("a generated plan of 1,000 events x 3 targets x 2 versions", () => {
  it("matches the naive reference", () => {
    const events = generatePlan(1000);
    const stats: OverlapStats = { comparisons: 0 };
    // Every pair, before the overlaps of one event are summarized
    const pairs = new OverlapIndex(events, GENERATED_CONFIG, {
      dictionaries: GENERATED_DICTIONARIES,
      stats,
    }).pairs();
    const actual = overlapResults([...pairs], "warning").map((result): [string, string] => [
      result.event,
      result.message,
    ]);
    const reference = referenceOverlaps(events, GENERATED_CONFIG, GENERATED_DICTIONARIES);

    // The plan exercises every kind, several targets and the free-field difference
    expect(reference.results.length).toBeGreaterThan(1000);
    for (const text of [
      "identical: no constrained field tells them apart",
      "they differ only in free fields",
      "also matches",
      "some hits match both",
      "on web, ios, android",
      "on ios, android",
    ]) {
      expect(reference.results.some(([, message]) => message.includes(text))).toBe(true);
    }
    expect(actual).toEqual(reference.results);
    // The index compares far fewer version pairs than the naive reference
    expect(stats.comparisons).toBeLessThan(reference.comparisons / 4);
  }, 120_000);
});
