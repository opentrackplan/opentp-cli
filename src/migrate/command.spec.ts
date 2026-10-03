import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, main, parseCliArgs, UsageError } from "../cli";
import { setLogLevel } from "../util/logger";

const FIXTURE = path.join(process.cwd(), "tests", "data", "migrate-2026-01");

describe("parseCliArgs: migrate", () => {
  it("accepts --check, --dry-run, --json and the global options", () => {
    expect(
      parseCliArgs(["migrate", "--check", "--dry-run", "--json", "-v", "--root", "./plan"], {}),
    ).toMatchObject({
      command: "migrate",
      check: true,
      dryRun: true,
      json: true,
      verbose: true,
      root: "./plan",
    });
    expect(parseCliArgs(["migrate"], {})).toMatchObject({ check: false, dryRun: false });
  });

  it("rejects options of other commands, migrate options elsewhere and arguments", () => {
    expect(() => parseCliArgs(["migrate", "--fix"], {})).toThrow(UsageError);
    expect(() => parseCliArgs(["migrate", "--fail-on", "overlap"], {})).toThrow(
      "Option '--fail-on' cannot be used with 'migrate'",
    );
    expect(() => parseCliArgs(["validate", "--check"], {})).toThrow(
      "Option '--check' cannot be used with 'validate'",
    );
    expect(() => parseCliArgs(["generate", "json", "--dry-run"], {})).toThrow(UsageError);
    expect(() => parseCliArgs(["migrate", "now"], {})).toThrow("Unexpected argument 'now'");
  });
});

describe("main: migrate", () => {
  let tmpRoot: string;
  let stdout: string[];
  let stderr: string[];
  let counter = 0;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opentp-migrate-cli-"));
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setLogLevel("info");
  });

  function fixtureCopy(): string {
    counter += 1;
    const root = path.join(tmpRoot, `plan-${counter}`);
    fs.cpSync(FIXTURE, root, { recursive: true });
    return root;
  }

  it("prints the changed files on stdout and the summary on stderr", async () => {
    const root = fixtureCopy();
    expect(await main(["migrate", "--root", root])).toBe(EXIT_OK);
    expect(stdout).toEqual([
      "dictionaries/data/application_id.yaml",
      "dictionaries/taxonomy/areas.yaml",
      "events/auth/login.yaml",
      "events/auth/logout.yaml",
      "events/checkout/purchase.yaml",
      "templates/event.yaml",
      "opentp.yaml",
      "opentp.cli.yaml",
    ]);
    const log = stderr.join("\n");
    expect(log).toContain("✓ Migrated to 2026-09 changed=7 created=1 warnings=7 manual=0");
    expect(log).toContain("Next steps:");
    expect(log).toContain("to 0.10.x in the same commit");
    expect(log).toContain(
      "Migrated outside the events and dictionaries roots: templates/event.yaml",
    );

    stdout = [];
    stderr = [];
    expect(await main(["migrate", "--root", root])).toBe(EXIT_OK);
    expect(stdout).toEqual([]);
    expect(stderr.join("\n")).toContain("Nothing to migrate");
  });

  it("prints one JSON document with --json", async () => {
    const root = fixtureCopy();
    expect(await main(["migrate", "--root", root, "--dry-run", "--json"])).toBe(EXIT_OK);
    expect(stdout).toHaveLength(1);
    const document = JSON.parse(stdout[0]);
    expect(Object.keys(document)).toEqual(["changed", "created", "warnings", "manual", "summary"]);
    expect(document.summary).toMatchObject({ mode: "dry-run", written: false, changed: 7 });
    expect(document.created[0].file).toBe("opentp.cli.yaml");
    expect(fs.existsSync(path.join(root, "opentp.cli.yaml"))).toBe(false);
  });

  it("exits 1 with --check when files would change, 2 without a plan", async () => {
    const root = fixtureCopy();
    expect(await main(["migrate", "--root", root, "--check"])).toBe(EXIT_FAILURE);
    expect(stderr.join("\n")).toContain("Migration to 2026-09 needed");
    expect(fs.readFileSync(path.join(root, "opentp.yaml"), "utf-8")).toContain("2026-01");

    expect(await main(["migrate", "--root", path.join(tmpRoot, "missing")])).toBe(EXIT_USAGE);
  });

  it("exits 2 with one line per problem when opentp.cli.yaml has the wrong shape", async () => {
    const root = fixtureCopy();
    fs.writeFileSync(
      path.join(root, "opentp.cli.yaml"),
      "opentp: 2026-09\nkeygen: { template: '{event}', extra: 1 }\nfoo: 1\n",
    );
    expect(await main(["migrate", "--root", root])).toBe(EXIT_USAGE);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([
      expect.stringContaining('✗ opentp.cli.yaml: keygen: Unrecognized key: "extra"'),
      expect.stringContaining(
        "✗ opentp.cli.yaml: foo: Unknown key 'foo' (extensions start with 'x-')",
      ),
    ]);
    expect(fs.readFileSync(path.join(root, "opentp.yaml"), "utf-8")).toContain("2026-01");
  });

  it("lists migrate in the help", async () => {
    expect(await main(["--help"])).toBe(EXIT_OK);
    const help = stdout.join("\n");
    expect(help).toContain("migrate                Upgrade a 2026-01 tracking plan to 2026-09");
    expect(help).toContain("--dry-run");
  });
});
