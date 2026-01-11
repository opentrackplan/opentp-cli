import { describe, expect, it } from "vitest";
import { toCamelCase } from "./index";

describe("to-camel-case", () => {
  const transform = toCamelCase.factory();

  it("converts snake_case to camelCase", () => {
    expect(transform("hello_world")).toBe("helloWorld");
    expect(transform("my_variable_name")).toBe("myVariableName");
  });

  it("converts kebab-case to camelCase", () => {
    expect(transform("hello-world")).toBe("helloWorld");
    expect(transform("my-component-name")).toBe("myComponentName");
  });

  it("converts spaces to camelCase", () => {
    expect(transform("hello world")).toBe("helloWorld");
  });

  it("handles multiple separators", () => {
    expect(transform("hello__world")).toBe("helloWorld");
    expect(transform("hello--world")).toBe("helloWorld");
  });

  it("handles mixed separators", () => {
    expect(transform("hello_world-test")).toBe("helloWorldTest");
  });

  it("lowercases first", () => {
    expect(transform("HELLO_WORLD")).toBe("helloWorld");
  });

  it("handles empty string", () => {
    expect(transform("")).toBe("");
  });
});
