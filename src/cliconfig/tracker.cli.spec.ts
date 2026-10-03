/**
 * The tracker binding through the CLI and MCP, on tests/data/tracker: validate, fix and generate
 * treat its problems like keygen problems (validation errors against opentp.cli.yaml), generators get
 * the resolved binding, and describe_plan shows it.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, main } from "../cli";
import { registerGenerator } from "../generators";
import { PlanStore } from "../mcp/plan";
import { describePlan, generate, ToolError, validatePlan } from "../mcp/tools";
import { setLogLevel } from "../util/logger";
import type { TrackerBinding } from "./tracker";

/** A field binding whose path has only plain segments */
function bound(path: string, setBy?: "app" | "tracker") {
  const segments = path.split(".");
  return setBy === undefined ? { path, segments } : { path, segments, setBy };
}

const FIXTURE = path.resolve("tests/data/tracker");
const EVENT_URI = "iglu:com.acme/event/jsonschema/1-0-0";
const DIMENSIONS_URI = "iglu:com.acme/dimensions/jsonschema/1-0-0";
const MOBILE_URI = "iglu:com.acme/mobile_context/jsonschema/1-0-0";

/** Every field of the fixture on web (catalog + spec.targets.all) */
const WEB_FIELDS = {
  application_id: bound("atomic.app_id", "app"),
  auth_method: bound("event.auth_method"),
  device_is_webview: bound("event.device_is_webview"),
  dimension_1: bound("contexts.dimensions.dimension_1"),
  dimension_2: bound("contexts.dimensions.dimension_2"),
  event_name: bound("event.event_name"),
  platform: bound("atomic.platform", "tracker"),
  step_index: bound("event.step_index"),
  user_id: bound("atomic.user_id", "app"),
};

const EXPECTED_BINDING: TrackerBinding = {
  web: {
    type: "snowplow",
    event: EVENT_URI,
    contexts: { dimensions: DIMENSIONS_URI },
    fields: WEB_FIELDS as TrackerBinding[string]["fields"],
  },
  ios: {
    type: "snowplow",
    event: EVENT_URI,
    contexts: { dimensions: DIMENSIONS_URI, mobile_context: MOBILE_URI },
    fields: {
      ...(WEB_FIELDS as TrackerBinding[string]["fields"]),
      device_is_webview: bound("contexts.mobile_context.isWebview"),
      os_version: bound("contexts.mobile_context.os_version"),
    },
  },
  android: {
    type: "snowplow",
    event: EVENT_URI,
    contexts: { dimensions: DIMENSIONS_URI, mobile_context: MOBILE_URI },
    fields: {
      ...(WEB_FIELDS as TrackerBinding[string]["fields"]),
      device_is_webview: bound("contexts.mobile_context.isWebview"),
    },
  },
};

/** Problems that a broken tracker section gives (see `breakTracker`) */
const BROKEN_ERRORS = [
  {
    event: "opentp.cli.yaml",
    path: "tracker.map.usr_id",
    message:
      "Unknown field 'usr_id': expected a catalog field (spec.events.payload.schema) or a common field (spec.targets). Did you mean 'user_id'?",
    severity: "error",
  },
  {
    event: "opentp.cli.yaml",
    path: "tracker.targets.android.map.device_is_webview",
    message:
      "Context alias 'mobile' is not declared in tracker.contexts or tracker.targets.android.contexts",
    severity: "error",
  },
];

let probed: unknown[] = [];
registerGenerator({
  name: "tracker-probe",
  generate: (context) => {
    probed.push(context.tracker);
    return { stdout: "" };
  },
});

const tempDirs: string[] = [];

function planCopy(source = FIXTURE): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opentp-tracker-cli-"));
  tempDirs.push(dir);
  fs.cpSync(source, dir, { recursive: true });
  return dir;
}

function editCliConfig(root: string, change: (document: any) => void): void {
  const file = path.join(root, "opentp.cli.yaml");
  const document = parse(fs.readFileSync(file, "utf8"));
  change(document);
  fs.writeFileSync(file, stringify(document));
}

/** A copy with an unknown field in tracker.map and an undeclared alias for android */
function brokenCopy(): string {
  const root = planCopy();
  editCliConfig(root, (cli) => {
    cli.tracker.map.usr_id = "atomic.user_id";
    cli.tracker.targets.android.map.device_is_webview = "contexts.mobile.isWebview";
  });
  return root;
}

afterAll(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("opentp with a tracker section", () => {
  let stdout: string[];
  let stderr: string[];

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
  });

  it("validates tests/data/tracker without errors", async () => {
    expect(await main(["validate", "--root", FIXTURE])).toBe(EXIT_OK);
    expect(stderr).toEqual(["✓ All events are valid count=2"]);
    expect(stdout).toEqual([]);
  });

  it("gives generators the resolved binding per target (null without a tracker section)", async () => {
    expect(await main(["generate", "tracker-probe", "--root", FIXTURE])).toBe(EXIT_OK);
    expect(probed).toEqual([EXPECTED_BINDING]);

    probed = [];
    const root = planCopy();
    editCliConfig(root, (cli) => {
      delete cli.tracker;
    });
    expect(await main(["generate", "tracker-probe", "--root", root])).toBe(EXIT_OK);
    expect(probed).toEqual([null]);
  });

  it("reports tracker problems as validation errors against opentp.cli.yaml (exit 1)", async () => {
    const root = brokenCopy();
    expect(await main(["validate", "--json", "--root", root])).toBe(EXIT_FAILURE);
    const report = JSON.parse(stdout.join(""));
    expect(report.errors).toEqual(BROKEN_ERRORS);
  });

  it("fix rewrites nothing while the tracker section has problems", async () => {
    const root = brokenCopy();
    const file = path.join(root, "events", "auth", "login.yaml");
    const broken = fs.readFileSync(file, "utf8").replace("key: auth::login", "key: wrong_key");
    fs.writeFileSync(file, broken);
    expect(await main(["fix", "--root", root])).toBe(EXIT_FAILURE);
    expect(fs.readFileSync(file, "utf8")).toBe(broken);
    expect(stderr).toContain(
      "✗ Event keys were not fixed: tracker in opentp.cli.yaml has problems",
    );

    // The same copy with a usable tracker section is fixed
    editCliConfig(root, (cli) => {
      delete cli.tracker.map.usr_id;
      cli.tracker.targets.android.map.device_is_webview = "contexts.mobile_context.isWebview";
    });
    expect(await main(["fix", "--root", root])).toBe(EXIT_OK);
    expect(fs.readFileSync(file, "utf8")).toContain("key: auth::login");
  });

  it("generate refuses while the tracker section has problems: exit 1, nothing on stdout", async () => {
    const root = brokenCopy();
    expect(await main(["generate", "tracker-probe", "--root", root])).toBe(EXIT_FAILURE);
    expect(await main(["generate", "json", "--root", root])).toBe(EXIT_FAILURE);
    expect(probed).toEqual([]);
    expect(stdout).toEqual([]);
    expect(stderr.join("\n")).toContain("tracker.map.usr_id: Unknown field 'usr_id'");
  });

  it("stops every command on a wrong shape (exit 2)", async () => {
    const root = planCopy();
    editCliConfig(root, (cli) => {
      cli.tracker.type = "mixpanel";
    });
    expect(await main(["validate", "--root", root])).toBe(EXIT_USAGE);
    expect(stderr).toContain(
      "✗ opentp.cli.yaml: tracker.type: Expected type snowplow, ga4, amplitude, segment or generic",
    );
    expect(await main(["generate", "json", "--root", root])).toBe(EXIT_USAGE);
  });

  it("reports event and contexts on a non-snowplow type as validation errors (exit 1)", async () => {
    const root = planCopy();
    editCliConfig(root, (cli) => {
      cli.tracker = {
        type: "ga4",
        event: EVENT_URI,
        contexts: { dimensions: DIMENSIONS_URI },
        targets: { ios: { contexts: { mobile_context: MOBILE_URI } } },
      };
    });
    expect(await main(["validate", "--json", "--root", root])).toBe(EXIT_FAILURE);
    const report = JSON.parse(stdout.join(""));
    expect(
      report.errors.filter((error: { event: string }) => error.event === "opentp.cli.yaml"),
    ).toEqual([
      {
        event: "opentp.cli.yaml",
        path: "tracker.event",
        message: "'event' is only allowed for tracker type snowplow",
        severity: "error",
      },
      {
        event: "opentp.cli.yaml",
        path: "tracker.contexts",
        message: "'contexts' is only allowed for tracker type snowplow",
        severity: "error",
      },
      {
        event: "opentp.cli.yaml",
        path: "tracker.targets.ios.contexts",
        message: "'contexts' is only allowed for tracker type snowplow",
        severity: "error",
      },
    ]);
    // MCP starts and lists them
    const plan = await new PlanStore(root).current();
    expect((await validatePlan(plan, {})).errors.map((error) => error.path)).toEqual([
      "tracker.event",
      "tracker.contexts",
      "tracker.targets.ios.contexts",
    ]);
  });
});

describe("opentp mcp with a tracker section", () => {
  it("describe_plan shows the resolved binding (null without a tracker section)", async () => {
    const plan = await new PlanStore(FIXTURE).current();
    expect(describePlan(plan).tracker).toEqual(EXPECTED_BINDING);

    const root = planCopy();
    editCliConfig(root, (cli) => {
      delete cli.tracker;
    });
    expect(describePlan(await new PlanStore(root).current()).tracker).toBeNull();
  });

  it("validate_plan lists tracker problems and generate refuses", async () => {
    const plan = await new PlanStore(brokenCopy()).current();
    const result = await validatePlan(plan, {});
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      BROKEN_ERRORS.map(({ event, path: errorPath, message }) => ({
        file: event,
        path: errorPath,
        message,
      })),
    );
    expect(describePlan(plan).counts.loadProblems).toBe(2);
    await expect(generate(plan, { generator: "json" })).rejects.toThrow(ToolError);
  });
});
