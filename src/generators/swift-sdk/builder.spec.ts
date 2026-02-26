import { describe, expect, it } from "vitest";
import type { MappedEvent } from "../sdk-common/types";
import { buildSwift, fieldToSwiftType, renderEnum, renderStruct } from "./builder";

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

describe("fieldToSwiftType", () => {
  it("maps string to String", () => {
    expect(
      fieldToSwiftType({ name: "f", baseType: "string", required: true, isArray: false }),
    ).toBe("String");
  });

  it("maps integer to Int", () => {
    expect(
      fieldToSwiftType({ name: "f", baseType: "integer", required: true, isArray: false }),
    ).toBe("Int");
  });

  it("maps number to Double", () => {
    expect(
      fieldToSwiftType({ name: "f", baseType: "number", required: true, isArray: false }),
    ).toBe("Double");
  });

  it("maps boolean to Bool", () => {
    expect(
      fieldToSwiftType({ name: "f", baseType: "boolean", required: true, isArray: false }),
    ).toBe("Bool");
  });

  it("returns named enum type for enum values", () => {
    expect(
      fieldToSwiftType({
        name: "auth_method",
        baseType: "string",
        enumValues: ["email", "google"],
        required: true,
        isArray: false,
      }),
    ).toBe("AuthMethod");
  });

  it("maps array of strings to [String]", () => {
    expect(
      fieldToSwiftType({
        name: "tags",
        baseType: "array",
        arrayItemType: "string",
        required: true,
        isArray: true,
      }),
    ).toBe("[String]");
  });

  it("maps array of enums to [EnumName]", () => {
    expect(
      fieldToSwiftType({
        name: "roles",
        baseType: "array",
        arrayItemType: "string",
        arrayItemEnum: ["admin", "user"],
        required: true,
        isArray: true,
      }),
    ).toBe("[Roles]");
  });
});

describe("renderStruct", () => {
  it("generates required let fields", () => {
    const event: MappedEvent = {
      ...mockEvent,
      params: [{ name: "method", baseType: "string", required: true, isArray: false }],
    };
    const output = renderStruct(event);
    expect(output).toContain("let method: String");
  });

  it("generates optional var fields", () => {
    const event: MappedEvent = {
      ...mockEvent,
      params: [{ name: "screen", baseType: "string", required: false, isArray: false }],
    };
    const output = renderStruct(event);
    expect(output).toContain("var screen: String?");
  });

  it("includes Codable conformance", () => {
    const output = renderStruct(mockEvent);
    expect(output).toContain("struct AuthLoginButtonClickParams: Codable");
  });

  it("generates CodingKeys for snake_case fields", () => {
    const output = renderStruct(mockEvent);
    expect(output).toContain("enum CodingKeys: String, CodingKey");
    expect(output).toContain('case authMethod = "auth_method"');
    expect(output).toContain('case userId = "user_id"');
  });

  it("includes PII comments", () => {
    const output = renderStruct(mockEvent);
    expect(output).toContain("/// PII: user_id");
  });
});

describe("renderEnum", () => {
  it("generates String-backed enum with CaseIterable", () => {
    const output = renderEnum("auth_method", ["email", "google"]);
    expect(output).toContain("enum AuthMethod: String, CaseIterable, Codable");
    expect(output).toContain("case email");
    expect(output).toContain("case google");
  });

  it("handles underscore values with explicit raw value", () => {
    const output = renderEnum("status", ["in_progress", "completed"]);
    expect(output).toContain('case inProgress = "in_progress"');
    expect(output).toContain("case completed");
  });

  it("prefixes digit-leading enum values with underscore", () => {
    const output = renderEnum("company_size", [
      "1",
      "2_10",
      "11_50",
      "51_200",
      "201_1000",
      "1000_plus",
    ]);
    expect(output).toContain('case _1 = "1"');
    expect(output).toContain('case _210 = "2_10"');
    expect(output).toContain('case _1150 = "11_50"');
    expect(output).toContain('case _51200 = "51_200"');
    expect(output).toContain('case _2011000 = "201_1000"');
    expect(output).toContain('case _1000Plus = "1000_plus"');
  });

  it("backtick-escapes Swift reserved keywords in enum cases", () => {
    const output = renderEnum("visibility", ["private", "public", "team", "organization"]);
    expect(output).toContain("case `private`");
    expect(output).toContain("case `public`");
    expect(output).toContain("case team");
    expect(output).toContain("case organization");
  });

  it("backtick-escapes default, import, and other keywords", () => {
    const output = renderEnum("context", ["default", "import", "sidebar"]);
    expect(output).toContain("case `default`");
    expect(output).toContain("case `import`");
    expect(output).toContain("case sidebar");
  });
});

describe("buildSwift", () => {
  const buildOptions = {
    planTitle: "Test Plan",
    planVersion: "1.0.0",
    targetName: "ios",
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("includes header with plan metadata", () => {
    const output = buildSwift([mockEvent], buildOptions);
    expect(output).toContain("Auto-generated by OpenTrackPlan CLI");
    expect(output).toContain("Test Plan v1.0.0");
    expect(output).toContain("Target: ios");
    expect(output).toContain("Events: 1");
  });

  it("includes import Foundation", () => {
    const output = buildSwift([mockEvent], buildOptions);
    expect(output).toContain("import Foundation");
  });

  it("generates one struct per event with params", () => {
    const output = buildSwift([mockEvent], buildOptions);
    expect(output).toContain("struct AuthLoginButtonClickParams: Codable");
  });

  it("generates enums for enum fields", () => {
    const output = buildSwift([mockEvent], buildOptions);
    expect(output).toContain("enum AuthMethod: String, CaseIterable, Codable");
  });

  it("generates event registry with nested enums", () => {
    const output = buildSwift([mockEvent], buildOptions);
    expect(output).toContain("enum Events {");
    expect(output).toContain("enum Auth {");
    expect(output).toContain('static let loginButtonClick = "auth::login_button_click"');
  });

  it("generates buildPayload methods", () => {
    const output = buildSwift([mockEvent], buildOptions);
    expect(output).toContain(
      "static func buildPayload(_ params: AuthLoginButtonClickParams) -> [String: Any]",
    );
    expect(output).toContain('"application_id": "web-app"');
    expect(output).toContain("params.authMethod.rawValue");
  });

  it("handles events with no custom fields", () => {
    const noParamsEvent: MappedEvent = {
      key: "app::init",
      area: "app",
      eventName: "init",
      interfaceName: "AppInitParams",
      params: [],
      constants: { event_name: "app_init" },
      status: "active",
    };
    const output = buildSwift([noParamsEvent], buildOptions);
    expect(output).not.toContain("struct AppInitParams");
    expect(output).toContain("static func buildPayload() -> [String: Any]");
    expect(output).toContain('"event_name": "app_init"');
  });

  it("handles events with array fields", () => {
    const arrayEvent: MappedEvent = {
      key: "test::tags",
      area: "test",
      eventName: "tags",
      interfaceName: "TestTagsParams",
      params: [
        { name: "tags", baseType: "array", arrayItemType: "string", required: true, isArray: true },
      ],
      constants: {},
      status: "active",
    };
    const output = buildSwift([arrayEvent], buildOptions);
    expect(output).toContain("let tags: [String]");
  });
});
