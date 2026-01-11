import { describe, expect, it } from "vitest";
import { toSnakeCase } from "./index";

describe("to-snake-case", () => {
  const transform = toSnakeCase.factory();

  it("converts camelCase to snake_case", () => {
    expect(transform("helloWorld")).toBe("hello_world");
    expect(transform("myVariableName")).toBe("my_variable_name");
  });

  it("converts PascalCase to snake_case", () => {
    expect(transform("HelloWorld")).toBe("hello_world");
    expect(transform("MyClassName")).toBe("my_class_name");
  });

  it("handles consecutive uppercase", () => {
    expect(transform("XMLParser")).toBe("x_m_l_parser");
    expect(transform("getHTTPResponse")).toBe("get_h_t_t_p_response");
  });

  it("handles already lowercase", () => {
    expect(transform("hello")).toBe("hello");
  });

  it("handles spaces and special chars", () => {
    expect(transform("hello world")).toBe("hello_world");
    expect(transform("hello-world")).toBe("hello_world");
  });

  it("handles empty string", () => {
    expect(transform("")).toBe("");
  });
});
