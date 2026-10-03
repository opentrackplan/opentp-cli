import { describe, expect, it } from "vitest";
import type { Field, OpenTPConfig } from "../types";
import {
  type DictionaryLookup,
  layerMerge,
  mergeBaseLayers,
  refMerge,
  resolveEffectivePayload,
  resolveEventPayload,
} from "./payload";

const DICTIONARIES: Record<string, string[]> = {
  apps: ["web-app", "mobile-app"],
  "web-apps": ["web-app"],
};
const lookup: DictionaryLookup = (dict) => DICTIONARIES[dict] ?? null;

const event = (earlier: Field, later: Field) =>
  layerMerge(earlier, later, { layer: "event", dictionaryValues: lookup });
const base = (earlier: Field | undefined, later: Field) =>
  layerMerge(earlier, later, { layer: "base", dictionaryValues: lookup });

describe("layerMerge", () => {
  it("keeps the earlier type on a conflict and inherits it when the later layer has none", () => {
    expect(event({ type: "string" }, {})).toEqual({ field: { type: "string" }, problems: [] });
    const conflict = event({ type: "string" }, { type: "integer" });
    expect(conflict.field.type).toBe("string");
    expect(conflict.problems).toEqual([
      {
        keyword: "",
        message: "Field type conflict: base 'string' vs override 'integer'",
        rule: "type",
      },
    ]);
    expect(base({ type: "string" }, { type: "number" }).problems[0]?.message).toBe(
      "Field type conflict: base 'string' vs target 'number'",
    );
  });

  it("never changes or replaces a fixed value", () => {
    expect(event({ type: "string", value: "a" }, { value: "a" }).problems).toEqual([]);
    expect(event({ value: "a" }, { value: "b" }).problems).toEqual([
      { keyword: "value", message: 'Cannot change the fixed value "a" to "b"', rule: "fixed" },
    ]);
    expect(event({ value: [1, 2] }, { value: [1, 2] }).problems).toEqual([]);
    expect(event({ value: 2 }, { enum: [2] }).problems[0]).toMatchObject({
      keyword: "enum",
      message: "Cannot replace the fixed value 2 with an enum",
    });
    expect(event({ value: "a" }, { dict: "apps" }).problems[0]).toMatchObject({
      keyword: "dict",
      message: 'Cannot replace the fixed value "a" with a dictionary',
    });
  });

  it("keeps a later value, enum or dict within the earlier enum or dictionary", () => {
    const narrowing = (earlier: Field, later: Field) =>
      event(earlier, later).problems.map(({ keyword, message, rule, dictionary }) => ({
        keyword,
        message,
        rule,
        ...(dictionary ? { dictionary } : {}),
      }));
    expect(narrowing({ enum: ["a", "b"] }, { value: "a" })).toEqual([]);
    expect(narrowing({ enum: ["a", "b"] }, { value: "c" })).toEqual([
      {
        keyword: "value",
        message: 'Value "c" is not in allowed enum: [a, b]',
        rule: "narrowing",
      },
    ]);
    // Values compare by type and value
    expect(narrowing({ enum: [1, 2] }, { value: "1" })).toHaveLength(1);
    expect(narrowing({ dict: "apps" }, { value: "admin" })).toEqual([
      {
        keyword: "value",
        message: "Value 'admin' is not in dictionary 'apps'",
        rule: "narrowing",
        dictionary: true,
      },
    ]);
    expect(narrowing({ enum: ["a", "b"] }, { enum: ["a", "c", "d"] })).toEqual([
      {
        keyword: "enum",
        message: "Enum values [c, d] are not in spec enum: [a, b]",
        rule: "narrowing",
      },
    ]);
    expect(narrowing({ dict: "apps" }, { enum: ["web-app", "tv-app"] })[0]?.message).toBe(
      "Enum values [tv-app] are not in dictionary 'apps'",
    );
    expect(narrowing({ dict: "apps" }, { dict: "web-apps" })).toEqual([]);
    expect(narrowing({ enum: ["web-app"] }, { dict: "apps" })[0]?.message).toBe(
      "Dictionary 'apps' has values [mobile-app] that are not in base enum [web-app]",
    );
    // Unknown dictionaries and empty enums are reported where they are written: no rule here
    expect(narrowing({ dict: "nowhere" }, { value: "x" })).toEqual([]);
    expect(narrowing({ enum: [] }, { value: "x" })).toEqual([]);
    expect(narrowing({ dict: "apps" }, { dict: "nowhere" })).toEqual([]);
  });

  it("replaces value, enum and dict with the one the later layer sets", () => {
    expect(event({ type: "string", enum: ["a", "b"] }, { value: "a" }).field).toEqual({
      type: "string",
      value: "a",
    });
    expect(event({ type: "string", dict: "apps" }, { enum: ["web-app"] }).field).toEqual({
      type: "string",
      enum: ["web-app"],
    });
    expect(event({ type: "string", enum: ["web-app"] }, { dict: "web-apps" }).field).toEqual({
      type: "string",
      dict: "web-apps",
    });
  });

  it("merges items keyword by keyword", () => {
    const earlier: Field = { type: "array", items: { type: "string", enum: ["a", "b"] } };
    const narrowed = event(earlier, { items: { enum: ["a"], minLength: 1 } });
    expect(narrowed.field.items).toEqual({ type: "string", enum: ["a"], minLength: 1 });
    expect(narrowed.problems).toEqual([]);
    expect(event(earlier, { items: { enum: ["a", "z"] } }).problems).toEqual([
      {
        keyword: "items.enum",
        message: "Enum values [z] are not in spec enum: [a, b]",
        rule: "narrowing",
      },
    ]);
    expect(event(earlier, { items: { type: "integer" } }).problems).toEqual([
      {
        keyword: "items",
        message: "Item type conflict: base 'string' vs override 'integer'",
        rule: "type",
      },
    ]);
  });

  it("cannot weaken required; the result is required when any layer says so", () => {
    expect(event({ required: true }, { required: false }).problems).toEqual([
      {
        keyword: "",
        message: "Cannot weaken required field (base required=true, override required=false)",
        rule: "required",
      },
    ]);
    expect(base({ required: true }, { required: false }).problems[0]?.message).toBe(
      "Cannot weaken required field in target schema (base required=true, target required=false)",
    );
    expect(event({ required: true }, { required: false }).field.required).toBe(true);
    expect(event({}, { required: true }).field.required).toBe(true);
  });

  it("raises policy in base layers, never lowers it, and ignores it in events", () => {
    expect(base({ policy: "specified" }, { policy: "fixed" }).field.policy).toBe("fixed");
    const lowered = base({ policy: "fixed" }, { policy: "restricted" });
    expect(lowered.field.policy).toBe("fixed");
    expect(lowered.problems).toEqual([
      { keyword: "policy", message: "Cannot lower policy 'fixed' to 'restricted'", rule: "policy" },
    ]);
    expect(event({ policy: "restricted" }, { policy: "specified" })).toEqual({
      field: { policy: "restricted" },
      problems: [],
    });
    expect(layerMerge(undefined, { policy: "fixed" }, { layer: "event" }).field).toEqual({});
  });

  it("merges checks and pii by key; x-* keys and other keywords: the later one wins", () => {
    const merged = event(
      {
        title: "A",
        checks: { a: true, b: { x: 1 } },
        pii: { kind: "email", owner: "x" },
        "x-acme": { a: 1, b: 2 },
      },
      { title: "B", checks: { b: false, c: true }, pii: { owner: "y" }, "x-acme": { c: 3 } },
    ).field;
    expect(merged).toEqual({
      title: "B",
      checks: { a: true, b: false, c: true },
      pii: { kind: "email", owner: "y" },
      "x-acme": { c: 3 },
    });
  });

  it("drops an inherited example that a later restriction no longer allows", () => {
    const catalog: Field = { type: "string", enum: ["free", "pro", "team"], example: "team" };
    expect(event(catalog, { enum: ["free", "pro"] }).field).not.toHaveProperty("example");
    expect(event(catalog, { enum: ["pro", "team"] }).field.example).toBe("team");
    expect(event(catalog, { value: "team" }).field.example).toBe("team");
    expect(event(catalog, { value: "pro" }).field).not.toHaveProperty("example");
    // The later example wins; constraints alone never drop an example
    expect(event(catalog, { enum: ["free"], example: "pro" }).field.example).toBe("pro");
    expect(event(catalog, { maxLength: 2 }).field.example).toBe("team");
    // Dictionaries and items
    const app: Field = { type: "string", example: "mobile-app" };
    expect(event(app, { dict: "web-apps" }).field).not.toHaveProperty("example");
    expect(event(app, { dict: "nowhere" }).field.example).toBe("mobile-app");
    const tags: Field = { type: "array", items: { type: "string" }, example: ["a", "b"] };
    expect(event(tags, { items: { enum: ["a"] } }).field).not.toHaveProperty("example");
    expect(event(tags, { items: { enum: ["a", "b"] } }).field.example).toEqual(["a", "b"]);
  });
});

describe("refMerge", () => {
  it("lets a derived version change values freely; only type and required are errors", () => {
    const issues: Array<{ path: string; message: string }> = [];
    const merged = refMerge(
      {
        a: { type: "string", enum: ["x", "y"], checks: { c1: true } },
        b: { value: 1, required: true },
        c: { type: "string" },
      },
      {
        a: { value: "z", checks: { c2: true } },
        b: { required: false },
        c: { type: "number" },
        d: {},
      },
      issues,
      "payload.web.2.0",
    );
    expect(merged).toEqual({
      a: { type: "string", value: "z", checks: { c1: true, c2: true } },
      b: { value: 1, required: false },
      c: { type: "number" },
      d: {},
    });
    expect(issues).toEqual([
      {
        path: "payload.web.2.0.schema.b",
        message: "Cannot weaken required field (base required=true, override required=false)",
      },
      {
        path: "payload.web.2.0.schema.c",
        message: "Field type conflict: base 'string' vs override 'number'",
      },
    ]);
  });

  it("drops an inherited example that a dict or items.dict no longer allows (with a lookup)", () => {
    const lookup = (dict: string) => (dict === "small" ? ["a"] : null);
    const base = {
      method: { type: "string", example: "b" },
      tags: { type: "array", items: { type: "string" }, example: ["a", "b"] },
    } satisfies Record<string, Field>;
    const narrowed = { method: { dict: "small" }, tags: { items: { dict: "small" } } };
    const merged = refMerge(base, narrowed, undefined, undefined, lookup);
    expect(merged.method).toEqual({ type: "string", dict: "small" });
    expect(merged.tags).toEqual({ type: "array", items: { dict: "small" } });
    // An unknown dictionary, or no lookup, keeps the example
    expect(
      refMerge(base, { method: { dict: "nowhere" } }, undefined, undefined, lookup).method,
    ).toHaveProperty("example", "b");
    expect(refMerge(base, narrowed).method).toHaveProperty("example", "b");
  });
});

function makeConfig(): OpenTPConfig {
  return {
    opentp: "2026-09",
    info: { title: "Payload test", version: "1.0.0" },
    spec: {
      paths: { events: { root: "/events", template: "{area}/{event}.yaml" } },
      targets: {
        all: {
          schema: {
            event_name: { type: "string", policy: "fixed" },
            category: { type: "string", policy: "restricted" },
          },
        },
        ios: { schema: { category: { enum: ["a", "b"] }, device: { type: "string" } } },
      },
      events: {
        taxonomy: {},
        payload: {
          targets: { all: ["web", "ios"] },
          schema: {
            user_id: { type: "string", title: "User" },
            plan: { type: "string", enum: ["free", "pro"], example: "pro" },
          },
        },
      },
    },
  };
}

describe("mergeBaseLayers", () => {
  it("merges catalog -> spec.targets.all -> spec.targets.<T> and tracks the declaring layer", () => {
    const web = mergeBaseLayers(makeConfig(), "web");
    expect([...web.fields.keys()]).toEqual(["user_id", "plan", "event_name", "category"]);
    expect(web.fields.get("user_id")).toMatchObject({
      common: false,
      sites: ["spec.events.payload.schema.user_id"],
    });
    expect(web.fields.get("category")).toMatchObject({
      common: true,
      policy: "restricted",
      restrictedAfterPolicy: false,
      sites: ["spec.targets.all.schema.category"],
    });

    // ios restricts category after spec.targets.all declared the policy
    const ios = mergeBaseLayers(makeConfig(), "ios");
    expect(ios.fields.get("category")).toMatchObject({
      field: { type: "string", policy: "restricted", enum: ["a", "b"] },
      restrictedAfterPolicy: true,
      fixedAfterPolicy: false,
      sites: ["spec.targets.all.schema.category", "spec.targets.ios.schema.category"],
    });
    expect(ios.fields.get("device")?.common).toBe(true);
    expect(ios.problems).toEqual([]);

    // A layer that sets the policy again becomes the declaring layer
    const config = makeConfig();
    config.spec.targets!.ios.schema!.category = { enum: ["a"], policy: "restricted" };
    expect(mergeBaseLayers(config, "ios").fields.get("category")?.restrictedAfterPolicy).toBe(
      false,
    );
  });
});

describe("resolveEffectivePayload", () => {
  it("lists the common fields of the target and the fields the event lists, merged", () => {
    const { targets, issues } = resolveEffectivePayload(
      {
        schema: {
          event_name: { value: "login" },
          category: { value: "a" },
          plan: { enum: ["free"] },
        },
      },
      makeConfig(),
    );
    expect(issues).toEqual([]);
    const web = targets.web.versions.__unversioned__;
    expect(Object.keys(web)).toEqual(["event_name", "category", "plan"]);
    // A catalog field the event does not list (user_id) is not part of it
    expect(web.plan).toEqual({ type: "string", enum: ["free"] });
    expect(targets.web.layers.__unversioned__).toEqual({
      event_name: ["all", "event"],
      category: ["all", "event"],
      plan: ["catalog", "event"],
    });
    const ios = targets.ios.versions.__unversioned__;
    expect(Object.keys(ios)).toEqual(["event_name", "category", "device", "plan"]);
    expect(targets.ios.layers.__unversioned__.category).toEqual(["all", "target", "event"]);
    expect(ios.device).toEqual({ type: "string" });
  });

  it("reports a resolution problem once although a selector covers several targets", () => {
    const { issues } = resolveEventPayload(
      {
        all: {
          current: "2.0",
          "1.0": { schema: { user_id: { type: "string" } } },
          "2.0": { $ref: "1.0", schema: { user_id: { type: "number" } } },
        },
      },
      makeConfig(),
    );
    expect(issues).toEqual([
      {
        path: "payload.all.2.0.schema.user_id",
        message: "Field type conflict: base 'string' vs override 'number'",
      },
    ]);
  });
});
