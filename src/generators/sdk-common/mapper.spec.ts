import { describe, expect, it } from "vitest";
import type { OpenTPConfig, ResolvedEvent } from "../../types";
import { mapEvents, resolveField, toCamelCase, toPascalCase } from "./mapper";

// -- Helpers --

const emptyDict = new Map<string, (string | number | boolean)[]>();

const baseConfig: OpenTPConfig = {
  opentp: "2026-01",
  info: { title: "Test", version: "1.0.0" },
  spec: {
    paths: { events: { root: "/events", template: "{area}/{event}.yaml" } },
    events: {
      taxonomy: {},
      payload: {
        targets: { all: ["web", "ios", "android"], mobile: ["ios", "android"] },
        schema: {
          event_name: { type: "string", required: true },
          event_category: { type: "string", required: true },
        },
      },
    },
  },
};

function makeEvent(overrides: Partial<ResolvedEvent>): ResolvedEvent {
  return {
    filePath: "/events/test/event.yaml",
    relativePath: "test/event.yaml",
    key: "test::event",
    expectedKey: null,
    taxonomy: { area: "test", event: "event" },
    ignore: [],
    payload: { schema: {} },
    ...overrides,
  };
}

// -- Tests --

describe("toCamelCase", () => {
  it("converts snake_case", () => {
    expect(toCamelCase("login_button_click")).toBe("loginButtonClick");
  });

  it("handles single word", () => {
    expect(toCamelCase("auth")).toBe("auth");
  });

  it("handles kebab-case", () => {
    expect(toCamelCase("login-click")).toBe("loginClick");
  });

  it("handles multiple underscores", () => {
    expect(toCamelCase("a_b_c_d")).toBe("aBCD");
  });
});

describe("toPascalCase", () => {
  it("converts snake_case", () => {
    expect(toPascalCase("login_button_click")).toBe("LoginButtonClick");
  });

  it("handles single word", () => {
    expect(toPascalCase("auth")).toBe("Auth");
  });
});

describe("resolveField", () => {
  it("maps string", () => {
    const result = resolveField("f", { type: "string" }, emptyDict);
    expect(result.baseType).toBe("string");
    expect(result.enumValues).toBeUndefined();
    expect(result.isArray).toBe(false);
  });

  it("maps number", () => {
    const result = resolveField("f", { type: "number" }, emptyDict);
    expect(result.baseType).toBe("number");
  });

  it("preserves integer (not mapped to number)", () => {
    const result = resolveField("f", { type: "integer" }, emptyDict);
    expect(result.baseType).toBe("integer");
  });

  it("maps boolean", () => {
    const result = resolveField("f", { type: "boolean" }, emptyDict);
    expect(result.baseType).toBe("boolean");
  });

  it("maps string enum", () => {
    const result = resolveField("f", { type: "string", enum: ["a", "b"] }, emptyDict);
    expect(result.baseType).toBe("string");
    expect(result.enumValues).toEqual(["a", "b"]);
  });

  it("maps number enum", () => {
    const result = resolveField("f", { type: "number", enum: [1, 2] }, emptyDict);
    expect(result.baseType).toBe("number");
    expect(result.enumValues).toEqual([1, 2]);
  });

  it("preserves boolean enum [true, false]", () => {
    const result = resolveField("f", { type: "boolean", enum: [true, false] }, emptyDict);
    expect(result.baseType).toBe("boolean");
    expect(result.enumValues).toEqual([true, false]);
  });

  it("maps dict to enumValues", () => {
    const dicts = new Map([["taxonomy/areas", ["auth", "dashboard"]]]);
    const result = resolveField("f", { type: "string", dict: "taxonomy/areas" }, dicts);
    expect(result.baseType).toBe("string");
    expect(result.enumValues).toEqual(["auth", "dashboard"]);
  });

  it("falls back when dict not found", () => {
    const result = resolveField("f", { type: "string", dict: "missing/dict" }, emptyDict);
    expect(result.baseType).toBe("string");
    expect(result.enumValues).toBeUndefined();
  });

  it("maps array of strings", () => {
    const result = resolveField("f", { type: "array", items: { type: "string" } }, emptyDict);
    expect(result.isArray).toBe(true);
    expect(result.baseType).toBe("array");
    expect(result.arrayItemType).toBe("string");
    expect(result.arrayItemEnum).toBeUndefined();
  });

  it("maps array with enum items", () => {
    const result = resolveField(
      "f",
      { type: "array", items: { type: "string", enum: ["a", "b"] } },
      emptyDict,
    );
    expect(result.isArray).toBe(true);
    expect(result.arrayItemType).toBe("string");
    expect(result.arrayItemEnum).toEqual(["a", "b"]);
  });

  it("maps array with no items to unknown", () => {
    const result = resolveField("f", { type: "array" }, emptyDict);
    expect(result.isArray).toBe(true);
    expect(result.baseType).toBe("unknown");
    expect(result.arrayItemType).toBe("unknown");
  });

  it("infers string from string value", () => {
    const result = resolveField("f", { value: "hello" }, emptyDict);
    expect(result.baseType).toBe("string");
  });

  it("infers number from number value", () => {
    const result = resolveField("f", { value: 42 }, emptyDict);
    expect(result.baseType).toBe("number");
  });

  it("infers boolean from boolean value", () => {
    const result = resolveField("f", { value: true }, emptyDict);
    expect(result.baseType).toBe("boolean");
  });

  it("returns unknown when no type info", () => {
    const result = resolveField("f", {}, emptyDict);
    expect(result.baseType).toBe("unknown");
  });

  it("dict with number values", () => {
    const dicts = new Map<string, (string | number | boolean)[]>([["codes", [100, 200, 300]]]);
    const result = resolveField("f", { type: "number", dict: "codes" }, dicts);
    expect(result.baseType).toBe("number");
    expect(result.enumValues).toEqual([100, 200, 300]);
  });

  it("array items with dict", () => {
    const dicts = new Map<string, (string | number | boolean)[]>([["tags", ["a", "b"]]]);
    const result = resolveField(
      "f",
      { type: "array", items: { type: "string", dict: "tags" } },
      dicts,
    );
    expect(result.isArray).toBe(true);
    expect(result.arrayItemType).toBe("string");
    expect(result.arrayItemEnum).toEqual(["a", "b"]);
  });

  it("preserves required, description, and piiKind", () => {
    const result = resolveField(
      "user_email",
      {
        type: "string",
        required: true,
        description: "User email address",
        pii: { kind: "email", masker: "star" },
      },
      emptyDict,
    );
    expect(result.name).toBe("user_email");
    expect(result.required).toBe(true);
    expect(result.description).toBe("User email address");
    expect(result.piiKind).toBe("email");
  });
});

describe("mapEvents", () => {
  it("maps a simple event with params and constants", () => {
    const events = [
      makeEvent({
        key: "auth::login_button_click",
        lifecycle: { status: "active" },
        payload: {
          schema: {
            event_name: { value: "login_button_click" },
            event_category: { value: "auth" },
            auth_method: {
              type: "string",
              enum: ["email", "google"],
              required: true,
            },
          },
        },
      }),
    ];

    const result = mapEvents(events, baseConfig, emptyDict, "web");

    expect(result).toHaveLength(1);
    const mapped = result[0];
    expect(mapped.key).toBe("auth::login_button_click");
    expect(mapped.area).toBe("auth");
    expect(mapped.eventName).toBe("loginButtonClick");
    expect(mapped.interfaceName).toBe("AuthLoginButtonClickParams");
    expect(mapped.status).toBe("active");
    expect(mapped.constants.event_name).toBe("login_button_click");
    expect(mapped.constants.event_category).toBe("auth");
    const authParam = mapped.params.find((p) => p.name === "auth_method");
    expect(authParam).toEqual({
      name: "auth_method",
      baseType: "string",
      enumValues: ["email", "google"],
      required: true,
      isArray: false,
      description: undefined,
      piiKind: undefined,
    });
  });

  it("skips deprecated events", () => {
    const events = [
      makeEvent({
        key: "old::removed_event",
        lifecycle: { status: "deprecated" },
        payload: { schema: { event_name: { value: "removed" } } },
      }),
    ];

    const result = mapEvents(events, baseConfig, emptyDict, "web");
    expect(result).toHaveLength(0);
  });

  it("skips events without the requested target", () => {
    // Event with only "mobile" selector — should be skipped for "web"
    const events = [
      makeEvent({
        key: "onboarding::step_complete",
        payload: {
          mobile: {
            schema: {
              step: { type: "number", required: true },
            },
          },
        },
      }),
    ];

    const result = mapEvents(events, baseConfig, emptyDict, "web");
    expect(result).toHaveLength(0);

    // But present for ios
    const iosResult = mapEvents(events, baseConfig, emptyDict, "ios");
    expect(iosResult).toHaveLength(1);
  });

  it("handles event with only constants (no params)", () => {
    const events = [
      makeEvent({
        key: "nav::page_view",
        payload: {
          schema: {
            event_name: { value: "page_view" },
            event_category: { value: "nav" },
          },
        },
      }),
    ];

    const result = mapEvents(events, baseConfig, emptyDict, "web");
    expect(result).toHaveLength(1);
    // Base schema fields without value become params
    // event_name and event_category are overridden with values → constants
    expect(result[0].constants.event_name).toBe("page_view");
    expect(result[0].constants.event_category).toBe("nav");
    expect(result[0].params).toHaveLength(0);
  });

  it("merges base schema with event schema", () => {
    const events = [
      makeEvent({
        key: "test::merge",
        payload: {
          schema: {
            event_name: { value: "merge" },
            event_category: { value: "test" },
            custom_field: { type: "string", required: true },
          },
        },
      }),
    ];

    const result = mapEvents(events, baseConfig, emptyDict, "web");
    expect(result).toHaveLength(1);

    // Base schema fields overridden by event become constants
    expect(result[0].constants.event_name).toBe("merge");
    // custom_field from event schema should appear as param
    const customParam = result[0].params.find((p) => p.name === "custom_field");
    expect(customParam).toBeDefined();
    expect(customParam!.baseType).toBe("string");
    expect(customParam!.required).toBe(true);
  });

  it("extracts piiKind from field pii metadata", () => {
    const events = [
      makeEvent({
        key: "auth::login",
        payload: {
          schema: {
            event_name: { value: "login" },
            event_category: { value: "auth" },
            user_id: {
              type: "string",
              required: false,
              pii: { kind: "user_id", masker: "star" },
            },
          },
        },
      }),
    ];

    const result = mapEvents(events, baseConfig, emptyDict, "web");
    const userIdParam = result[0].params.find((p) => p.name === "user_id");
    expect(userIdParam?.piiKind).toBe("user_id");
  });

  it("sets isArray for array fields", () => {
    const events = [
      makeEvent({
        key: "test::arrays",
        payload: {
          schema: {
            event_name: { value: "arrays" },
            event_category: { value: "test" },
            tags: {
              type: "array",
              items: { type: "string" },
              required: false,
            },
          },
        },
      }),
    ];

    const result = mapEvents(events, baseConfig, emptyDict, "web");
    const tagsParam = result[0].params.find((p) => p.name === "tags");
    expect(tagsParam?.isArray).toBe(true);
    expect(tagsParam?.arrayItemType).toBe("string");
  });

  it("resolves versioned payloads with $ref", () => {
    const events = [
      makeEvent({
        key: "auth::login_click",
        payload: {
          all: {
            current: "stable",
            stable: "1.1.0",
            "1.0.0": {
              schema: {
                event_name: { value: "login_click" },
                event_category: { value: "auth" },
                auth_method: {
                  type: "string",
                  enum: ["email", "google"],
                  required: true,
                },
              },
            },
            "1.1.0": {
              $ref: "1.0.0",
              schema: {
                screen_name: { type: "string", required: false },
              },
            },
          },
        },
      }),
    ];

    const result = mapEvents(events, baseConfig, emptyDict, "web");
    expect(result).toHaveLength(1);

    // 1.1.0 should inherit auth_method from 1.0.0 and add screen_name
    expect(result[0].constants.event_name).toBe("login_click");
    const authParam = result[0].params.find((p) => p.name === "auth_method");
    expect(authParam).toBeDefined();
    expect(authParam!.baseType).toBe("string");
    expect(authParam!.enumValues).toEqual(["email", "google"]);
    const screenParam = result[0].params.find((p) => p.name === "screen_name");
    expect(screenParam).toBeDefined();
    expect(screenParam!.baseType).toBe("string");
  });

  it("includes draft events", () => {
    const events = [
      makeEvent({
        key: "test::draft_event",
        lifecycle: { status: "draft" },
        payload: {
          schema: {
            event_name: { value: "draft" },
            event_category: { value: "test" },
          },
        },
      }),
    ];

    const result = mapEvents(events, baseConfig, emptyDict, "web");
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("draft");
  });
});
