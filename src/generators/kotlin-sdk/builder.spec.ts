import { describe, expect, it } from "vitest";
import type { MappedEvent } from "../sdk-common/types";
import { buildKotlin, fieldToKotlinType, renderDataClass, renderEnumClass } from "./builder";

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

describe("fieldToKotlinType", () => {
  it("maps string to String", () => {
    expect(
      fieldToKotlinType({ name: "f", baseType: "string", required: true, isArray: false }),
    ).toBe("String");
  });

  it("maps integer to Int", () => {
    expect(
      fieldToKotlinType({ name: "f", baseType: "integer", required: true, isArray: false }),
    ).toBe("Int");
  });

  it("maps number to Double", () => {
    expect(
      fieldToKotlinType({ name: "f", baseType: "number", required: true, isArray: false }),
    ).toBe("Double");
  });

  it("maps boolean to Boolean", () => {
    expect(
      fieldToKotlinType({ name: "f", baseType: "boolean", required: true, isArray: false }),
    ).toBe("Boolean");
  });

  it("returns enum class name for enum values", () => {
    expect(
      fieldToKotlinType({
        name: "auth_method",
        baseType: "string",
        enumValues: ["email", "google"],
        required: true,
        isArray: false,
      }),
    ).toBe("AuthMethod");
  });

  it("maps List types for arrays", () => {
    expect(
      fieldToKotlinType({
        name: "tags",
        baseType: "array",
        arrayItemType: "string",
        required: true,
        isArray: true,
      }),
    ).toBe("List<String>");
  });

  it("maps array of enums to List<EnumName>", () => {
    expect(
      fieldToKotlinType({
        name: "roles",
        baseType: "array",
        arrayItemType: "string",
        arrayItemEnum: ["admin", "user"],
        required: true,
        isArray: true,
      }),
    ).toBe("List<Roles>");
  });
});

describe("renderDataClass", () => {
  it("generates required val fields", () => {
    const event: MappedEvent = {
      ...mockEvent,
      params: [{ name: "method", baseType: "string", required: true, isArray: false }],
    };
    const output = renderDataClass(event, true);
    expect(output).toContain("val method: String");
    expect(output).not.toContain("? = null");
  });

  it("generates optional nullable fields with ? = null", () => {
    const event: MappedEvent = {
      ...mockEvent,
      params: [{ name: "screen", baseType: "string", required: false, isArray: false }],
    };
    const output = renderDataClass(event, true);
    expect(output).toContain("val screen: String? = null");
  });

  it("includes PII comments", () => {
    const output = renderDataClass(mockEvent, true);
    expect(output).toContain("/** PII: user_id */");
  });

  it("includes @SerialName when not standalone", () => {
    const output = renderDataClass(mockEvent, false);
    expect(output).toContain("@Serializable");
    expect(output).toContain('@SerialName("auth_method")');
    expect(output).toContain('@SerialName("user_id")');
  });
});

describe("renderEnumClass", () => {
  it("generates entries with UPPER_CASE convention", () => {
    const output = renderEnumClass("auth_method", ["email", "google"], true);
    expect(output).toContain("enum class AuthMethod(val value: String)");
    expect(output).toContain('EMAIL("email")');
    expect(output).toContain('GOOGLE("google")');
  });

  it("includes @SerialName annotations when not standalone", () => {
    const output = renderEnumClass("status", ["active", "draft"], false);
    expect(output).toContain("@Serializable");
    expect(output).toContain('@SerialName("active")');
    expect(output).toContain('@SerialName("draft")');
  });

  it("prefixes digit-leading enum values with underscore", () => {
    const output = renderEnumClass(
      "company_size",
      ["1", "2_10", "11_50", "51_200", "201_1000", "1000_plus"],
      true,
    );
    expect(output).toContain('_1("1")');
    expect(output).toContain('_2_10("2_10")');
    expect(output).toContain('_11_50("11_50")');
    expect(output).toContain('_51_200("51_200")');
    expect(output).toContain('_201_1000("201_1000")');
    expect(output).toContain('_1000_PLUS("1000_plus")');
  });
});

describe("buildKotlin", () => {
  const buildOptions = {
    planTitle: "Test Plan",
    planVersion: "1.0.0",
    targetName: "android",
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("includes header with plan metadata", () => {
    const output = buildKotlin([mockEvent], { ...buildOptions, standalone: true });
    expect(output).toContain("Auto-generated by OpenTrackPlan CLI");
    expect(output).toContain("Test Plan v1.0.0");
    expect(output).toContain("Target: android");
    expect(output).toContain("Events: 1");
  });

  it("includes kotlinx import when not standalone", () => {
    const output = buildKotlin([mockEvent], buildOptions);
    expect(output).toContain("import kotlinx.serialization.*");
  });

  it("omits kotlinx import in standalone mode", () => {
    const output = buildKotlin([mockEvent], { ...buildOptions, standalone: true });
    expect(output).not.toContain("kotlinx");
  });

  it("generates data classes", () => {
    const output = buildKotlin([mockEvent], { ...buildOptions, standalone: true });
    expect(output).toContain("data class AuthLoginButtonClickParams(");
  });

  it("generates enum classes", () => {
    const output = buildKotlin([mockEvent], { ...buildOptions, standalone: true });
    expect(output).toContain("enum class AuthMethod(val value: String)");
  });

  it("generates object registry", () => {
    const output = buildKotlin([mockEvent], { ...buildOptions, standalone: true });
    expect(output).toContain("object Events {");
    expect(output).toContain("object Auth {");
    expect(output).toContain('val loginButtonClick = "auth::login_button_click"');
  });

  it("generates buildPayload methods", () => {
    const output = buildKotlin([mockEvent], { ...buildOptions, standalone: true });
    expect(output).toContain(
      "fun buildPayload(params: AuthLoginButtonClickParams): Map<String, Any>",
    );
    expect(output).toContain('"application_id" to "web-app"');
    expect(output).toContain("params.authMethod.value");
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
    const output = buildKotlin([noParamsEvent], { ...buildOptions, standalone: true });
    expect(output).not.toContain("data class AppInitParams");
    expect(output).toContain("fun buildPayload(): Map<String, Any>");
    expect(output).toContain('"event_name" to "app_init"');
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
    const output = buildKotlin([arrayEvent], { ...buildOptions, standalone: true });
    expect(output).toContain("val tags: List<String>");
  });
});
