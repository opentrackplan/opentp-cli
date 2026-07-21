import { describe, expect, it } from "vitest";
import type { MappedEvent } from "../sdk-common/types";
import { buildTypescript, fieldToTsType, renderEnumConst } from "./builder";

const mockEvent: MappedEvent = {
  key: "auth::login_button_click",
  area: "auth",
  eventName: "loginButtonClick",
  interfaceName: "AuthLoginButtonClickParams",
  params: [
    {
      name: "auth_method",
      baseType: "string",
      enumValues: ["email", "google"],
      required: true,
      isArray: false,
    },
    { name: "user_id", baseType: "string", required: false, isArray: false, piiKind: "user_id" },
  ],
  constants: { application_id: "web-app", event_name: "login_button_click" },
  status: "active",
};

describe("fieldToTsType", () => {
  it("maps string base type", () => {
    expect(fieldToTsType({ name: "f", baseType: "string", required: true, isArray: false })).toBe(
      "string",
    );
  });

  it("maps number base type", () => {
    expect(fieldToTsType({ name: "f", baseType: "number", required: true, isArray: false })).toBe(
      "number",
    );
  });

  it("maps integer to number", () => {
    expect(fieldToTsType({ name: "f", baseType: "integer", required: true, isArray: false })).toBe(
      "number",
    );
  });

  it("maps boolean base type", () => {
    expect(fieldToTsType({ name: "f", baseType: "boolean", required: true, isArray: false })).toBe(
      "boolean",
    );
  });

  it("returns enum name for enum values", () => {
    expect(
      fieldToTsType({
        name: "auth_method",
        baseType: "string",
        enumValues: ["email", "google"],
        required: true,
        isArray: false,
      }),
    ).toBe("AuthMethod");
  });

  it("returns enum name for number enum values", () => {
    expect(
      fieldToTsType({
        name: "priority",
        baseType: "number",
        enumValues: [1, 2],
        required: true,
        isArray: false,
      }),
    ).toBe("Priority");
  });

  it("simplifies boolean enum [true, false] to boolean", () => {
    expect(
      fieldToTsType({
        name: "f",
        baseType: "boolean",
        enumValues: [true, false],
        required: true,
        isArray: false,
      }),
    ).toBe("boolean");
  });

  it("returns enum name array for array with enum items", () => {
    expect(
      fieldToTsType({
        name: "roles",
        baseType: "array",
        arrayItemType: "string",
        arrayItemEnum: ["admin", "editor"],
        required: true,
        isArray: true,
      }),
    ).toBe("Roles[]");
  });

  it("renders array of plain type", () => {
    expect(
      fieldToTsType({
        name: "f",
        baseType: "array",
        arrayItemType: "string",
        required: true,
        isArray: true,
      }),
    ).toBe("string[]");
  });

  it("renders array of integers as number[]", () => {
    expect(
      fieldToTsType({
        name: "f",
        baseType: "array",
        arrayItemType: "integer",
        required: true,
        isArray: true,
      }),
    ).toBe("number[]");
  });

  it("renders unknown for unknown base type", () => {
    expect(fieldToTsType({ name: "f", baseType: "unknown", required: true, isArray: false })).toBe(
      "unknown",
    );
  });

  it("renders unknown[] for array with no item info", () => {
    expect(fieldToTsType({ name: "f", baseType: "unknown", required: true, isArray: true })).toBe(
      "unknown[]",
    );
  });
});

describe("buildTypescript", () => {
  it("generates SDK-compatible format by default", () => {
    const output = buildTypescript([mockEvent], {
      planTitle: "Test Plan",
      planVersion: "1.0.0",
      targetName: "web",
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    // Should import from @opentp/sdk
    expect(output).toContain("import type { TrackingEvent } from '@opentp/sdk'");
    expect(output).toContain("Compatible with @opentp/sdk createTracker()");

    // Should have interfaces
    expect(output).toContain("export interface AuthLoginButtonClickParams");
    expect(output).toContain("auth_method: AuthMethod");
    expect(output).toContain("export const AuthMethod");
    expect(output).toContain("user_id?: string");
    expect(output).toContain("PII: user_id");

    // Should use new object format
    expect(output).toContain("loginButtonClick: {");
    expect(output).toContain("key: 'auth::login_button_click'");
    expect(output).toContain("constants: {");
    expect(output).toContain("application_id: 'web-app'");
    expect(output).toContain("buildPayload(params: AuthLoginButtonClickParams)");
    expect(output).toContain("satisfies TrackingEvent<AuthLoginButtonClickParams>");

    // Should NOT have defineEvent helper
    expect(output).not.toContain("function defineEvent");
  });

  it("generates standalone format with standalone option", () => {
    const output = buildTypescript([mockEvent], {
      planTitle: "Test Plan",
      planVersion: "1.0.0",
      targetName: "web",
      generatedAt: "2026-01-01T00:00:00.000Z",
      standalone: true,
    });

    // Should NOT import from @opentp/sdk
    expect(output).not.toContain("@opentp/sdk");
    expect(output).not.toContain("Compatible with @opentp/sdk createTracker()");

    // Should have inline TrackingEvent interface
    expect(output).toContain("export interface TrackingEvent<TParams = void>");
    expect(output).toContain("function defineEvent");

    // Should use defineEvent helper
    expect(output).toContain("loginButtonClick: defineEvent<AuthLoginButtonClickParams>");

    // Should NOT use satisfies
    expect(output).not.toContain("satisfies");
  });

  it("handles event with no params (void) in SDK mode", () => {
    const noParamsEvent: MappedEvent = {
      key: "app::init",
      area: "app",
      eventName: "init",
      interfaceName: "AppInitParams",
      params: [],
      constants: { event_name: "app_init" },
      status: "active",
    };
    const output = buildTypescript([noParamsEvent], {
      planTitle: "Test",
      planVersion: "1.0.0",
      targetName: "web",
      generatedAt: "",
    });

    expect(output).not.toContain("export interface AppInitParams");
    expect(output).toContain("init: {");
    expect(output).toContain("key: 'app::init'");
    expect(output).toContain("buildPayload()");
    expect(output).toContain("satisfies TrackingEvent<void>");
  });

  it("handles event with no params (void) in standalone mode", () => {
    const noParamsEvent: MappedEvent = {
      key: "app::init",
      area: "app",
      eventName: "init",
      interfaceName: "AppInitParams",
      params: [],
      constants: { event_name: "app_init" },
      status: "active",
    };
    const output = buildTypescript([noParamsEvent], {
      planTitle: "Test",
      planVersion: "1.0.0",
      targetName: "web",
      generatedAt: "",
      standalone: true,
    });

    expect(output).not.toContain("export interface AppInitParams");
    expect(output).toContain("init: defineEvent(");
    expect(output).not.toContain("defineEvent<AppInitParams>");
  });

  it("groups events by area alphabetically", () => {
    const events: MappedEvent[] = [
      {
        ...mockEvent,
        area: "zzz",
        eventName: "last",
        key: "zzz::last",
        interfaceName: "ZzzLastParams",
      },
      {
        ...mockEvent,
        area: "aaa",
        eventName: "first",
        key: "aaa::first",
        interfaceName: "AaaFirstParams",
      },
    ];
    const output = buildTypescript(events, {
      planTitle: "Test",
      planVersion: "1.0.0",
      targetName: "web",
      generatedAt: "",
    });
    const aaaPos = output.indexOf("aaa:");
    const zzzPos = output.indexOf("zzz:");
    expect(aaaPos).toBeLessThan(zzzPos);
  });

  it("escapes single quotes in constant values", () => {
    const event: MappedEvent = {
      key: "test::q",
      area: "test",
      eventName: "q",
      interfaceName: "TestQParams",
      params: [],
      constants: { name: "it's a test" },
      status: "active",
    };
    const output = buildTypescript([event], {
      planTitle: "Test",
      planVersion: "1.0.0",
      targetName: "web",
      generatedAt: "",
    });
    expect(output).toContain("name: 'it\\'s a test'");
  });
});

describe("renderEnumConst", () => {
  it("renders string values with UPPER_CASE keys", () => {
    const result = renderEnumConst("user_role", ["admin", "editor", "viewer"]);
    expect(result).toContain("export const UserRole = {");
    expect(result).toContain("  ADMIN: 'admin',");
    expect(result).toContain("  EDITOR: 'editor',");
    expect(result).toContain("  VIEWER: 'viewer',");
    expect(result).toContain("} as const;");
    expect(result).toContain("export type UserRole = typeof UserRole[keyof typeof UserRole];");
  });

  it("renders number values without quotes", () => {
    const result = renderEnumConst("priority", [1, 2, 3]);
    expect(result).toContain("  _1: 1,");
    expect(result).toContain("  _2: 2,");
    expect(result).toContain("  _3: 3,");
  });

  it("prefixes digit-starting values with underscore", () => {
    const result = renderEnumConst("code", ["3xx", "4xx"]);
    expect(result).toContain("  _3XX: '3xx',");
    expect(result).toContain("  _4XX: '4xx',");
  });

  it("converts hyphens and spaces to underscores", () => {
    const result = renderEnumConst("status", ["in-progress", "not started"]);
    expect(result).toContain("  IN_PROGRESS: 'in-progress',");
    expect(result).toContain("  NOT_STARTED: 'not started',");
  });
});

describe("buildTypescript enum deduplication", () => {
  it("deduplicates same field name across events", () => {
    const events: MappedEvent[] = [
      {
        key: "auth::login",
        area: "auth",
        eventName: "login",
        interfaceName: "AuthLoginParams",
        params: [
          {
            name: "auth_method",
            baseType: "string",
            enumValues: ["email", "google"],
            required: true,
            isArray: false,
          },
        ],
        constants: {},
        status: "active",
      },
      {
        key: "auth::signup",
        area: "auth",
        eventName: "signup",
        interfaceName: "AuthSignupParams",
        params: [
          {
            name: "auth_method",
            baseType: "string",
            enumValues: ["email", "google"],
            required: true,
            isArray: false,
          },
        ],
        constants: {},
        status: "active",
      },
    ];
    const output = buildTypescript(events, {
      planTitle: "Test",
      planVersion: "1.0.0",
      targetName: "web",
      generatedAt: "",
    });
    const matches = output.match(/export const AuthMethod/g);
    expect(matches).toHaveLength(1);
  });

  it("does not generate enum const for boolean [true, false]", () => {
    const events: MappedEvent[] = [
      {
        key: "ui::toggle",
        area: "ui",
        eventName: "toggle",
        interfaceName: "UiToggleParams",
        params: [
          {
            name: "is_active",
            baseType: "boolean",
            enumValues: [true, false],
            required: true,
            isArray: false,
          },
        ],
        constants: {},
        status: "active",
      },
    ];
    const output = buildTypescript(events, {
      planTitle: "Test",
      planVersion: "1.0.0",
      targetName: "web",
      generatedAt: "",
    });
    expect(output).not.toContain("export const IsActive");
    expect(output).toContain("is_active: boolean");
  });

  it("generates enum const for array enum items", () => {
    const events: MappedEvent[] = [
      {
        key: "user::update",
        area: "user",
        eventName: "update",
        interfaceName: "UserUpdateParams",
        params: [
          {
            name: "roles",
            baseType: "array",
            arrayItemType: "string",
            arrayItemEnum: ["admin", "editor"],
            required: true,
            isArray: true,
          },
        ],
        constants: {},
        status: "active",
      },
    ];
    const output = buildTypescript(events, {
      planTitle: "Test",
      planVersion: "1.0.0",
      targetName: "web",
      generatedAt: "",
    });
    expect(output).toContain("export const Roles = {");
    expect(output).toContain("roles: Roles[]");
  });
});
