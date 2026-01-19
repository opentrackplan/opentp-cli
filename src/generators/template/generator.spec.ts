import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GeneratorContext } from "../types";
import { templateGenerator } from "./index";

const mockContext: GeneratorContext = {
  config: {
    opentp: "2025-12",
    info: {
      title: "Test App",
      version: "1.0.0",
    },
    spec: {
      events: {
        key: { pattern: "{app}::{name}" },
        paths: {},
        taxonomy: {},
        payload: { targets: { all: [] }, schema: {} },
      },
    },
  },
  events: [
    {
      filePath: "/test/events/app/login.yaml",
      relativePath: "app/login.yaml",
      key: "app::login",
      expectedKey: "app::login",
      taxonomy: { app: "myapp", name: "login" },
      lifecycle: { status: "active" },
      ignore: [],
      payload: { targets: {} },
    },
    {
      filePath: "/test/events/app/logout.yaml",
      relativePath: "app/logout.yaml",
      key: "app::logout",
      expectedKey: "app::logout",
      taxonomy: { app: "myapp", name: "logout" },
      ignore: [],
      payload: { targets: {} },
    },
  ],
  dictionaries: new Map([["actions", ["click", "view", "submit"]]]),
  options: {},
};

let tempDir: string;

describe("template generator", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opentp-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should have correct name", () => {
    expect(templateGenerator.name).toBe("template");
  });

  it("should throw error when --file is not specified", () => {
    expect(() => templateGenerator.generate(mockContext)).toThrow("--file option");
  });

  it("should throw error when template file not found", () => {
    expect(() =>
      templateGenerator.generate({
        ...mockContext,
        options: { file: "/nonexistent/template.hbs" },
      }),
    ).toThrow("Template file not found");
  });

  it("should render simple variable interpolation", () => {
    const templatePath = path.join(tempDir, "template.txt");
    fs.writeFileSync(templatePath, "Title: {{info.title}}");

    const result = templateGenerator.generate({
      ...mockContext,
      options: { file: templatePath },
    });

    expect(result.stdout).toBe("Title: Test App");
  });

  it("should render {{#each}} loops", () => {
    const templatePath = path.join(tempDir, "template.txt");
    fs.writeFileSync(templatePath, "{{#each events}}{{key}}\n{{/each}}");

    const result = templateGenerator.generate({
      ...mockContext,
      options: { file: templatePath },
    });

    expect(result.stdout).toContain("app::login");
    expect(result.stdout).toContain("app::logout");
  });

  it("should render {{#if}} conditionals", () => {
    const templatePath = path.join(tempDir, "template.txt");
    fs.writeFileSync(
      templatePath,
      "{{#each events}}{{key}}{{#if lifecycle}} ({{lifecycle.status}}){{/if}}\n{{/each}}",
    );

    const result = templateGenerator.generate({
      ...mockContext,
      options: { file: templatePath },
    });

    expect(result.stdout).toContain("app::login (active)");
    expect(result.stdout).toContain("app::logout");
    expect(result.stdout).not.toContain("app::logout (");
  });

  it("should render @index in loops", () => {
    const templatePath = path.join(tempDir, "template.txt");
    fs.writeFileSync(templatePath, "{{#each events}}{{@index}}: {{key}}\n{{/each}}");

    const result = templateGenerator.generate({
      ...mockContext,
      options: { file: templatePath },
    });

    expect(result.stdout).toContain("0: app::login");
    expect(result.stdout).toContain("1: app::logout");
  });

  it("should output to file when --output is specified", () => {
    const templatePath = path.join(tempDir, "template.txt");
    const outputPath = path.join(tempDir, "output.txt");
    fs.writeFileSync(templatePath, "Events: {{events.length}}");

    const result = templateGenerator.generate({
      ...mockContext,
      options: { file: templatePath, output: outputPath },
    });

    expect(result.stdout).toBeUndefined();
    expect(result.files).toHaveLength(1);
    expect(result.files![0].path).toBe(outputPath);
  });

  it("should render markdown template", () => {
    const templatePath = path.join(tempDir, "events.md");
    fs.writeFileSync(
      templatePath,
      `# {{info.title}}

## Events

{{#each events}}
### {{key}}

- Status: {{lifecycle.status}}
- App: {{taxonomy.app}}
{{/each}}
`,
    );

    const result = templateGenerator.generate({
      ...mockContext,
      options: { file: templatePath },
    });

    expect(result.stdout).toContain("# Test App");
    expect(result.stdout).toContain("### app::login");
    expect(result.stdout).toContain("- Status: active");
  });
});
