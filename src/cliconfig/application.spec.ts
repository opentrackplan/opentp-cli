/**
 * Application repository mode (opentp.cli.yaml with plan:): the merge of the plan repository's
 * settings, the refusals, the 2026-01 guidance, and validate, generate and the MCP plan store on
 * tests/data/application (plan: ../tracker) and on git+file:// plans created by the tests.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, main } from "../cli";
import { type GeneratorContext, registerGenerator } from "../generators";
import { PlanError, PlanStore } from "../mcp/plan";
import { describePlan, generate, validatePlan } from "../mcp/tools";
import { VERSION } from "../meta";
import { setLogLevel } from "../util/logger";
import {
  completeApplication,
  keygenIgnoredWarning,
  mergeApplicationConfig,
  openApplication,
  planCliLabel,
} from "./application";
import { CliConfigError, findApplicationFile, loadCliConfig, planWithConfigMessage } from "./index";
import { CACHE_DIR_ENV, type GitRunner, parsePlanSource, planCacheDir } from "./plan-source";
import type { CliConfig } from "./schema";

const APPLICATION = path.resolve("tests/data/application");
const TRACKER = path.resolve("tests/data/tracker");

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opentp-application-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** The application fixture next to a copy of the tracker plan (plan: ../tracker) */
function workspace(): { app: string; plan: string } {
  const dir = tempDir();
  fs.cpSync(APPLICATION, path.join(dir, "application"), { recursive: true });
  fs.cpSync(TRACKER, path.join(dir, "tracker"), { recursive: true });
  return { app: path.join(dir, "application"), plan: path.join(dir, "tracker") };
}

function editYaml(file: string, change: (document: any) => void): void {
  const document = fs.existsSync(file) ? parse(fs.readFileSync(file, "utf8")) : {};
  change(document);
  fs.writeFileSync(file, stringify(document));
}

const appFile = (root: string) => path.join(root, "opentp.cli.yaml");

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

/** Every file below a directory with its content (to show that nothing was written) */
function snapshotFiles(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    out[path.relative(dir, file)] = fs.readFileSync(file, "utf8");
  }
  return out;
}

/** A git repository with a copy of the tracker plan and the tag v1.0.0 */
function gitPlan(): { dir: string; url: string; branch: string } {
  const dir = tempDir();
  fs.cpSync(TRACKER, dir, { recursive: true });
  const run = (...args: string[]) => {
    const result = spawnSync(
      "git",
      [
        "-c",
        "user.name=opentp-test",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: dir, encoding: "utf8" },
    );
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  run("init", "-q");
  run("add", "-A");
  run("commit", "-q", "-m", "Tracking plan");
  run("tag", "v1.0.0");
  return {
    dir,
    url: `git+${pathToFileURL(dir).href}`,
    branch: run("rev-parse", "--abbrev-ref", "HEAD"),
  };
}

const OPENTP = "2026-09";

describe("mergeApplicationConfig", () => {
  const planCli = {
    opentp: OPENTP,
    plan: "../elsewhere",
    keygen: { template: "{area}::{event}", plugins: ["./transforms"] },
    checks: {
      plugins: ["./checks"],
      bindings: {
        shared: { rule: "pattern", params: "^plan" },
        "plan-only": { rule: "min-length", params: 2 },
        // Webhook bindings of the plan repository are never taken
        "plan-hook": { webhook: { url: "https://plan.example.com/check" } },
      },
      severity: { overlap: "warning", unknownCheck: "error" },
    },
    tracker: {
      type: "snowplow",
      event: "iglu:com.acme/event/jsonschema/1-0-0",
      contexts: { dimensions: "iglu:com.acme/dimensions/jsonschema/1-0-0" },
      map: { "dimension_*": "contexts.dimensions", application_id: "atomic.app_id" },
      setBy: { app: ["application_id", "user_id"], tracker: ["platform"] },
      targets: { ios: { map: { os_version: "contexts.dimensions" } } },
    },
    generate: { plugins: ["./generators"], run: [{ generator: "json", output: "plan.json" }] },
    mcp: { tools: ["describe"] },
  } as CliConfig;

  it("takes only tracker, rule bindings and severity from the plan repository; the application wins", () => {
    const app = {
      opentp: OPENTP,
      plan: "../tracker",
      keygen: { template: "{event}" },
      checks: {
        bindings: { shared: { rule: "pattern", params: "^app" } },
        severity: { overlap: "off" },
      },
      tracker: {
        type: "snowplow",
        map: { application_id: "event.app" },
        setBy: { app: ["user_id"] },
      },
      "x-acme-team": "web",
    } as CliConfig;
    expect(mergeApplicationConfig(app, planCli)).toEqual({
      opentp: OPENTP,
      plan: "../tracker",
      "x-acme-team": "web",
      tracker: {
        type: "snowplow",
        event: "iglu:com.acme/event/jsonschema/1-0-0",
        contexts: { dimensions: "iglu:com.acme/dimensions/jsonschema/1-0-0" },
        // Mappings merge key by key, arrays are replaced
        map: { "dimension_*": "contexts.dimensions", application_id: "event.app" },
        setBy: { app: ["user_id"], tracker: ["platform"] },
        targets: { ios: { map: { os_version: "contexts.dimensions" } } },
      },
      checks: {
        bindings: {
          shared: { rule: "pattern", params: "^app" },
          "plan-only": { rule: "min-length", params: 2 },
        },
        severity: { overlap: "off", unknownCheck: "error" },
      },
    });
  });

  it("keeps keygen, plugins, generate and mcp of the application only", () => {
    const app = {
      opentp: OPENTP,
      plan: "../tracker",
      checks: { plugins: ["./app-checks"] },
      generate: { run: [{ generator: "yaml", output: "app.yaml" }] },
      mcp: { tools: ["search"] },
    } as CliConfig;
    const merged = mergeApplicationConfig(app, planCli);
    expect(merged.checks?.plugins).toEqual(["./app-checks"]);
    expect(merged.generate).toEqual({ run: [{ generator: "yaml", output: "app.yaml" }] });
    expect(merged.mcp).toEqual({ tools: ["search"] });
    expect(merged.plan).toBe("../tracker");
    expect(merged).not.toHaveProperty("keygen");
    // Without a plan repository file: the application file without keygen
    expect(mergeApplicationConfig({ ...app, keygen: { template: "{event}" } }, null)).toEqual(app);
  });

  it("replaces the whole tracker section when the application names another type", () => {
    const app = { opentp: OPENTP, plan: "../tracker", tracker: { type: "ga4" } } as CliConfig;
    expect(mergeApplicationConfig(app, planCli).tracker).toEqual({ type: "ga4" });
  });
});

describe("openApplication and completeApplication", () => {
  it("locates a local plan and merges the plan repository's settings", () => {
    expect(findApplicationFile(APPLICATION)).toBe(appFile(APPLICATION));
    expect(findApplicationFile(TRACKER)).toBeNull();
    const opened = openApplication(appFile(APPLICATION), APPLICATION);
    expect(opened).toMatchObject({
      plan: "../tracker",
      planRoot: TRACKER,
      configPath: path.join(TRACKER, "opentp.yaml"),
      dir: APPLICATION,
    });
    const cli = completeApplication(opened, { planVersion: OPENTP });
    expect(cli.path).toBe(appFile(APPLICATION));
    expect(cli.application).toEqual({
      plan: "../tracker",
      source: { kind: "path", written: "../tracker", dir: TRACKER },
      planRoot: TRACKER,
      configPath: path.join(TRACKER, "opentp.yaml"),
      planCliPath: path.join(TRACKER, "opentp.cli.yaml"),
      keygenIgnored: false,
      planPlugins: [],
      planWebhooks: [],
      // The plan repository's file has a tracker section: its keys are told apart from the app's
      trackerOrigin: { app: opened.config.tracker, planLabel: planCliLabel("../tracker") },
    });
    // The plan repository's keygen is never taken; its tracker is merged with the application's
    expect(cli.config).not.toHaveProperty("keygen");
    expect(cli.config.tracker).toMatchObject({
      type: "snowplow",
      map: { application_id: "atomic.app_id", step_index: "contexts.dimensions" },
    });
    expect(cli.config.checks).toEqual({ severity: { overlap: "error" } });
  });

  it("refuses opentp.yaml next to plan:, in both loaders", () => {
    const { app } = workspace();
    fs.copyFileSync(path.join(TRACKER, "opentp.yaml"), path.join(app, "opentp.yaml"));
    expect(errorLines(() => openApplication(appFile(app), app))).toEqual([planWithConfigMessage()]);
    // A plan repository's file read as such
    expect(errorLines(() => loadCliConfig(app, { planVersion: OPENTP }))).toEqual([
      planWithConfigMessage(),
    ]);
  });

  it.each([
    [
      "an application cli range this CLI does not satisfy",
      (cli: any) => {
        cli.cli = "<0.10";
      },
      `opentp.cli.yaml: cli: this plan needs opentp <0.10, but this is opentp ${VERSION} (install a matching version, e.g. with OPENTP_VERSION)`,
    ],
    [
      "mcp.write",
      (cli: any) => {
        cli.mcp = { write: true };
      },
      "opentp.cli.yaml: mcp.write: write tools are not supported yet",
    ],
    [
      "a plan directory that does not exist",
      (cli: any) => {
        cli.plan = "../missing-plan";
      },
      "opentp.cli.yaml: plan: directory not found: <workspace>/missing-plan",
    ],
    [
      "a URL that is not a git URL",
      (cli: any) => {
        cli.plan = "https://example.com/acme/plan.git";
      },
      "opentp.cli.yaml: plan: 'https://example.com/acme/plan.git' looks like a URL: write a git URL as git+ssh://, git+https:// or git+file:// with #<tag or commit SHA>, e.g. git+https://example.com/acme/plan.git#<tag or commit SHA>",
    ],
    [
      "a git URL without a ref",
      (cli: any) => {
        cli.plan = "git+ssh://git@example.com/acme/plan.git";
      },
      "opentp.cli.yaml: plan: a git URL needs #<tag or commit SHA> at the end, e.g. git+ssh://***@example.com/acme/plan.git#v1.0.0",
    ],
  ])("refuses %s (exit 2 from every command)", async (_, edit, message) => {
    const { app } = workspace();
    editYaml(appFile(app), edit);
    const expected = message.replace("<workspace>", path.dirname(app));
    expect(errorLines(() => openApplication(appFile(app), app))).toEqual([expected]);
  });

  it("refuses a plan directory without opentp.yaml", () => {
    const { app, plan } = workspace();
    fs.rmSync(path.join(plan, "opentp.yaml"));
    expect(errorLines(() => openApplication(appFile(app), app))).toEqual([
      `opentp.cli.yaml: plan: no opentp.yaml in ${plan}`,
    ]);
  });

  it.each([
    [
      "an application opentp that differs from the plan",
      (files: { app: string; plan: string }) =>
        editYaml(appFile(files.app), (cli) => {
          cli.opentp = "2026-08";
        }),
      [
        "opentp.cli.yaml: opentp: '2026-08' does not match the plan's opentp '2026-09' (the pinned plan ../tracker)",
      ],
    ],
    [
      "a plan repository file with another opentp",
      (files: { app: string; plan: string }) =>
        editYaml(appFile(files.plan), (cli) => {
          cli.opentp = "2026-08";
        }),
      [
        `${planCliLabel("../tracker")}: opentp: '2026-08' does not match the plan's opentp '2026-09' (opentp.yaml)`,
      ],
    ],
    [
      "a plan repository cli range this CLI does not satisfy",
      (files: { app: string; plan: string }) =>
        editYaml(appFile(files.plan), (cli) => {
          cli.cli = ">=0.11";
        }),
      [
        `opentp.cli.yaml of the plan '../tracker': cli: this plan needs opentp >=0.11, but this is opentp ${VERSION} (install a matching version, e.g. with OPENTP_VERSION)`,
      ],
    ],
    [
      "a plan repository file with a wrong shape",
      (files: { app: string; plan: string }) =>
        editYaml(appFile(files.plan), (cli) => {
          cli.keygens = {};
        }),
      [
        "opentp.cli.yaml of the plan '../tracker': keygens: Unknown key 'keygens' (extensions start with 'x-')",
      ],
    ],
    [
      "both opentp.cli.yaml and opentp.cli.yml in the plan repository",
      (files: { app: string; plan: string }) =>
        fs.writeFileSync(path.join(files.plan, "opentp.cli.yml"), "opentp: 2026-09\n"),
      [
        "opentp.cli.yaml of the plan '../tracker': Both opentp.cli.yaml and opentp.cli.yml exist in <plan>; keep one",
      ],
    ],
  ])("completeApplication refuses %s", (_, edit, lines) => {
    const files = workspace();
    edit(files);
    const opened = openApplication(appFile(files.app), files.app);
    expect(errorLines(() => completeApplication(opened, { planVersion: OPENTP }))).toEqual(
      lines.map((line) => line.replace("<plan>", files.plan)),
    );
  });
});

describe("opentp in an application repository", () => {
  let stdout: string[];
  let stderr: string[];
  let probed: GeneratorContext[];

  registerGenerator({
    name: "application-probe",
    generate: (context) => {
      probed.push(context);
      return { stdout: "" };
    },
  });

  beforeEach(() => {
    stdout = [];
    stderr = [];
    probed = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      stdout.push(args.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args) => {
      stderr.push(args.join(" "));
    });
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    setLogLevel("info");
  });

  it("validates the plan that plan: names (tests/data/application)", async () => {
    expect(await main(["validate", "--root", APPLICATION])).toBe(EXIT_OK);
    expect(stderr).toEqual(["✓ All events are valid count=2"]);
    expect(stdout).toEqual([]);
  });

  it("labels tracker problems at keys that only the plan repository's file has with that file", async () => {
    const { app, plan } = workspace();
    // ga4 in both files: the sections are merged
    editYaml(path.join(plan, "opentp.cli.yaml"), (cli) => {
      cli.tracker = {
        type: "ga4",
        event: "iglu:com.acme/event/jsonschema/1-0-0",
        map: { user_id: "user_id", plan_only: "params.plan_only", step_index: "params.step" },
        targets: { ios: { contexts: { mobile: "iglu:com.acme/mobile/jsonschema/1-0-0" } } },
      };
    });
    editYaml(appFile(app), (cli) => {
      cli.tracker = { type: "ga4", map: { event_name: "name", app_only: "params.app_only" } };
    });
    const label = planCliLabel("../tracker");
    const expected = [
      {
        event: label,
        path: "tracker.event",
        message: "'event' is only allowed for tracker type snowplow",
      },
      {
        event: label,
        path: "tracker.map.plan_only",
        message: expect.stringMatching(/^Unknown field 'plan_only'/),
      },
      {
        event: "opentp.cli.yaml",
        path: "tracker.map.app_only",
        message: expect.stringMatching(/^Unknown field 'app_only'/),
      },
      {
        event: label,
        path: "tracker.targets.ios.contexts",
        message: "'contexts' is only allowed for tracker type snowplow",
      },
    ];

    expect(await main(["validate", "--json", "--root", app])).toBe(EXIT_FAILURE);
    const report = JSON.parse(stdout.join(""));
    expect(report.errors).toHaveLength(expected.length);
    expect(report.errors).toEqual(
      expect.arrayContaining(expected.map((error) => expect.objectContaining(error))),
    );

    stdout = [];
    stderr = [];
    expect(await main(["validate", "--root", app])).toBe(EXIT_FAILURE);
    const text = [...stdout, ...stderr].join("\n");
    expect(text).toContain(`[${label}]`);
    expect(text).toContain("[opentp.cli.yaml]");

    // generate refuses with the same labels; MCP validate_plan lists them
    stdout = [];
    stderr = [];
    expect(await main(["generate", "json", "--root", app])).toBe(EXIT_FAILURE);
    expect(stderr.join("\n")).toContain(`[${label}]`);
    const snapshot = await new PlanStore(app).current();
    const result = await validatePlan(snapshot, {});
    expect(result.errors).toEqual(
      expect.arrayContaining(
        expected.map(({ event, ...rest }) => expect.objectContaining({ file: event, ...rest })),
      ),
    );

    // An application that names another type replaces the plan repository's section: all its own
    stdout = [];
    editYaml(appFile(app), (cli) => {
      cli.tracker = { type: "amplitude", event: "iglu:com.acme/event/jsonschema/1-0-0" };
    });
    expect(await main(["validate", "--json", "--root", app])).toBe(EXIT_FAILURE);
    expect(JSON.parse(stdout.join("")).errors).toEqual([
      expect.objectContaining({ event: "opentp.cli.yaml", path: "tracker.event" }),
    ]);
  });

  it("resolves plan: against the file given with --cli-config", async () => {
    const { app } = workspace();
    const ci = path.join(app, "ci");
    fs.mkdirSync(ci);
    fs.renameSync(appFile(app), path.join(ci, "app.cli.yaml"));
    editYaml(path.join(ci, "app.cli.yaml"), (cli) => {
      cli.plan = "../../tracker";
    });
    expect(
      await main(["validate", "--root", app, "--cli-config", path.join(ci, "app.cli.yaml")]),
    ).toBe(EXIT_OK);
    expect(stderr).toEqual(["✓ All events are valid count=2"]);
  });

  it("skips key checks and warns once about keygen in the application file", async () => {
    const { app, plan } = workspace();
    editYaml(appFile(app), (cli) => {
      cli.keygen = { template: "{area}::{event}" };
    });
    // A key that the plan repository's keygen rejects, and a key that its constraints reject
    const login = path.join(plan, "events/auth/login.yaml");
    fs.writeFileSync(login, fs.readFileSync(login, "utf8").replace("auth::login", "Wrong Key"));
    editYaml(path.join(plan, "opentp.yaml"), (config) => {
      config.spec.events.key = { pattern: "^[a-z:_]+$" };
    });
    expect(await main(["validate", "--root", plan])).toBe(EXIT_FAILURE);

    stdout = [];
    stderr = [];
    expect(await main(["validate", "--json", "--root", app])).toBe(EXIT_OK);
    expect(JSON.parse(stdout.join(""))).toMatchObject({ success: true, events: 2, errors: [] });
    expect(stderr.filter((line) => line.includes("keygen is ignored"))).toEqual([
      `⚠ ${keygenIgnoredWarning()}`,
    ]);
  });

  it("refuses fix and migrate (exit 2) and writes nothing", async () => {
    const { app, plan } = workspace();
    const before = snapshotFiles(plan);
    for (const args of [["fix"], ["validate", "--fix"], ["migrate"], ["migrate", "--check"]]) {
      stderr = [];
      expect(await main([...args, "--root", app])).toBe(EXIT_USAGE);
      const command = args[0] === "migrate" ? "migrate" : "fix";
      expect(stderr).toEqual([
        `✗ ${command} edits the plan repository; run it there (opentp.cli.yaml has plan:)`,
      ]);
    }
    expect(snapshotFiles(plan)).toEqual(before);
    expect(stdout).toEqual([]);
  });

  it("refuses opentp.yaml next to plan: (exit 2)", async () => {
    const { app } = workspace();
    fs.copyFileSync(path.join(TRACKER, "opentp.yaml"), path.join(app, "opentp.yaml"));
    for (const command of ["validate", "generate"]) {
      stderr = [];
      expect(await main([command, "--root", app])).toBe(EXIT_USAGE);
      expect(stderr).toEqual([`✗ ${planWithConfigMessage()}`]);
    }
  });

  it("gives the 2026-01 guidance for a pinned plan before comparing headers", async () => {
    const { app, plan } = workspace();
    editYaml(path.join(plan, "opentp.yaml"), (config) => {
      config.opentp = "2026-01";
    });
    expect(await main(["validate", "--root", app])).toBe(EXIT_USAGE);
    const output = stderr.join("\n");
    expect(output).toContain(
      `✗ The pinned plan ../tracker uses OpenTrackPlan 2026-01; opentp ${VERSION} reads 2026-09. Pin a plan ref that is on 2026-09 (or keep opentp 0.9.1: OPENTP_VERSION=0.9.1).`,
    );
    expect(output).not.toContain("does not match");
    expect(output).not.toContain('Run "opentp migrate"');
  });

  it("asks for another plan ref, not for migrate, when a file of the pinned plan is on 2026-01", async () => {
    const { app, plan } = workspace();
    const login = path.join(plan, "events/auth/login.yaml");
    fs.writeFileSync(login, fs.readFileSync(login, "utf8").replace("2026-09", "2026-01"));
    const pinned =
      "Unsupported OpenTrackPlan schema version '2026-01'. Expected '2026-09'. Pin a plan ref whose files are all on 2026-09.";

    expect(await main(["validate", "--root", app])).toBe(EXIT_FAILURE);
    expect(stdout.join("\n")).toContain(`✗ opentp: ${pinned}`);
    expect(stdout.join("\n")).not.toContain("opentp migrate");
    const snapshot = await new PlanStore(app).current();
    expect(JSON.stringify(await validatePlan(snapshot, {}))).toContain(pinned);

    // In the plan repository itself, migrate is the way
    stdout = [];
    expect(await main(["validate", "--root", plan])).toBe(EXIT_FAILURE);
    expect(stdout.join("\n")).toContain('Run "opentp migrate" to upgrade it.');
  });

  it("runs generate.run entries with outputs relative to the application file; -o relative to --root", async () => {
    const { app, plan } = workspace();
    const before = snapshotFiles(plan);
    expect(await main(["generate", "--root", app])).toBe(EXIT_OK);
    const run = JSON.parse(fs.readFileSync(path.join(app, "build/tracking-plan.json"), "utf8"));
    // target web, events { area: auth }
    expect(run.events.map((event: { key: string }) => event.key)).toEqual(["auth::login"]);
    expect(Object.keys(run.events[0].effectivePayload)).toEqual(["web", "ios", "android"]);

    expect(await main(["generate", "json", "-o", "out/plan.json", "--root", app])).toBe(EXIT_OK);
    const all = JSON.parse(fs.readFileSync(path.join(app, "out/plan.json"), "utf8"));
    expect(all.events.map((event: { key: string }) => event.key)).toEqual([
      "auth::login",
      "onboarding::step_view",
    ]);
    // Nothing is written into the plan
    expect(snapshotFiles(plan)).toEqual(before);
  });

  it("gives generators the merged settings and the merged tracker binding", async () => {
    expect(await main(["generate", "application-probe", "--root", APPLICATION])).toBe(EXIT_OK);
    expect(probed).toHaveLength(1);
    const [context] = probed;
    expect(Object.isFrozen(context.cliConfig)).toBe(true);
    expect(Object.isFrozen(context.cliConfig?.tracker)).toBe(true);
    expect(context.cliConfig).not.toHaveProperty("keygen");
    expect(context.cliConfig?.checks).toEqual({ severity: { overlap: "error" } });
    // From the application file
    expect(context.tracker?.web.fields.step_index).toEqual({
      path: "contexts.dimensions.step_index",
      segments: ["contexts", "dimensions", "step_index"],
    });
    // From the plan repository's file
    expect(context.tracker?.web.fields.application_id).toEqual({
      path: "atomic.app_id",
      segments: ["atomic", "app_id"],
      setBy: "app",
    });
    expect(context.tracker?.ios.contexts).toHaveProperty("mobile_context");
    const login = context.events.find((event) => event.key === "auth::login");
    expect(login && context.effective(login).web.fields.event_name).toEqual({
      type: "string",
      policy: "fixed",
      value: "login",
    });
  });

  it("never runs plugins named by the plan repository", async () => {
    const { app, plan } = workspace();
    const id = Math.random().toString(36).slice(2);
    const markers = path.join(tempDir(), "markers");
    fs.mkdirSync(markers);
    const plugin = (section: string, body: string) => {
      const dir = path.join(plan, section, `marker-${id}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "index.js"),
        `require("node:fs").writeFileSync(${JSON.stringify(path.join(markers, section))}, "loaded");\nmodule.exports = ${body};\n`,
      );
    };
    plugin("checks", `{ name: "marker-check-${id}", validate: () => ({ valid: true }) }`);
    plugin("transforms", `{ name: "marker-step-${id}", factory: () => (value) => value }`);
    plugin("generators", `{ name: "marker-generator-${id}", generate: () => ({ stdout: "" }) }`);
    editYaml(appFile(plan), (cli) => {
      cli.keygen.plugins = ["./transforms"];
      // A binding to a rule of the plan repository's plugin
      cli.checks = { plugins: ["./checks"], bindings: { marker: { rule: `marker-check-${id}` } } };
      cli.generate = { plugins: ["./generators"] };
    });

    expect(await main(["validate", "--allow-plugins", "--root", app])).toBe(EXIT_OK);
    expect(stderr).toContain(
      "⚠ opentp.cli.yaml of the plan '../tracker' names plugins (./transforms, ./checks, ./generators); plugins of the plan repository never run in an application repository (checks bound to their rules count as unknown checks)",
    );
    expect(await main(["generate", "json", "--allow-plugins", "--root", app])).toBe(EXIT_OK);
    expect(fs.readdirSync(markers)).toEqual([]);
    const snapshot = await new PlanStore(app).current();
    expect(snapshot.cli?.application?.planPlugins).toEqual([
      "./transforms",
      "./checks",
      "./generators",
    ]);
    expect(fs.readdirSync(markers)).toEqual([]);

    // The same plugins load in the plan repository itself (so the markers work)
    expect(await main(["validate", "--allow-plugins", "--root", plan])).toBe(EXIT_OK);
    expect(fs.readdirSync(markers).sort()).toEqual(["checks", "transforms"]);
  });

  it("never runs webhook bindings of the plan repository: their ids are unknown checks", async () => {
    const { app, plan } = workspace();
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, status: 200 }) as Response);
    const fetched = () => [...new Set(fetchMock.mock.calls.map(([url]) => url))].sort();
    // A webhook header that reads an allowed variable
    const authorization = { Authorization: ["Bearer $", "{APP_TOKEN}"].join("") };
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("OPENTP_WEBHOOK_ENV", "APP_TOKEN");
    vi.stubEnv("APP_TOKEN", "app-secret");
    editYaml(appFile(plan), (cli) => {
      cli.checks = {
        bindings: {
          collect: {
            webhook: {
              url: "https://plan.example.com/collect",
              headers: authorization,
            },
          },
          shared: { webhook: { url: "https://plan.example.com/shared" } },
          short: { rule: "min-length", params: 2 },
        },
      };
    });
    // The application binds `shared` itself: its binding wins and runs
    editYaml(appFile(app), (cli) => {
      cli.checks.bindings = {
        shared: {
          webhook: {
            url: "https://app.example.com/check",
            headers: authorization,
          },
        },
      };
    });
    editYaml(path.join(plan, "events/auth/login.yaml"), (event) => {
      event.event.payload.schema.event_name.checks = { collect: true, shared: true, short: true };
    });

    expect(await main(["validate", "--root", app])).toBe(EXIT_OK);
    // Once per target the event covers, always the application's binding
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetched()).toEqual(["https://app.example.com/check"]);
    expect(stderr).toContain(
      "⚠ opentp.cli.yaml of the plan '../tracker' names webhook bindings (collect); webhook bindings of the plan repository never run in an application repository (checks bound to them count as unknown checks)",
    );
    expect(stdout.join("\n")).toContain(
      "⚠ payload.schema.event_name.checks.collect: Unknown check 'collect': its webhook binding comes from the plan repository's opentp.cli.yaml and is not run in an application repository",
    );
    const snapshot = await new PlanStore(app).current();
    expect(snapshot.cli?.application?.planWebhooks).toEqual(["collect"]);
    expect(snapshot.cli?.config.checks?.bindings).not.toHaveProperty("collect");
    const validation = await validatePlan(snapshot, {});
    expect(JSON.stringify(validation)).toContain(
      "its webhook binding comes from the plan repository",
    );
    expect(fetched()).toEqual(["https://app.example.com/check"]);

    // In the plan repository itself, its webhook bindings run
    fetchMock.mockClear();
    expect(await main(["validate", "--root", plan])).toBe(EXIT_OK);
    expect(fetched()).toEqual([
      "https://plan.example.com/collect",
      "https://plan.example.com/shared",
    ]);
  });

  it("clones a git plan once into OPENTP_CACHE_DIR and reuses it without the repository", async () => {
    const repository = gitPlan();
    const cache = tempDir();
    vi.stubEnv(CACHE_DIR_ENV, cache);
    const { app } = workspace();
    editYaml(appFile(app), (cli) => {
      cli.plan = `${repository.url}#v1.0.0`;
    });
    expect(await main(["validate", "--root", app])).toBe(EXIT_OK);
    expect(stderr.at(-1)).toBe("✓ All events are valid count=2");
    expect(stderr[0]).toMatch(/^Fetching the plan file:\/\//);
    expect(fs.readdirSync(path.join(cache, "plans"))).toHaveLength(1);

    fs.rmSync(repository.dir, { recursive: true, force: true });
    stderr = [];
    expect(await main(["validate", "--root", app])).toBe(EXIT_OK);
    expect(stderr).toEqual(["✓ All events are valid count=2"]);
  });

  it("rejects a branch as the plan ref (exit 2)", async () => {
    const repository = gitPlan();
    vi.stubEnv(CACHE_DIR_ENV, tempDir());
    const { app } = workspace();
    editYaml(appFile(app), (cli) => {
      cli.plan = `${repository.url}#${repository.branch}`;
    });
    expect(await main(["validate", "--root", app])).toBe(EXIT_USAGE);
    expect(stderr).toEqual([
      `✗ opentp.cli.yaml: plan: plan ref must be a tag or a commit SHA: '${repository.branch}' is not a tag of ${pathToFileURL(repository.dir).href}`,
    ]);
  });

  it("never prints credentials of the plan URL (logs, errors, labels, describe_plan)", async () => {
    const secret = "ghp_SECRETTOKEN";
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const plan = `git+https://user:${secret}@example.com/acme/plan.git#${sha}`;
    const shown = `git+https://***@example.com/acme/plan.git#${sha}`;
    const cache = tempDir();
    vi.stubEnv(CACHE_DIR_ENV, cache);
    const { app } = workspace();
    editYaml(appFile(app), (cli) => {
      cli.plan = plan;
    });

    // Not cached yet: the fetch is logged, and git fails (nothing listens on the port)
    const unreachable = `git+https://user:${secret}@127.0.0.1:1/plan.git#${sha}`;
    editYaml(appFile(app), (cli) => {
      cli.plan = unreachable;
    });
    vi.stubEnv("NO_PROXY", "*");
    vi.stubEnv("no_proxy", "*");
    expect(await main(["validate", "--root", app])).toBe(EXIT_USAGE);
    expect(stderr[0]).toMatch(/^Fetching the plan https:\/\/\*\*\*@127\.0\.0\.1:1\/plan\.git ref=/);
    expect(stderr.join("\n")).toMatch(/✗ opentp\.cli\.yaml: plan: git fetch https:\/\/\*\*\*@127/);
    expect(stderr.join("\n")).not.toContain(secret);

    // A clone without opentp.yaml (a fake git that fetches nothing)
    const empty: GitRunner = (args) => {
      if (args[0] === "init") fs.mkdirSync(args[2] as string, { recursive: true });
      return { status: 0, stdout: args.includes("rev-parse") ? `${sha}\n` : "", stderr: "" };
    };
    editYaml(appFile(app), (cli) => {
      cli.plan = plan;
    });
    const lines = errorLines(() => openApplication(appFile(app), app, { git: empty }));
    expect(lines).toEqual([
      expect.stringMatching(
        new RegExp(
          `^opentp\\.cli\\.yaml: plan: no opentp\\.yaml in .* \\(https://\\*\\*\\*@example\\.com/acme/plan\\.git#${sha}\\)$`,
        ),
      ),
    ]);
    fs.rmSync(path.join(cache, "plans"), { recursive: true, force: true });

    // The plan in the cache: validate, describe_plan, and the labels of problems
    const source = parsePlanSource(plan, app);
    if (source.kind !== "git") throw new Error("expected a git plan");
    const cached = planCacheDir(cache, source);
    fs.cpSync(TRACKER, cached, { recursive: true });
    stderr = [];
    expect(await main(["validate", "--root", app])).toBe(EXIT_OK);
    expect(describePlan(await new PlanStore(app).current()).pinnedPlan).toBe(shown);

    editYaml(appFile(cached), (cli) => {
      cli.opentp = "2026-08";
    });
    expect(await main(["validate", "--root", app])).toBe(EXIT_USAGE);
    expect(stderr.at(-1)).toBe(
      `✗ opentp.cli.yaml of the plan '${shown}': opentp: '2026-08' does not match the plan's opentp '2026-09' (opentp.yaml)`,
    );
    editYaml(path.join(cached, "opentp.yaml"), (config) => {
      config.opentp = "2026-01";
    });
    expect(await main(["validate", "--root", app])).toBe(EXIT_USAGE);
    expect(stderr.at(-1)).toContain(`✗ The pinned plan ${shown} uses OpenTrackPlan 2026-01`);
    expect(stderr.join("\n")).not.toContain(secret);
  });

  it.each([
    [
      "opentp.cli.yaml next to opentp.cli.yml",
      (app: string) => {
        fs.copyFileSync(appFile(app), path.join(app, "opentp.cli.yml"));
        return [`✗ Both opentp.cli.yaml and opentp.cli.yml exist in ${app}; keep one`];
      },
    ],
    [
      "a YAML syntax error",
      (app: string) => {
        fs.writeFileSync(appFile(app), "opentp: 2026-09\nplan: [../tracker\n");
        return [
          expect.stringMatching(/^✗ opentp\.cli\.yaml: Invalid YAML at line \d+, column \d+: /),
        ];
      },
    ],
    [
      "a file that is not a mapping",
      (app: string) => {
        fs.writeFileSync(appFile(app), "- plan: ../tracker\n");
        return ["✗ opentp.cli.yaml: expected a mapping with 'opentp'"];
      },
    ],
  ])("reports opentp.cli.yaml problems, not 'opentp.yaml not found', without opentp.yaml: %s", async (_, breakFile) => {
    const { app } = workspace();
    const expected = breakFile(app);
    for (const command of [["validate"], ["fix"], ["validate", "--fix"], ["generate"], ["mcp"]]) {
      stderr = [];
      expect(await main([...command, "--root", app]), command.join(" ")).toBe(EXIT_USAGE);
      expect(stderr, command.join(" ")).toEqual(expected);
    }
    const error = await new PlanStore(app).current().then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(PlanError);
    expect((error as PlanError).message).toMatch(/opentp\.cli\.ya?ml/);
    expect((error as PlanError).message).not.toContain("opentp.yaml not found");
  });

  it("reports a missing --cli-config file when the root has no opentp.yaml", async () => {
    const { app } = workspace();
    const missing = path.join(app, "missing.cli.yaml");
    for (const command of ["validate", "fix", "generate", "mcp"]) {
      stderr = [];
      expect(await main([command, "--root", app, "--cli-config", missing])).toBe(EXIT_USAGE);
      expect(stderr).toEqual([`✗ --cli-config: file not found: ${missing}`]);
    }
    await expect(new PlanStore(app, { cliConfigPath: missing }).current()).rejects.toThrow(
      `--cli-config: file not found: ${missing}`,
    );
    // A plan repository's file without plan: still points to the missing opentp.yaml
    fs.writeFileSync(appFile(app), "opentp: 2026-09\n");
    stderr = [];
    expect(await main(["validate", "--root", app])).toBe(EXIT_USAGE);
    expect(stderr).toEqual([`✗ opentp.yaml not found root="${app}"`]);
  });

  it("opentp mcp exits 2 when the plan cannot be found", async () => {
    const { app } = workspace();
    editYaml(appFile(app), (cli) => {
      cli.plan = "../missing-plan";
    });
    expect(await main(["mcp", "--root", app])).toBe(EXIT_USAGE);
    expect(stderr).toEqual([
      `✗ opentp.cli.yaml: plan: directory not found: ${path.join(path.dirname(app), "missing-plan")}`,
    ]);
  });
});

describe("opentp mcp in an application repository", () => {
  it("serves the pinned plan with the merged settings and no key checks", async () => {
    const { app, plan } = workspace();
    const login = path.join(plan, "events/auth/login.yaml");
    fs.writeFileSync(login, fs.readFileSync(login, "utf8").replace("auth::login", "auth::other"));
    const snapshot = await new PlanStore(app).current();
    expect(snapshot.root).toBe(plan);
    expect(snapshot.keyChecks).toBe(false);
    const description = describePlan(snapshot);
    expect(description.pinnedPlan).toBe("../tracker");
    expect(description.eventsRoot).toBe("events");
    expect(description.key.keygen).toBe(false);
    expect(description.tracker?.web.fields.step_index).toEqual({
      path: "contexts.dimensions.step_index",
      segments: ["contexts", "dimensions", "step_index"],
    });
    expect(await validatePlan(snapshot, {})).toMatchObject({ valid: true, eventCount: 2 });
    // generate.run entries of the application file, never written
    const result = await generate(snapshot, { run: 0 });
    expect(result).toMatchObject({ generator: "json", run: 0, eventCount: 1 });
    expect(fs.existsSync(path.join(app, "build"))).toBe(false);
  });

  it("reloads when the plan changes, and reports a plan that cannot be found", async () => {
    const { app, plan } = workspace();
    const store = new PlanStore(app);
    const first = await store.current();
    expect(await store.current()).toBe(first);

    // An unknown field in a plan event (the plan's files are watched)
    editYaml(path.join(plan, "events/auth/login.yaml"), (event) => {
      event.event.payload.schema.nope = {};
    });
    const second = await store.current();
    expect(second).not.toBe(first);
    expect((await validatePlan(second, {})).valid).toBe(false);

    // The plan repository's opentp.cli.yaml is watched too
    editYaml(appFile(plan), (cli) => {
      cli.opentp = "2026-08";
    });
    await expect(store.current()).rejects.toThrow(PlanError);

    editYaml(appFile(app), (cli) => {
      cli.plan = "../missing-plan";
    });
    await expect(store.current()).rejects.toThrow(
      `opentp.cli.yaml: plan: directory not found: ${path.join(path.dirname(app), "missing-plan")}`,
    );
  });

  it("returns the 2026-01 guidance of a pinned plan from every tool", async () => {
    const { app, plan } = workspace();
    editYaml(path.join(plan, "opentp.yaml"), (config) => {
      config.opentp = "2026-01";
    });
    await expect(new PlanStore(app).current()).rejects.toThrow(
      "The pinned plan ../tracker uses OpenTrackPlan 2026-01",
    );
  });
});
