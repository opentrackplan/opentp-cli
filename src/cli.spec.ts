import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, main, parseCliArgs, UsageError } from "./cli";
import { setLogLevel } from "./util/logger";

// Importing ./cli does not run the CLI: under vitest require.main is undefined (see the bootstrap
// guard at the end of cli.ts), whatever the checkout path is

const fixture = (name: string) => path.join(process.cwd(), "tests", "data", name);

it("does not start the CLI when ./cli is imported", () => {
  // The bootstrap would run main() on the worker's argv and set process.exitCode
  expect(process.exitCode).toBeUndefined();
});

describe("parseCliArgs", () => {
  const env = { OPENTP_ROOT: "/plan" };

  it("defaults to validate in $OPENTP_ROOT, else the current directory", () => {
    expect(parseCliArgs([], env)).toMatchObject({ command: "validate", root: "/plan", fix: false });
    expect(parseCliArgs([], {}).root).toBe(process.cwd());
  });

  it("parses every documented flag and short form", () => {
    expect(
      parseCliArgs(
        [
          "-r",
          "./a",
          "-v",
          "validate",
          "--json",
          "--external-rules",
          "r1",
          "--external-rules=r2",
          "--external-transforms",
          "t1",
        ],
        env,
      ),
    ).toMatchObject({
      command: "validate",
      root: "./a",
      verbose: true,
      json: true,
      externalRules: ["r1", "r2"],
      externalTransforms: ["t1"],
    });
    expect(parseCliArgs(["--root=./b", "-f"], env)).toMatchObject({ root: "./b", fix: true });
    expect(parseCliArgs(["fix", "--json"], env)).toMatchObject({ command: "fix", fix: true });
  });

  it("accepts the generator name in any position", () => {
    for (const args of [
      ["generate", "json", "-o", "x.json"],
      ["generate", "-o", "x.json", "json"],
      ["-o", "x.json", "generate", "json"],
      ["generate", "--output=x.json", "json"],
    ]) {
      expect(parseCliArgs(args, env)).toMatchObject({
        command: "generate",
        generatorName: "json",
        generatorOptions: { output: "x.json" },
      });
    }
    expect(
      parseCliArgs(
        [
          "generate",
          "template",
          "--file",
          "t.hbs",
          "--external-generators",
          "g",
          "--external-transforms=t",
        ],
        env,
      ),
    ).toMatchObject({
      generatorName: "template",
      generatorOptions: { file: "t.hbs" },
      externalGenerators: ["g"],
      externalTransforms: ["t"],
    });
  });

  it("lets the last of --pretty / --no-pretty win", () => {
    const pretty = (args: string[]) =>
      parseCliArgs(["generate", "json", ...args], env).generatorOptions.pretty;
    expect(pretty([])).toBeUndefined();
    expect(pretty(["--no-pretty"])).toBe(false);
    expect(pretty(["--no-pretty", "--pretty"])).toBe(true);
    expect(pretty(["--pretty", "--no-pretty"])).toBe(false);
  });

  it("parses --cli-config (every command), --allow-plugins and --fail-on", () => {
    expect(
      parseCliArgs(
        ["--cli-config", "ci/opentp.cli.yaml", "--allow-plugins", "--fail-on", "overlap"],
        env,
      ),
    ).toMatchObject({
      command: "validate",
      cliConfig: "ci/opentp.cli.yaml",
      allowPlugins: true,
      failOn: ["overlap"],
    });
    // Comma-separated and repeatable, without duplicates
    expect(
      parseCliArgs(["fix", "--fail-on=unknownCheck,overlap", "--fail-on", "overlap"], env).failOn,
    ).toEqual(["unknownCheck", "overlap"]);
    expect(
      parseCliArgs(["mcp", "--fail-on", "unknownCheck", "--allow-plugins"], env),
    ).toMatchObject({ command: "mcp", failOn: ["unknownCheck"], allowPlugins: true });
    expect(
      parseCliArgs(["generate", "json", "--cli-config=x.yml", "--allow-plugins"], env),
    ).toMatchObject({ cliConfig: "x.yml", allowPlugins: true });
    expect(parseCliArgs([], env)).toMatchObject({ allowPlugins: false, failOn: [] });
  });

  it("parses generate without a name (generate.run entries)", () => {
    const options = parseCliArgs(["generate"], env);
    expect(options).toMatchObject({ command: "generate", generatorOptions: {} });
    expect(options.generatorName).toBeUndefined();
    expect(parseCliArgs(["generate", "--allow-plugins"], env).generatorName).toBeUndefined();
  });

  it("parses mcp with its plugin options", () => {
    expect(
      parseCliArgs(
        ["mcp", "-r", "./plan", "--external-rules", "r", "--external-transforms", "t"],
        env,
      ),
    ).toMatchObject({
      command: "mcp",
      root: "./plan",
      externalRules: ["r"],
      externalTransforms: ["t"],
    });
    expect(parseCliArgs(["mcp", "--help"], env).command).toBe("help");
  });

  it("maps help and version (commands and flags)", () => {
    expect(parseCliArgs(["help"], env).command).toBe("help");
    expect(parseCliArgs(["validate", "-h"], env).command).toBe("help");
    expect(parseCliArgs(["generate", "--help"], env).command).toBe("help");
    expect(parseCliArgs(["version"], env).command).toBe("version");
    expect(parseCliArgs(["-V"], env).command).toBe("version");
    expect(parseCliArgs(["--version"], env).command).toBe("version");
    // help and version accept every known flag
    expect(parseCliArgs(["help", "--root", "x", "-v"], env).command).toBe("help");
    // The flags win over the command, its options and its arguments
    expect(parseCliArgs(["validate", "extra", "--help"], env).command).toBe("help");
    expect(parseCliArgs(["generate", "json", "--version"], env).command).toBe("version");
    expect(parseCliArgs(["help", "extra", "--help"], env).command).toBe("help");
  });

  it.each([
    [["valdiate"], "Unknown command 'valdiate'"],
    [["valdiate", "--help"], "Unknown command 'valdiate'"],
    [["export"], "Unknown command 'export'"],
    [["--bogus"], "Unknown option '--bogus'"],
    [["-x"], "Unknown option '-x'"],
    [["--root"], "Option '-r, --root <value>' argument missing"],
    [["--root", "--json"], "Option '--root' argument is ambiguous"],
    [["--root="], "Option '--root' needs a non-empty value"],
    [["--json=yes"], "Option '--json' does not take an argument"],
    [["validate", "--output", "x"], "Option '--output' cannot be used with 'validate'"],
    [["fix", "-o", "x"], "Option '-o' cannot be used with 'fix'"],
    [["generate", "json", "--json"], "Option '--json' cannot be used with 'generate'"],
    [["generate", "json", "--fix"], "Option '--fix' cannot be used with 'generate'"],
    [["generate", "json", "--external-rules", "r"], "Option '--external-rules' cannot be used"],
    [["validate", "--external-generators", "g"], "Option '--external-generators' cannot be used"],
    [["generate", "-o", "x.json"], "Option '-o' needs a generator name"],
    [["generate", "--no-pretty"], "Option '--no-pretty' needs a generator name"],
    [["generate", "--file=t.hbs"], "Option '--file' needs a generator name"],
    [
      ["--fail-on", "overlap,bogus"],
      "Unknown --fail-on id 'bogus'. Expected one of: overlap, unknownCheck",
    ],
    [["--fail-on="], "Option '--fail-on' needs a non-empty value"],
    [
      ["generate", "json", "--fail-on", "overlap"],
      "Option '--fail-on' cannot be used with 'generate'",
    ],
    [["generate", "json", "--external-rules", "r"], "Option '--external-rules' cannot be used"],
    [["generate", "json", "yaml"], "Unexpected argument 'yaml'"],
    [["validate", "extra"], "Unexpected argument 'extra'"],
    [["help", "validate"], "Unexpected argument 'validate'"],
    [["version", "foo"], "Unexpected argument 'foo'"],
    [["mcp", "--json"], "Option '--json' cannot be used with 'mcp'"],
    [["mcp", "-o", "x"], "Option '-o' cannot be used with 'mcp'"],
    [["mcp", "stdio"], "Unexpected argument 'stdio'"],
  ])("rejects %j", (args, message) => {
    expect(() => parseCliArgs(args, env)).toThrow(UsageError);
    expect(() => parseCliArgs(args, env)).toThrow(message);
  });
});

describe("main", () => {
  let tmpRoot: string;
  let stdout: string[];
  let stderr: string[];
  const savedLogLevel = process.env.OPENTP_LOG_LEVEL;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opentp-cli-"));
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    stdout = [];
    stderr = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      stdout.push(args.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args) => {
      stderr.push(args.join(" "));
    });
    vi.spyOn(console, "warn").mockImplementation((...args) => {
      stderr.push(args.join(" "));
    });
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setLogLevel("info");
    if (savedLogLevel === undefined) delete process.env.OPENTP_LOG_LEVEL;
    else process.env.OPENTP_LOG_LEVEL = savedLogLevel;
  });

  /** A copy of coverage-valid whose opentp.yaml is changed by `edit` */
  function planCopy(name: string, edit: (config: Record<string, any>) => void): string {
    const root = path.join(tmpRoot, name);
    fs.cpSync(fixture("coverage-valid"), root, { recursive: true });
    editYaml(path.join(root, "opentp.yaml"), edit);
    return root;
  }

  /** A copy of coverage-valid whose opentp.cli.yaml is changed by `edit` */
  function cliCopy(name: string, edit: (cli: Record<string, any>) => void): string {
    const root = path.join(tmpRoot, name);
    fs.cpSync(fixture("coverage-valid"), root, { recursive: true });
    editYaml(path.join(root, "opentp.cli.yaml"), edit);
    return root;
  }

  function editYaml(file: string, edit: (document: Record<string, any>) => void): void {
    const document = parse(fs.readFileSync(file, "utf-8"));
    edit(document);
    fs.writeFileSync(file, stringify(document));
  }

  it("exits 2 with the usage on stderr for an unknown command", async () => {
    expect(await main(["valdiate"])).toBe(EXIT_USAGE);
    expect(stdout).toEqual([]);
    expect(stderr[0]).toBe("✗ Unknown command 'valdiate'");
    expect(stderr.join("\n")).toContain("Usage: opentp [validate | fix | generate [<name>]");
  });

  it("prints help and version on stdout with exit 0", async () => {
    expect(await main(["--help"])).toBe(EXIT_OK);
    expect(stdout.join("\n")).toContain("Exit codes:");
    stdout.length = 0;
    expect(await main(["-V"])).toBe(EXIT_OK);
    expect(stdout[0]).toMatch(/^opentp v\d+\.\d+\.\d+ \(spec \d{4}-\d{2}\)$/);
    expect(stderr).toEqual([]);
  });

  it("exits 2 for an argument after help or version", async () => {
    expect(await main(["version", "foo"])).toBe(EXIT_USAGE);
    expect(await main(["help", "foo"])).toBe(EXIT_USAGE);
    expect(stdout).toEqual([]);
    expect(stderr[0]).toBe("✗ Unexpected argument 'foo'");
  });

  it("validates: 0 for a valid plan, 1 with errors; the report on stdout, logs on stderr", async () => {
    expect(await main(["validate", "--root", fixture("coverage-valid")])).toBe(EXIT_OK);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual(["✓ All events are valid count=4"]);

    stderr.length = 0;
    expect(await main(["--root", fixture("coverage-invalid")])).toBe(EXIT_FAILURE);
    const report = stdout.join("\n");
    expect(report).toContain("[opentp.yaml]");
    // Warnings follow the errors on stdout
    expect(report).toContain(
      "  ⚠ spec.checks.ends-with: spec.checks.ends-with shadows the tool check 'ends-with'",
    );
    expect(report.indexOf("⚠")).toBeGreaterThan(report.lastIndexOf("✗"));
    expect(stderr.at(-1)).toMatch(
      /^✗ Validation failed errorCount=\d+ warningCount=[1-9]\d* eventCount=36$/,
    );
  });

  it("prints only the JSON document on stdout with --json, also with -v", async () => {
    const args = ["--json", "-v", "--root", fixture("coverage-invalid")];
    expect(await main(args)).toBe(EXIT_FAILURE);
    expect(stdout).toHaveLength(1);
    const result = JSON.parse(stdout[0]);
    expect(result).toMatchObject({ success: false, events: 36 });
    expect(result.errors.length).toBeGreaterThan(0);
    // Warnings are listed apart
    expect(result.warnings).toContainEqual({
      event: "opentp.yaml",
      path: "spec.events.taxonomy.custom_id.checks.unknown-check",
      message:
        "Unknown check 'unknown-check': not in spec.checks, not a built-in or plugin check, not bound in opentp.cli.yaml",
      severity: "warning",
      rule: "unknownCheck",
    });
    expect(result.errors.every((error: { severity: string }) => error.severity === "error")).toBe(
      true,
    );
    // Debug logs went to stderr
    expect(stderr.some((line) => line.startsWith("⋯ Loading config"))).toBe(true);
  });

  it("exits 2 when opentp.yaml is missing or cannot be loaded", async () => {
    expect(await main(["--root", tmpRoot])).toBe(EXIT_USAGE);
    expect(stderr[0]).toMatch(/^✗ opentp\.yaml not found root=/);

    stderr.length = 0;
    const oldVersion = planCopy("old-version", (config) => {
      config.opentp = "2025-12";
    });
    expect(await main(["--json", "--root", oldVersion])).toBe(EXIT_USAGE);
    expect(stdout).toEqual([]);
    expect(stderr[0]).toContain("Unsupported OpenTrackPlan schema version '2025-12'");
  });

  it("exits 2 for mcp when the plan cannot be loaded, before serving anything", async () => {
    expect(await main(["mcp", "--root", tmpRoot])).toBe(EXIT_USAGE);
    expect(stdout).toEqual([]);
    expect(stderr[0]).toMatch(/^✗ opentp\.yaml not found root=/);
  });

  it("exits 2 for fix without keygen", async () => {
    const noKeygen = cliCopy("no-keygen", (cli) => {
      delete cli.keygen;
    });
    expect(await main(["fix", "--root", noKeygen])).toBe(EXIT_USAGE);
    expect(stderr[0]).toContain("fix needs keygen in opentp.cli.yaml");
    stderr.length = 0;
    // Without opentp.cli.yaml at all
    fs.rmSync(path.join(noKeygen, "opentp.cli.yaml"));
    expect(await main(["fix", "--root", noKeygen])).toBe(EXIT_USAGE);
    expect(stderr[0]).toContain("fix needs keygen in opentp.cli.yaml");
  });

  it("reports an unknown keygen step once against opentp.cli.yaml (exit 1)", async () => {
    const root = cliCopy("unknown-step", (cli) => {
      cli.keygen.transforms.slug.push("to-pascal-case");
    });
    expect(await main(["--json", "--root", root])).toBe(EXIT_FAILURE);
    const { errors } = JSON.parse(stdout[0]);
    expect(errors).toEqual([
      {
        event: "opentp.cli.yaml",
        path: expect.stringMatching(/^keygen\.transforms\.slug\[\d+\]$/),
        message:
          "Unknown transform step 'to-pascal-case' (custom steps: keygen.plugins in opentp.cli.yaml, or --external-transforms)",
        severity: "error",
      },
    ]);
  });

  it("exits 2 for an invalid OPENTP_LOG_LEVEL, except for help", async () => {
    process.env.OPENTP_LOG_LEVEL = "foo";
    expect(await main(["--root", fixture("coverage-valid")])).toBe(EXIT_USAGE);
    expect(stderr[0]).toBe(
      "✗ Invalid OPENTP_LOG_LEVEL 'foo'. Expected one of: trace, debug, info, warn, error, fatal",
    );
    expect(await main(["help"])).toBe(EXIT_OK);
  });

  it("exits 2 for a missing --external-* directory", async () => {
    expect(await main(["--external-rules", "./no-such-dir"])).toBe(EXIT_USAGE);
    expect(stderr[0]).toBe(
      `✗ --external-rules: directory not found: ${path.resolve("no-such-dir")}`,
    );
  });

  it("loads external rules from a relative directory", async () => {
    const root = fixture("coverage-invalid");
    const rulesDir = path.relative(process.cwd(), path.join(root, "external-rules"));
    expect(await main(["--json", "--root", root, "--external-rules", rulesDir])).toBe(EXIT_FAILURE);
    const messages: string[] = JSON.parse(stdout[0]).errors.map(
      (e: { message: string }) => e.message,
    );
    expect(messages.some((m) => m.startsWith("check throwing-check failed:"))).toBe(true);
    expect(messages).not.toContain("Unknown check: throwing-check");
  });

  it("generates: stdout and --output get the same bytes", async () => {
    const root = fixture("coverage-valid");
    expect(await main(["generate", "json", "--root", root])).toBe(EXIT_OK);
    expect(stdout).toHaveLength(1);
    const piped = stdout[0];
    const output = path.join(tmpRoot, "out", "events.json");
    stdout.length = 0;
    expect(await main(["generate", "-o", output, "json", "--root", root])).toBe(EXIT_OK);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([`Generated file=${JSON.stringify(output)}`]);
    const written = fs.readFileSync(output, "utf-8");
    expect(written).toBe(piped);
    // Events in file path order, whatever the directory listing order is
    expect(JSON.parse(written).events.map((event: { key: string }) => event.key)).toEqual([
      "auth::ignored_application_id_dict::view::legacy_app::p2::internal-false",
      "auth::login_button_click::click::login_button::p2::internal-false",
      "auth::login_experiment::experiment::login::p3::internal-false",
      "onboarding::onboarding_step_complete::complete::onboarding_step::p1::internal-true",
    ]);
  });

  it("refuses to generate from a plan that cannot be loaded: exit 1, empty stdout, no file", async () => {
    const root = fixture("coverage-invalid");
    expect(await main(["generate", "json", "--root", root])).toBe(EXIT_FAILURE);
    expect(stdout).toEqual([]);
    // The load problems and the summary go to stderr
    expect(stderr.join("\n")).toContain("[opentp.yaml]");
    expect(stderr.at(-1)).toMatch(
      /^✗ Generation aborted: the tracking plan could not be loaded \(run 'opentp validate'\) errorCount=\d+ eventCount=36$/,
    );

    stderr.length = 0;
    const output = path.join(tmpRoot, "refused", "events.json");
    expect(await main(["generate", "json", "--root", root, "-o", output])).toBe(EXIT_FAILURE);
    expect(stdout).toEqual([]);
    expect(stderr.at(-1)).toContain("Generation aborted");
    expect(fs.existsSync(output)).toBe(false);
  });

  /** Gives login_button_click.yaml in `root` a wrong key; returns the file path and the new content */
  function breakEventKey(root: string): { file: string; broken: string } {
    const file = path.join(root, "events", "auth", "2", "false", "login_button_click.yaml");
    const broken = fs.readFileSync(file, "utf-8").replace(/^ {2}key: .*$/m, "  key: wrong_key");
    expect(broken).toContain("  key: wrong_key");
    fs.writeFileSync(file, broken);
    return { file, broken };
  }

  it("fix rewrites the keys of a plan without configuration errors", async () => {
    const root = planCopy("fix-ok", () => {});
    const { file } = breakEventKey(root);
    expect(await main(["fix", "--root", root])).toBe(EXIT_OK);
    expect(fs.readFileSync(file, "utf-8")).toContain(
      "key: auth::login_button_click::click::login_button::p2::internal-false",
    );
    expect(stderr).toContain("Events fixed count=1");
  });

  it("fix changes only event.key: comments, blank lines, quoting and key order stay", async () => {
    const root = planCopy("fix-keeps-text", () => {});
    const { file, broken } = breakEventKey(root);
    const commented = `# yaml-language-server: $schema=https://opentp.dev/schemas/2026-09/event.schema.json\n${broken.replace(
      "  key: wrong_key",
      "  key: wrong_key # rewritten by fix",
    )}`;
    fs.writeFileSync(file, commented);
    expect(await main(["fix", "--root", root])).toBe(EXIT_OK);
    expect(fs.readFileSync(file, "utf-8")).toBe(
      commented.replace(
        "  key: wrong_key #",
        "  key: auth::login_button_click::click::login_button::p2::internal-false #",
      ),
    );
  });

  it("fix keeps versions keyed '2' before '1' in file order, so the overlap direction stays", async () => {
    const root = path.join(tmpRoot, "fix-version-order");
    const write = (file: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
    };
    write(
      "opentp.yaml",
      [
        "opentp: 2026-09",
        "info: { title: Versions, version: 1.0.0 }",
        "spec:",
        "  paths:",
        "    events: { root: /events, template: '{area}/{event}.yaml' }",
        "  events:",
        "    taxonomy:",
        "      area: { title: Area, type: string }",
        "      event: { title: Event, type: string }",
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
    write("opentp.cli.yaml", 'opentp: 2026-09\nkeygen:\n  template: "{area}::{event}"\n');
    const eventA = [
      "opentp: 2026-09",
      "event:",
      "  key: a::wrong",
      "  taxonomy: {}",
      "  payload:",
      '    current: "2"',
      "    # The newer, broader version comes first",
      '    "2":',
      "      schema: { event_category: { value: c }, event_name: { value: x } }",
      "",
      '    "1":',
      "      meta: { deprecated: { reason: Old builds } }",
      "      schema:",
      "        event_category: { value: c }",
      "        event_name: { value: x }",
      "        screen: { value: home }",
      "        auth_method: { value: email }",
      "",
    ].join("\n");
    write("events/a/a.yaml", eventA);
    write(
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
    const overlap = {
      event: "a/a.yaml",
      path: "payload",
      message:
        "Overlaps with event 'a::b' (a/b.yaml) on web, ios: every hit of 'a::b' also matches 'a::a'",
      severity: "warning",
      rule: "overlap",
    };

    expect(await main(["fix", "--json", "--root", root])).toBe(EXIT_OK);
    expect(JSON.parse(stdout.join("")).warnings).toEqual([overlap]);
    expect(fs.readFileSync(path.join(root, "events/a/a.yaml"), "utf-8")).toBe(
      eventA.replace("key: a::wrong", "key: a::a"),
    );

    // The next validate reads the fixed file and reports the same direction
    stdout = [];
    expect(await main(["validate", "--json", "--root", root])).toBe(EXIT_OK);
    expect(JSON.parse(stdout.join("")).warnings).toEqual([overlap]);
  });

  it("fix skips a file whose key cannot be changed alone, with a warning (exit 1)", async () => {
    const root = planCopy("fix-skips-anchor", () => {});
    const { file, broken } = breakEventKey(root);
    // An alias repeats the key: changing the anchored scalar would change the alias too
    const anchored = broken
      .replace("  key: wrong_key", "  key: &key wrong_key")
      .replace("  lifecycle:", "  x-acme-previous-key: *key\n\n  lifecycle:");
    fs.writeFileSync(file, anchored);
    expect(await main(["fix", "--root", root])).toBe(EXIT_FAILURE);
    expect(fs.readFileSync(file, "utf-8")).toBe(anchored);
    expect(stderr).toContainEqual(
      expect.stringMatching(
        /^⚠ Event key was not fixed: event\.key cannot be changed alone in this file \(edit it by hand\) file="auth\/2\/false\/login_button_click\.yaml" reason=/,
      ),
    );
    expect(stderr).not.toContain("Events fixed count=1");
  });

  // A group member outside targets.all does not stop keygen, so only the configuration check in
  // fix keeps the key from being rewritten; an unknown keygen step also stops keygen itself.
  it("fix rewrites nothing while opentp.yaml has a configuration error (exit 1)", async () => {
    const root = planCopy("fix-broken-group", (config) => {
      config.spec.events.payload.targets.legacy = ["desktop"];
    });
    const { file, broken } = breakEventKey(root);
    expect(await main(["fix", "--json", "--root", root])).toBe(EXIT_FAILURE);
    expect(fs.readFileSync(file, "utf-8")).toBe(broken);
    expect(stderr).toContain("✗ Event keys were not fixed: opentp.yaml has configuration errors");
    const { errors } = JSON.parse(stdout[0]);
    expect(errors).toContainEqual(
      expect.objectContaining({
        event: "opentp.yaml",
        path: "spec.events.payload.targets.legacy",
      }),
    );
  });

  it("fix rewrites nothing while keygen in opentp.cli.yaml has a problem (exit 1)", async () => {
    const root = cliCopy("fix-broken-keygen", (cli) => {
      cli.keygen.transforms.slug.push("to-pascal-case");
    });
    const { file, broken } = breakEventKey(root);
    expect(await main(["fix", "--json", "--root", root])).toBe(EXIT_FAILURE);
    expect(fs.readFileSync(file, "utf-8")).toBe(broken);
    expect(stderr).toContain("✗ Event keys were not fixed: keygen in opentp.cli.yaml has problems");
    const { errors } = JSON.parse(stdout[0]);
    expect(errors).toContainEqual(
      expect.objectContaining({
        event: "opentp.cli.yaml",
        path: expect.stringContaining("keygen.transforms.slug"),
      }),
    );
  });

  it("exits 2 for an unknown generator", async () => {
    expect(await main(["generate", "nope", "--root", fixture("coverage-valid")])).toBe(EXIT_USAGE);
    expect(stderr[0]).toContain("Unknown generator. Available: ");
  });

  describe("opentp.yaml version", () => {
    it("guides a 2026-01 plan to opentp migrate (exit 2), before comparing opentp.cli.yaml", async () => {
      const root = planCopy("v2026-01", (config) => {
        config.opentp = "2026-01";
      });
      expect(await main(["--json", "--root", root])).toBe(EXIT_USAGE);
      expect(stdout).toEqual([]);
      expect(stderr[0]).toMatch(
        /This plan uses OpenTrackPlan 2026-01; opentp \d+\.\d+\.\d+\S* reads 2026-09\. Run "opentp migrate" to upgrade it \(or keep opentp 0\.9\.1: OPENTP_VERSION=0\.9\.1\)\./,
      );
      expect(stderr.join("\n")).not.toContain("opentp.cli.yaml");
    });

    it("exits 2 when opentp.yaml and opentp.yml are both present", async () => {
      const root = planCopy("both-plan-files", () => {});
      fs.copyFileSync(path.join(root, "opentp.yaml"), path.join(root, "opentp.yml"));
      expect(await main(["--root", root])).toBe(EXIT_USAGE);
      expect(stderr[0]).toContain(`Both opentp.yaml and opentp.yml exist in ${root}; keep one`);
    });
  });

  describe("opentp.cli.yaml", () => {
    it.each([
      [
        "an unknown top-level key",
        (cli: Record<string, any>) => {
          cli.keygens = {};
        },
        "✗ opentp.cli.yaml: keygens: Unknown key 'keygens' (extensions start with 'x-')",
      ],
      [
        "a planned section",
        (cli: Record<string, any>) => {
          cli.serve = { port: 1 };
        },
        "✗ opentp.cli.yaml: serve: 'serve' is not supported yet",
      ],
      [
        "an unknown key in a section",
        (cli: Record<string, any>) => {
          cli.keygen.pipeline = {};
        },
        '✗ opentp.cli.yaml: keygen: Unrecognized key: "pipeline"',
      ],
      [
        "an unknown severity id",
        (cli: Record<string, any>) => {
          cli.checks.severity = { overlaps: "error" };
        },
        '✗ opentp.cli.yaml: checks.severity: Unrecognized key: "overlaps"',
      ],
      [
        "a binding that is both a webhook and a rule",
        (cli: Record<string, any>) => {
          cli.checks.bindings.both = { rule: "pattern", webhook: { url: "https://x.test" } };
        },
        "✗ opentp.cli.yaml: checks.bindings.both: Expected exactly one of { webhook: { url, ... } } or { rule: <name>, params? }",
      ],
      [
        "a webhook binding without url",
        (cli: Record<string, any>) => {
          cli.checks.bindings.hook = { webhook: { method: "POST" } };
        },
        "✗ opentp.cli.yaml: checks.bindings.hook.webhook.url:",
      ],
      [
        "an opentp header that differs from the plan",
        (cli: Record<string, any>) => {
          cli.opentp = "2026-08";
        },
        "✗ opentp.cli.yaml: opentp: '2026-08' does not match the plan's opentp '2026-09' (opentp.yaml)",
      ],
      [
        "an invalid cli range",
        (cli: Record<string, any>) => {
          cli.cli = "zero point ten";
        },
        "✗ opentp.cli.yaml: cli: 'zero point ten' is not a valid version range",
      ],
      [
        "a cli range this version does not satisfy",
        (cli: Record<string, any>) => {
          cli.cli = "<0.10";
        },
        "✗ opentp.cli.yaml: cli: this plan needs opentp <0.10, but this is opentp",
      ],
      [
        "mcp.write",
        (cli: Record<string, any>) => {
          cli.mcp = { write: true };
        },
        "✗ opentp.cli.yaml: mcp.write: write tools are not supported yet",
      ],
      [
        "a binding id that is a built-in check",
        (cli: Record<string, any>) => {
          cli.checks.bindings["starts-with"] = { rule: "pattern" };
        },
        "✗ opentp.cli.yaml: checks.bindings.starts-with: 'starts-with' is already a built-in or plugin check; choose another id",
      ],
      [
        "a binding id that is a spec.checks id",
        (cli: Record<string, any>) => {
          cli.checks.bindings["jira-key"] = { rule: "pattern" };
        },
        "✗ opentp.cli.yaml: checks.bindings.jira-key: 'jira-key' is already defined in spec.checks (opentp.yaml)",
      ],
      [
        "the reserved binding id webhook",
        (cli: Record<string, any>) => {
          cli.checks.bindings.webhook = { webhook: { url: "https://x.test" } };
        },
        "✗ opentp.cli.yaml: checks.bindings.webhook: 'webhook' is reserved; give the binding another id",
      ],
      [
        "a rule binding to webhook",
        (cli: Record<string, any>) => {
          cli.checks.bindings.hook = { rule: "webhook" };
        },
        "✗ opentp.cli.yaml: checks.bindings.hook.rule: 'webhook' is not a rule; bind it as { webhook: { url } }",
      ],
      [
        "a rule binding to an unknown rule",
        (cli: Record<string, any>) => {
          cli.checks.bindings.short = { rule: "max-lenght", params: 3 };
        },
        "✗ opentp.cli.yaml: checks.bindings.short.rule: unknown rule 'max-lenght'",
      ],
    ])("exits 2 for %s, before anything runs", async (_, edit, message) => {
      const root = cliCopy(`cli-${message.length}-${Math.random()}`, edit);
      for (const command of ["validate", "fix"]) {
        stderr.length = 0;
        expect(await main([command, "--json", "--root", root])).toBe(EXIT_USAGE);
        expect(stdout).toEqual([]);
        expect(stderr.join("\n")).toContain(message);
      }
    });

    it("exits 2 for an empty mcp.tools list", async () => {
      const root = cliCopy("cli-mcp-no-tools", (cli) => {
        cli.mcp = { tools: [] };
      });
      for (const command of ["mcp", "validate"]) {
        stderr.length = 0;
        expect(await main([command, "--root", root])).toBe(EXIT_USAGE);
        expect(stderr).toEqual([
          "✗ opentp.cli.yaml: mcp.tools: List at least one tool group (describe, search, validate, generate), or leave out mcp.tools to serve all",
        ]);
      }
    });

    it("exits 2 for generate and mcp too (mcp.write)", async () => {
      const root = cliCopy("cli-mcp-write", (cli) => {
        cli.mcp = { write: true };
      });
      expect(await main(["generate", "json", "--root", root])).toBe(EXIT_USAGE);
      expect(await main(["mcp", "--root", root])).toBe(EXIT_USAGE);
      expect(stdout).toEqual([]);
    });

    it("exits 2 for opentp.cli.yaml and opentp.cli.yml in the root, and for a missing --cli-config", async () => {
      const root = cliCopy("cli-both", () => {});
      fs.copyFileSync(path.join(root, "opentp.cli.yaml"), path.join(root, "opentp.cli.yml"));
      expect(await main(["--root", root])).toBe(EXIT_USAGE);
      expect(stderr[0]).toBe(
        `✗ Both opentp.cli.yaml and opentp.cli.yml exist in ${root}; keep one`,
      );

      stderr.length = 0;
      expect(await main(["--root", root, "--cli-config", "no/such/opentp.cli.yaml"])).toBe(
        EXIT_USAGE,
      );
      expect(stderr[0]).toBe(
        `✗ --cli-config: file not found: ${path.resolve("no/such/opentp.cli.yaml")}`,
      );
    });

    it("uses --cli-config (relative to the current directory) instead of the root's file", async () => {
      const root = cliCopy("cli-explicit", (cli) => {
        cli.keygen.template = "nonsense";
      });
      const explicit = path.join(tmpRoot, "cli-explicit.yaml");
      fs.copyFileSync(fixture("coverage-valid/opentp.cli.yaml"), explicit);
      expect(await main(["--root", root])).toBe(EXIT_FAILURE);
      stdout.length = 0;
      stderr.length = 0;
      const relative = path.relative(process.cwd(), explicit);
      expect(await main(["--root", root, "--cli-config", relative])).toBe(EXIT_OK);
      expect(stderr).toEqual(["✓ All events are valid count=4"]);
    });

    it("validates without opentp.cli.yaml: no key comparison", async () => {
      const root = cliCopy("cli-none", () => {});
      fs.rmSync(path.join(root, "opentp.cli.yaml"));
      // A key that follows spec.events.key but is not what keygen would generate
      const file = path.join(root, "events", "auth", "2", "false", "login_button_click.yaml");
      fs.writeFileSync(
        file,
        fs.readFileSync(file, "utf-8").replace("::login_button_click::", "::any_name::"),
      );
      // event_name uses the binding snake-case-name, which is unknown without the file: a warning
      expect(await main(["--root", root])).toBe(EXIT_OK);
      expect(stderr.at(-1)).toBe("✓ All events are valid warnings=1 count=4");
      expect(stdout.join("\n")).toContain(
        "⚠ spec.targets.all.schema.event_name.checks.snake-case-name: Unknown check 'snake-case-name'",
      );
    });
  });

  describe("tool rule severity", () => {
    it("--fail-on and checks.severity turn warnings into errors, off drops them", async () => {
      const root = cliCopy("severity", () => {});
      fs.rmSync(path.join(root, "opentp.cli.yaml"));
      // Without bindings, snake-case-name is an unknown check: a warning by default
      expect(await main(["--json", "--root", root])).toBe(EXIT_OK);
      const warned = JSON.parse(stdout[0]);
      expect(warned).toMatchObject({ success: true, events: 4, errors: [] });
      expect(warned.warnings).toHaveLength(1);

      stdout.length = 0;
      expect(await main(["--json", "--root", root, "--fail-on", "unknownCheck"])).toBe(
        EXIT_FAILURE,
      );
      const failed = JSON.parse(stdout[0]);
      expect(failed.success).toBe(false);
      expect(failed.errors).toEqual([
        expect.objectContaining({ severity: "error", rule: "unknownCheck" }),
      ]);
      expect(failed.warnings).toEqual([]);

      stdout.length = 0;
      fs.writeFileSync(
        path.join(root, "opentp.cli.yaml"),
        "opentp: 2026-09\nchecks:\n  severity:\n    unknownCheck: off\n",
      );
      expect(await main(["--json", "--root", root])).toBe(EXIT_OK);
      expect(JSON.parse(stdout[0]).warnings).toEqual([]);

      // --fail-on wins over checks.severity
      stdout.length = 0;
      expect(await main(["--json", "--root", root, "--fail-on=unknownCheck"])).toBe(EXIT_FAILURE);
    });
  });

  describe("plugins named in opentp.cli.yaml", () => {
    const id = `${process.pid}-${Date.now()}`;

    /** A plan copy with a custom keygen step and a custom check, both from plugin directories */
    function pluginPlan(name: string): string {
      const root = cliCopy(name, (cli) => {
        cli.keygen.plugins = ["./plugins/transforms"];
        cli.keygen.transforms.slug.push(`identity-${id}`);
        cli.checks.plugins = ["./plugins/checks"];
      });
      for (const [kind, folder, source] of [
        [
          "transforms",
          "identity",
          `export default { name: "identity-${id}", factory: () => (value) => value };`,
        ],
        [
          "checks",
          "always-ok",
          `export default { name: "always-ok-${id}", validate: () => ({ valid: true }) };`,
        ],
      ]) {
        const dir = path.join(root, "plugins", kind);
        fs.mkdirSync(path.join(dir, folder), { recursive: true });
        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: "module" }));
        fs.writeFileSync(path.join(dir, folder, "index.js"), source);
      }
      editYaml(path.join(root, "opentp.yaml"), (config) => {
        config.spec.targets.all.schema.event_name.checks[`always-ok-${id}`] = true;
      });
      return root;
    }

    afterEach(() => {
      delete process.env.OPENTP_ALLOW_PLUGINS;
    });

    it("are not loaded without consent: one warning, and the run continues", async () => {
      const root = pluginPlan("plugins-denied");
      expect(await main(["--json", "--root", root])).toBe(EXIT_FAILURE);
      expect(stderr).toContain(
        "⚠ opentp.cli.yaml names plugins (./plugins/transforms, ./plugins/checks); they were not loaded: pass --allow-plugins or set OPENTP_ALLOW_PLUGINS=1",
      );
      const result = JSON.parse(stdout[0]);
      // The keygen step is unknown: a keygen problem; the check id is unknown: a warning
      expect(result.errors).toEqual([
        expect.objectContaining({
          event: "opentp.cli.yaml",
          message: expect.stringContaining(`Unknown transform step 'identity-${id}'`),
        }),
      ]);
      expect(result.warnings).toEqual([
        expect.objectContaining({ rule: "unknownCheck", message: expect.stringContaining(id) }),
      ]);
    });

    it("load with --allow-plugins or OPENTP_ALLOW_PLUGINS=1 (relative to the file)", async () => {
      const root = pluginPlan("plugins-allowed");
      expect(await main(["--root", root, "--allow-plugins"])).toBe(EXIT_OK);
      expect(stderr.at(-1)).toBe("✓ All events are valid count=4");

      stderr.length = 0;
      process.env.OPENTP_ALLOW_PLUGINS = "1";
      expect(await main(["--root", root])).toBe(EXIT_OK);
      expect(stderr.join("\n")).not.toContain("they were not loaded");
    });

    it("a missing plugin directory exits 2 when plugins are allowed", async () => {
      const root = cliCopy("plugins-missing", (cli) => {
        cli.checks.plugins = ["./nowhere"];
      });
      expect(await main(["--root", root, "--allow-plugins"])).toBe(EXIT_USAGE);
      expect(stderr[0]).toBe(
        `✗ opentp.cli.yaml: checks.plugins: directory not found: ${path.join(root, "nowhere")}`,
      );
    });
  });

  describe("checks bindings", () => {
    it("runs a rule binding with its params, or with the plan's params instead of true", async () => {
      const root = cliCopy("binding-rule", (cli) => {
        cli.checks.bindings["snake-case-name"].params = "^[a-z]+$";
      });
      expect(await main(["--json", "--root", root])).toBe(EXIT_FAILURE);
      const messages = JSON.parse(stdout[0]).errors.map(
        (error: { message: string }) => error.message,
      );
      expect(messages).toContain('Value "login_button_click" does not match pattern /^[a-z]+$/');

      stdout.length = 0;
      editYaml(path.join(root, "opentp.yaml"), (config) => {
        config.spec.targets.all.schema.event_name.checks["snake-case-name"] = "^[a-z_]+$";
      });
      expect(await main(["--json", "--root", root])).toBe(EXIT_OK);
    });

    it("never reads environment variables that OPENTP_WEBHOOK_ENV does not list (unset: none)", async () => {
      const root = cliCopy("binding-webhook-env", (cli) => {
        cli.checks.bindings["name-check"] = {
          webhook: { url: `http://127.0.0.1:9/check?token=\${HOME}` },
        };
      });
      editYaml(path.join(root, "opentp.yaml"), (config) => {
        config.spec.targets.all.schema.event_name.checks = { "name-check": true };
      });
      const saved = process.env.OPENTP_WEBHOOK_ENV;
      delete process.env.OPENTP_WEBHOOK_ENV;
      try {
        expect(await main(["--json", "--root", root])).toBe(EXIT_FAILURE);
      } finally {
        if (saved !== undefined) process.env.OPENTP_WEBHOOK_ENV = saved;
      }
      const { errors } = JSON.parse(stdout[0]);
      expect(errors.length).toBeGreaterThan(0);
      for (const error of errors) {
        expect(error.message).toMatch(
          /^Webhook check uses environment variables that OPENTP_WEBHOOK_ENV does not allow: HOME\. No request was sent/,
        );
      }
    });
  });

  describe("generate.run", () => {
    it("runs every entry without a generator name: outputs relative to opentp.cli.yaml, filters", async () => {
      const root = cliCopy("generate-run", (cli) => {
        cli.generate = {
          run: [
            { generator: "json", output: "out/all.json", pretty: false },
            {
              generator: "json",
              output: "out/web-auth.json",
              target: "web",
              events: { area: "auth" },
            },
            {
              generator: "yaml",
              output: "out/p1-or-p3.yaml",
              events: { priority_level: [1, 3], is_internal: [true, false] },
            },
            {
              generator: "template",
              file: "events.tpl",
              output: "out/keys.txt",
              target: "android",
            },
          ],
        };
      });
      fs.writeFileSync(path.join(root, "events.tpl"), "{{#each events}}{{key}}\n{{/each}}");
      expect(await main(["generate", "--root", root])).toBe(EXIT_OK);
      expect(stdout).toEqual([]);
      const read = (file: string) => fs.readFileSync(path.join(root, "out", file), "utf-8");

      const all = read("all.json");
      expect(all.split("\n")).toHaveLength(2); // --no-pretty: one line plus the final newline
      expect(JSON.parse(all).events).toHaveLength(4);
      const webAuth = JSON.parse(read("web-auth.json")).events.map(
        (event: { key: string }) => event.key,
      );
      // auth events covering web (login_experiment covers web through its `web` selector)
      expect(webAuth).toHaveLength(3);
      // priority_level 1 or 3 (onboarding_step_complete, login_experiment)
      const p1OrP3 = parse(read("p1-or-p3.yaml")).events.map((event: { key: string }) => event.key);
      expect(p1OrP3.sort()).toEqual([
        "auth::login_experiment::experiment::login::p3::internal-false",
        "onboarding::onboarding_step_complete::complete::onboarding_step::p1::internal-true",
      ]);
      // Every event covers android: implicit `all`, `all`, `mobile` and an `android` selector
      expect(read("keys.txt").trim().split("\n")).toHaveLength(4);
      expect(stderr.filter((line) => line.startsWith("Generated file="))).toHaveLength(4);
    });

    it.each([
      [
        "no generator name and no run entries",
        () => {},
        "generate needs a generator name or generate.run entries in opentp.cli.yaml",
      ],
      [
        "an unknown generator",
        (cli: Record<string, any>) => {
          cli.generate = { run: [{ generator: "sql", output: "x.sql" }] };
        },
        "opentp.cli.yaml: generate.run[0].generator: unknown generator 'sql' (available: json, yaml, template)",
      ],
      [
        "an unknown target",
        (cli: Record<string, any>) => {
          cli.generate = { run: [{ generator: "json", output: "x.json", target: "tv" }] };
        },
        "opentp.cli.yaml: generate.run[0].target: unknown target 'tv' (targets: web, ios, android)",
      ],
      [
        "an events filter on a field that is not in the taxonomy",
        (cli: Record<string, any>) => {
          cli.generate = { run: [{ generator: "json", output: "x.json", events: { team: "x" } }] };
        },
        "opentp.cli.yaml: generate.run[0].events.team: 'team' is not a taxonomy field or fragment",
      ],
      [
        "a run entry without output",
        (cli: Record<string, any>) => {
          cli.generate = { run: [{ generator: "json" }] };
        },
        "opentp.cli.yaml: generate.run[0].output:",
      ],
    ])("exits 2 for %s", async (_, edit, message) => {
      const root = cliCopy(`generate-${message.length}`, edit);
      expect(await main(["generate", "--root", root])).toBe(EXIT_USAGE);
      expect(stdout).toEqual([]);
      expect(stderr.join("\n")).toContain(message);
    });

    describe("paths stay inside the directory of opentp.cli.yaml", () => {
      /** A plan copy in its own directory, next to a directory `outside` */
      function sandbox(name: string, run: Array<Record<string, unknown>>) {
        const base = path.join(tmpRoot, name);
        const outside = path.join(base, "outside");
        fs.mkdirSync(outside, { recursive: true });
        fs.writeFileSync(path.join(outside, "secret.txt"), "SECRET-OUTSIDE");
        const root = path.join(base, "plan");
        fs.cpSync(fixture("coverage-valid"), root, { recursive: true });
        fs.mkdirSync(path.join(root, ".git", "hooks"), { recursive: true });
        fs.writeFileSync(path.join(root, ".git", "config"), "[core]\n");
        fs.writeFileSync(path.join(root, "hook.tpl"), "#!/bin/sh\necho changed\n");
        editYaml(path.join(root, "opentp.cli.yaml"), (cli) => {
          cli.generate = { run };
        });
        return { root, outside };
      }

      it.each([
        [
          "an output that leaves the directory",
          { generator: "template", file: "hook.tpl", output: "../outside/written.sh" },
          "generate.run[0].output: '../outside/written.sh' leaves the directory of opentp.cli.yaml",
        ],
        [
          "an absolute output",
          { generator: "json", output: "<outside>/abs.json" },
          "generate.run[0].output: '<outside>/abs.json' is an absolute path: write a path relative to the directory of opentp.cli.yaml",
        ],
        [
          "an output in .git",
          { generator: "template", file: "hook.tpl", output: ".git/config" },
          "generate.run[0].output: '.git/config' is inside a .git directory",
        ],
        [
          "an output in .git written in another case",
          { generator: "template", file: "hook.tpl", output: "build/../.GIT/hooks/pre-commit" },
          "generate.run[0].output: 'build/../.GIT/hooks/pre-commit' is inside a .git directory",
        ],
        [
          "an output through a symbolic link to another directory",
          { generator: "json", output: "link-out/x.json" },
          "generate.run[0].output: 'link-out/x.json' leaves the directory of opentp.cli.yaml",
        ],
        [
          "an output through a symbolic link to .git",
          { generator: "template", file: "hook.tpl", output: "link-git/config" },
          "generate.run[0].output: 'link-git/config' is inside a .git directory",
        ],
        [
          "an output that is a dangling symbolic link",
          { generator: "json", output: "dangling.json" },
          "generate.run[0].output: 'dangling.json' contains a symbolic link that cannot be resolved",
        ],
        [
          "a template file that leaves the directory",
          { generator: "template", file: "../outside/secret.txt", output: "out/secret.txt" },
          "generate.run[0].file: '../outside/secret.txt' leaves the directory of opentp.cli.yaml",
        ],
        [
          "a template file in .git",
          { generator: "template", file: ".git/config", output: "out/config.txt" },
          "generate.run[0].file: '.git/config' is inside a .git directory",
        ],
      ])("exits 2 for %s and writes nothing", async (name, entry, message) => {
        const { root, outside } = sandbox(`contain-${name.replace(/[^a-z]+/g, "-")}`, []);
        fs.symlinkSync(outside, path.join(root, "link-out"));
        fs.symlinkSync(path.join(root, ".git"), path.join(root, "link-git"));
        fs.symlinkSync(path.join(outside, "missing.json"), path.join(root, "dangling.json"));
        const resolved = Object.fromEntries(
          Object.entries(entry).map(([key, value]) => [key, value.replace("<outside>", outside)]),
        );
        editYaml(path.join(root, "opentp.cli.yaml"), (cli) => {
          cli.generate = { run: [resolved] };
        });
        const before = fs.readdirSync(outside).sort();
        const gitConfig = fs.readFileSync(path.join(root, ".git", "config"), "utf-8");

        // No flag lets an entry write outside (--allow-plugins neither)
        for (const args of [[], ["--allow-plugins"]]) {
          stderr.length = 0;
          expect(await main(["generate", "--root", root, ...args])).toBe(EXIT_USAGE);
          expect(stderr).toEqual([
            `✗ opentp.cli.yaml: ${message.replace("<outside>", outside)}${message.includes("leaves") ? ` (${root})` : ""}`,
          ]);
        }
        expect(stdout).toEqual([]);
        expect(fs.readdirSync(outside).sort()).toEqual(before);
        expect(fs.readFileSync(path.join(root, ".git", "config"), "utf-8")).toBe(gitConfig);
        expect(fs.existsSync(path.join(root, ".git", "hooks", "pre-commit"))).toBe(false);
        expect(fs.existsSync(path.join(root, "out"))).toBe(false);
      });

      it("allows paths inside the directory, also through a symbolic link that stays inside", async () => {
        const { root } = sandbox("contain-inside", [
          { generator: "json", output: "build/../out/plan.json" },
          { generator: "template", file: "./hook.tpl", output: "link-in/hook.txt" },
        ]);
        fs.mkdirSync(path.join(root, "generated"));
        fs.symlinkSync(path.join(root, "generated"), path.join(root, "link-in"));
        expect(await main(["generate", "--root", root])).toBe(EXIT_OK);
        expect(fs.existsSync(path.join(root, "out/plan.json"))).toBe(true);
        expect(fs.readFileSync(path.join(root, "generated/hook.txt"), "utf-8")).toBe(
          "#!/bin/sh\necho changed\n",
        );
      });

      it("leaves -o and --file on the command line alone", async () => {
        const { root, outside } = sandbox("contain-command-line", []);
        const target = path.join(outside, "named.txt");
        expect(
          await main([
            "generate",
            "template",
            "--file",
            path.join(outside, "secret.txt"),
            "-o",
            target,
            "--root",
            root,
          ]),
        ).toBe(EXIT_OK);
        expect(fs.readFileSync(target, "utf-8")).toBe("SECRET-OUTSIDE");
      });
    });

    it("checks every entry before running any, and reports every problem", async () => {
      const root = cliCopy("generate-run-all-problems", (cli) => {
        cli.generate = {
          run: [
            { generator: "json", output: "out/web.json", target: "web" },
            { generator: "template", output: "out/no-file.md" },
            { generator: "template", file: "missing.tpl", output: "out/missing.md" },
            { generator: "sql", output: "out/x.sql", target: "tv" },
            { generator: "yaml", output: "../x.yaml", events: { team: "x" } },
          ],
        };
      });
      expect(await main(["generate", "--root", root])).toBe(EXIT_USAGE);
      expect(stderr).toEqual([
        "✗ opentp.cli.yaml: generate.run[1].file: the template generator needs a template file",
        `✗ opentp.cli.yaml: generate.run[2].file: file not found: ${path.join(root, "missing.tpl")}`,
        "✗ opentp.cli.yaml: generate.run[3].generator: unknown generator 'sql' (available: json, yaml, template)",
        "✗ opentp.cli.yaml: generate.run[3].target: unknown target 'tv' (targets: web, ios, android)",
        `✗ opentp.cli.yaml: generate.run[4].output: '../x.yaml' leaves the directory of opentp.cli.yaml (${root})`,
        "✗ opentp.cli.yaml: generate.run[4].events.team: 'team' is not a taxonomy field or fragment",
      ]);
      // Nothing ran: not even the first, valid entry
      expect(fs.existsSync(path.join(root, "out"))).toBe(false);
      expect(stdout).toEqual([]);
    });

    it("with a generator name, behaves as before and ignores the run entries", async () => {
      const root = cliCopy("generate-named", (cli) => {
        cli.generate = { run: [{ generator: "json", output: "never.json" }] };
      });
      expect(await main(["generate", "yaml", "--root", root])).toBe(EXIT_OK);
      expect(stdout.join("")).toContain("events:");
      expect(fs.existsSync(path.join(root, "never.json"))).toBe(false);
    });
  });
});
