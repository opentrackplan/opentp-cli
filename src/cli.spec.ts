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
    [["generate"], "Missing generator name"],
    [["generate", "-o", "x.json"], "Missing generator name"],
    [["generate", "json", "yaml"], "Unexpected argument 'yaml'"],
    [["validate", "extra"], "Unexpected argument 'extra'"],
    [["help", "validate"], "Unexpected argument 'validate'"],
    [["version", "foo"], "Unexpected argument 'foo'"],
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
    const configPath = path.join(root, "opentp.yaml");
    const config = parse(fs.readFileSync(configPath, "utf-8"));
    edit(config);
    fs.writeFileSync(configPath, stringify(config));
    return root;
  }

  it("exits 2 with the usage on stderr for an unknown command", async () => {
    expect(await main(["valdiate"])).toBe(EXIT_USAGE);
    expect(stdout).toEqual([]);
    expect(stderr[0]).toBe("✗ Unknown command 'valdiate'");
    expect(stderr.join("\n")).toContain("Usage: opentp [validate | fix | generate <name>");
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
    expect(stdout.join("\n")).toContain("[opentp.yaml]");
    expect(stderr.at(-1)).toMatch(/^✗ ✗ Validation failed errorCount=\d+ eventCount=19$/);
  });

  it("prints only the JSON document on stdout with --json, also with -v", async () => {
    const args = ["--json", "-v", "--root", fixture("coverage-invalid")];
    expect(await main(args)).toBe(EXIT_FAILURE);
    expect(stdout).toHaveLength(1);
    const result = JSON.parse(stdout[0]);
    expect(result).toMatchObject({ success: false, events: 19 });
    expect(result.errors.length).toBeGreaterThan(0);
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

  it("exits 2 for fix without keygen", async () => {
    const noKeygen = planCopy("no-keygen", (config) => {
      delete config.spec.events["x-opentp"];
    });
    expect(await main(["fix", "--root", noKeygen])).toBe(EXIT_USAGE);
    expect(stderr[0]).toContain("Key generation is not configured");
  });

  it("reports an unknown keygen step once against opentp.yaml (exit 1)", async () => {
    const root = planCopy("unknown-step", (config) => {
      config.spec.events["x-opentp"].keygen.transforms.slug.push("to-pascal-case");
    });
    expect(await main(["--json", "--root", root])).toBe(EXIT_FAILURE);
    const { errors } = JSON.parse(stdout[0]);
    expect(errors).toEqual([
      {
        event: "opentp.yaml",
        path: expect.stringMatching(/^spec\.events\.x-opentp\.keygen\.transforms\.slug\[\d+\]$/),
        message:
          "Unknown transform step 'to-pascal-case' (custom steps are loaded with --external-transforms)",
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
    expect(JSON.parse(written).events).toHaveLength(4);
  });

  it("refuses to generate from a plan that cannot be loaded: exit 1, empty stdout, no file", async () => {
    const root = fixture("coverage-invalid");
    expect(await main(["generate", "json", "--root", root])).toBe(EXIT_FAILURE);
    expect(stdout).toEqual([]);
    // The load problems and the summary go to stderr
    expect(stderr.join("\n")).toContain("[opentp.yaml]");
    expect(stderr.at(-1)).toMatch(
      /^✗ ✗ Generation aborted: the tracking plan could not be loaded \(run 'opentp validate'\) errorCount=\d+ eventCount=19$/,
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

  // A group member outside targets.all does not stop keygen, so only the configuration check in
  // fix keeps the key from being rewritten; an unknown keygen step also stops keygen itself.
  it.each([
    [
      "an unknown keygen step",
      (config: Record<string, any>) => {
        config.spec.events["x-opentp"].keygen.transforms.slug.push("to-pascal-case");
      },
      "spec.events.x-opentp.keygen.transforms.slug",
    ],
    [
      "a group member outside targets.all",
      (config: Record<string, any>) => {
        config.spec.events.payload.targets.legacy = ["desktop"];
      },
      "spec.events.payload.targets.legacy",
    ],
  ])("fix rewrites nothing while opentp.yaml has %s (exit 1)", async (_, edit, configPath) => {
    const root = planCopy(`fix-broken-${configPath}`, edit);
    const { file, broken } = breakEventKey(root);
    expect(await main(["fix", "--json", "--root", root])).toBe(EXIT_FAILURE);
    expect(fs.readFileSync(file, "utf-8")).toBe(broken);
    expect(stderr).toContain("✗ Event keys were not fixed: opentp.yaml has configuration errors");
    const { errors } = JSON.parse(stdout[0]);
    expect(errors).toContainEqual(
      expect.objectContaining({ event: "opentp.yaml", path: expect.stringContaining(configPath) }),
    );
  });

  it("exits 2 for an unknown generator", async () => {
    expect(await main(["generate", "nope", "--root", fixture("coverage-valid")])).toBe(EXIT_USAGE);
    expect(stderr[0]).toContain("Unknown generator. Available: ");
  });
});
