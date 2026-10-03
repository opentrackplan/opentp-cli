import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CliConfigError,
  checkCliConfig,
  cliPluginDirectories,
  findCliConfigFile,
  getSeverities,
  loadCliConfig,
  mcpToolGroups,
  pluginsAllowed,
  readCliConfig,
} from "./index";
import {
  buildCliConfigJsonSchema,
  CLI_CONFIG_SCHEMA_FILE,
  CLI_CONFIG_SCHEMA_ID,
  DRAFT_07,
} from "./json-schema";

const dirs: string[] = [];

function tempDir(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opentp-cliconfig-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** The lines of the CliConfigError thrown by `run` */
function errorLines(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof CliConfigError) return error.lines;
    throw error;
  }
  throw new Error("expected a CliConfigError");
}

const FULL = `# yaml-language-server: $schema=https://opentp.dev/schemas/cli/opentp.cli.schema.json
opentp: 2026-09
cli: ">=0.10 <0.11"
keygen:
  template: "{area | slug}::{event | slug}"
  transforms: { slug: [lower, trim, { replace: { from: " ", to: "_" } }, { truncate: 160 }] }
  plugins: [./transforms]
checks:
  plugins: [./checks]
  bindings:
    ticket-exists:
      webhook: { url: "https://checks.example.com/ticket", method: POST, headers: { Authorization: "Bearer \${TICKETS_TOKEN}" } }
    usr-prefix:
      rule: starts-with
      params: usr_
  severity: { overlap: warning, unknownCheck: error }
tracker: { type: snowplow }
generate:
  plugins: [./generators]
  run:
    - { generator: json, output: dist/plan.json }
    - { generator: template, file: templates/events.md.hbs, output: docs/events.md, target: web, events: { area: auth } }
mcp:
  tools: [describe, search, validate, generate]
  write: false
x-acme-team: analytics
`;

describe("findCliConfigFile", () => {
  it("finds opentp.cli.yaml or opentp.cli.yml in the root; none is fine", () => {
    expect(findCliConfigFile(tempDir())).toBeNull();
    const yaml = tempDir({ "opentp.cli.yaml": "opentp: 2026-09\n" });
    expect(findCliConfigFile(yaml)).toBe(path.join(yaml, "opentp.cli.yaml"));
    const yml = tempDir({ "opentp.cli.yml": "opentp: 2026-09\n" });
    expect(findCliConfigFile(yml)).toBe(path.join(yml, "opentp.cli.yml"));
  });

  it("does not look in parent directories", () => {
    const parent = tempDir({ "opentp.cli.yaml": "opentp: 2026-09\n", "plan/x.txt": "" });
    expect(findCliConfigFile(path.join(parent, "plan"))).toBeNull();
  });

  it("rejects both files, and a missing --cli-config file (resolved against cwd)", () => {
    const both = tempDir({ "opentp.cli.yaml": "", "opentp.cli.yml": "" });
    expect(errorLines(() => findCliConfigFile(both))).toEqual([
      `Both opentp.cli.yaml and opentp.cli.yml exist in ${both}; keep one`,
    ]);
    const cwd = tempDir({ "ci/cli.yaml": "opentp: 2026-09\n" });
    expect(findCliConfigFile(both, "ci/cli.yaml", cwd)).toBe(path.join(cwd, "ci/cli.yaml"));
    expect(errorLines(() => findCliConfigFile(both, "ci/nope.yaml", cwd))).toEqual([
      `--cli-config: file not found: ${path.join(cwd, "ci/nope.yaml")}`,
    ]);
  });
});

describe("readCliConfig", () => {
  it("accepts every section of the documented example", () => {
    const dir = tempDir({ "opentp.cli.yaml": FULL });
    const config = readCliConfig(path.join(dir, "opentp.cli.yaml"));
    expect(config.opentp).toBe("2026-09");
    expect(config.checks?.bindings?.["usr-prefix"]).toEqual({
      rule: "starts-with",
      params: "usr_",
    });
    expect(config.generate?.run?.[1]).toMatchObject({ target: "web", events: { area: "auth" } });
    expect(config["x-acme-team"]).toBe("analytics");
  });

  it.each([
    [
      "opentp: 2026-09\nkeygens: {}\n",
      ["keygens: Unknown key 'keygens' (extensions start with 'x-')"],
    ],
    ["opentp: 2026-09\nsearch: {}\n", ["search: 'search' is not supported yet"]],
    ["cli: '>=0.10'\n", ["opentp: Invalid input: expected string, received undefined"]],
    ["opentp: '2026'\n", ["opentp: Expected an OpenTrackPlan version YYYY-MM"]],
    [
      "opentp: 2026-09\nkeygen: { transforms: {} }\n",
      ["keygen.template: Invalid input: expected string, received undefined"],
    ],
    [
      "opentp: 2026-09\nmcp: { tools: [describe, write] }\n",
      ['mcp.tools[1]: Invalid option: expected one of "describe"|"search"|"validate"|"generate"'],
    ],
    [
      "opentp: 2026-09\nmcp: { tools: [] }\n",
      [
        "mcp.tools: List at least one tool group (describe, search, validate, generate), or leave out mcp.tools to serve all",
      ],
    ],
    ["opentp: 2026-09\nmcp: { write: true }\n", ["mcp.write: write tools are not supported yet"]],
    ["opentp: 2026-09\nmcp: { write: 'no' }\n", ["mcp.write: Invalid input: expected false"]],
    [
      "opentp: 2026-09\nchecks: { severity: { overlap: loud } }\n",
      ['checks.severity.overlap: Invalid option: expected one of "off"|"warning"|"error"'],
    ],
    [
      "opentp: 2026-09\nchecks: { bindings: { 1st: { rule: pattern } } }\n",
      [
        "checks.bindings.1st: Invalid check id: it must start with a letter and contain only letters, digits, '_', '.' or '-'",
      ],
    ],
    [
      "opentp: 2026-09\ngenerate: { run: [{ output: x.json }] }\n",
      ["generate.run[0].generator: Invalid input: expected string, received undefined"],
    ],
    ["- a list\n", null],
  ])("reports shape errors as opentp.cli.yaml lines: %j", (content, expected) => {
    const dir = tempDir({ "opentp.cli.yaml": content });
    const lines = errorLines(() => readCliConfig(path.join(dir, "opentp.cli.yaml")));
    if (expected === null) {
      expect(lines).toEqual(["opentp.cli.yaml: expected a mapping with 'opentp'"]);
      return;
    }
    expect(lines).toEqual(expected.map((line) => `opentp.cli.yaml: ${line}`));
  });

  it("reports YAML syntax errors with their position", () => {
    const dir = tempDir({ "opentp.cli.yaml": "opentp: 2026-09\nkeygen: [\n" });
    const [line] = errorLines(() => readCliConfig(path.join(dir, "opentp.cli.yaml")));
    expect(line).toMatch(/^opentp\.cli\.yaml: Invalid YAML at line \d+, column \d+: /);
  });
});

describe("checkCliConfig", () => {
  it("compares opentp with the plan and the running version with cli", () => {
    expect(() =>
      checkCliConfig(
        { opentp: "2026-09", cli: ">=0.10 <0.11" },
        {
          planVersion: "2026-09",
          version: "0.10.3",
        },
      ),
    ).not.toThrow();
    // Pre-releases satisfy a range (includePrerelease)
    expect(() =>
      checkCliConfig({ opentp: "2026-09", cli: ">=0.10 <0.11" }, { version: "0.10.0-rc.1" }),
    ).not.toThrow();
    expect(
      errorLines(() =>
        checkCliConfig(
          { opentp: "2026-08", cli: "^0.11" },
          { planVersion: "2026-09", version: "0.10.0" },
        ),
      ),
    ).toEqual([
      "opentp.cli.yaml: opentp: '2026-08' does not match the plan's opentp '2026-09' (opentp.yaml)",
      "opentp.cli.yaml: cli: this plan needs opentp ^0.11, but this is opentp 0.10.0 (install a matching version, e.g. with OPENTP_VERSION)",
    ]);
    // Without a loaded plan the header is not compared
    expect(() => checkCliConfig({ opentp: "2026-08" })).not.toThrow();
  });
});

describe("loadCliConfig", () => {
  it("returns null without a file and the loaded file with its directory", () => {
    expect(loadCliConfig(tempDir())).toBeNull();
    const dir = tempDir({ "opentp.cli.yaml": FULL });
    const cli = loadCliConfig(dir, { planVersion: "2026-09" });
    expect(cli?.dir).toBe(dir);
    expect(cliPluginDirectories(cli, ["keygen", "generate"])).toEqual([
      { section: "keygen", written: "./transforms", resolved: path.join(dir, "transforms") },
      { section: "generate", written: "./generators", resolved: path.join(dir, "generators") },
    ]);
    expect([...mcpToolGroups(cli)]).toEqual(["describe", "search", "validate", "generate"]);
    expect([...mcpToolGroups(null)]).toEqual(["describe", "search", "validate", "generate"]);
  });
});

describe("severities and plugin consent", () => {
  it("--fail-on > checks.severity > defaults", () => {
    const dir = tempDir({ "opentp.cli.yaml": FULL });
    const cli = loadCliConfig(dir);
    expect(getSeverities(null)).toEqual({ overlap: "warning", unknownCheck: "warning" });
    expect(getSeverities(cli)).toEqual({ overlap: "warning", unknownCheck: "error" });
    expect(getSeverities(cli, ["overlap"])).toEqual({ overlap: "error", unknownCheck: "error" });
  });

  it("allows plugins only with the flag or OPENTP_ALLOW_PLUGINS=1", () => {
    expect(pluginsAllowed(false, {})).toBe(false);
    expect(pluginsAllowed(true, {})).toBe(true);
    expect(pluginsAllowed(false, { OPENTP_ALLOW_PLUGINS: "1" })).toBe(true);
    expect(pluginsAllowed(false, { OPENTP_ALLOW_PLUGINS: "true" })).toBe(false);
  });
});

describe("schemas/opentp.cli.schema.json", () => {
  const generated = buildCliConfigJsonSchema();

  it("is up to date (run npm run schema after changing src/cliconfig/schema.ts)", () => {
    const committed = JSON.parse(fs.readFileSync(path.resolve(CLI_CONFIG_SCHEMA_FILE), "utf-8"));
    expect(committed).toEqual(generated);
  });

  it("is a draft-07 schema with the published $id and a closed root that allows x-*", () => {
    expect(generated.$schema).toBe(DRAFT_07);
    expect(generated.$id).toBe(CLI_CONFIG_SCHEMA_ID);
    expect(generated.additionalProperties).toBe(false);
    expect(generated.patternProperties).toEqual({ "^x-": {} });
    // opentp uses the version pattern, not a const
    const opentp = (generated.properties as Record<string, Record<string, unknown>>).opentp;
    expect(opentp.pattern).toBe("^[0-9]{4}-(0[1-9]|1[0-2])$");
    expect(opentp.const).toBeUndefined();
  });

  it("says what the CLI enforces for mcp: at least one tool group, write only false", () => {
    const mcp = (generated.properties as Record<string, Record<string, any>>).mcp;
    expect(mcp.properties.tools.minItems).toBe(1);
    const write = mcp.properties.write;
    expect(write.const ?? write.enum?.[0]).toBe(false);
    expect(write.enum === undefined || write.enum.length === 1).toBe(true);
  });

  it("closes every nested object schema", () => {
    const open: string[] = [];
    const visit = (node: unknown, where: string): void => {
      if (Array.isArray(node)) {
        node.forEach((item, index) => {
          visit(item, `${where}[${index}]`);
        });
        return;
      }
      if (typeof node !== "object" || node === null) return;
      const schema = node as Record<string, unknown>;
      if (schema.properties !== undefined && schema.additionalProperties !== false) {
        open.push(where);
      }
      for (const [key, child] of Object.entries(schema)) visit(child, `${where}.${key}`);
    };
    visit(generated, "#");
    expect(open).toEqual([]);
  });
});
