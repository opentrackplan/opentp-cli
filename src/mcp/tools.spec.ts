import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { PlanError, type PlanSnapshot, PlanStore } from "./plan";
import {
  describePlan,
  generate,
  getDictionary,
  getEvent,
  listDictionaries,
  searchEvents,
  suggestEvent,
  ToolError,
  validateEventDraft,
  validatePlan,
} from "./tools";

const FIXTURE = path.resolve("tests/data/coverage-valid");
const INVALID_FIXTURE = path.resolve("tests/data/coverage-invalid");
const LOGIN_KEY = "auth::login_button_click::click::login_button::p2::internal-false";
const LOGIN_FILE = "auth/2/false/login_button_click.yaml";
const ONBOARDING_KEY =
  "onboarding::onboarding_step_complete::complete::onboarding_step::p1::internal-true";

const LOGIN_TAXONOMY = {
  area: "auth",
  priority_level: 2,
  is_internal: false,
  event: "login_button_click",
  action: "User clicks the login button",
  action_detail: "click::login button",
  custom_id: "cid_login_button",
};

let plan: PlanSnapshot;
const tempDirs: string[] = [];

function planCopy(source = FIXTURE): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opentp-mcp-"));
  tempDirs.push(dir);
  fs.cpSync(source, dir, { recursive: true });
  return dir;
}

/** Edits a YAML file of a plan copy */
function editYaml(file: string, change: (document: any) => void): void {
  const document = parse(fs.readFileSync(file, "utf8"));
  change(document);
  fs.writeFileSync(file, stringify(document));
}

beforeAll(async () => {
  plan = await new PlanStore(FIXTURE).current();
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("describePlan", () => {
  it("describes taxonomy, paths, keys, targets and counts", () => {
    const description = describePlan(plan);
    expect(description.title).toBe("Coverage Fixture (Valid)");
    expect(description.opentp).toBe("2026-09");
    expect(description.eventsRoot).toBe("events");
    expect(description.pathTemplate).toBe("{area}/{priority_level}/{is_internal}/{event}.yaml");
    expect(description.taxonomy.area).toMatchObject({ fromPath: true, dict: "taxonomy/areas" });
    expect(description.taxonomy.action).toMatchObject({ fromPath: false, required: true });
    // keygen comes from opentp.cli.yaml
    expect(description.key.keygenTemplate).toContain("{area | slug}");
    expect(description.checks).toHaveProperty("jira-key.pattern");
    expect(description.targets).toEqual({
      all: ["web", "ios", "android"],
      mobile: ["ios", "android"],
    });
    expect(description.counts).toEqual({ events: 4, dictionaries: 5, loadProblems: 0 });
  });

  it("describes the catalog, the common fields per target with their policy, and keygen", () => {
    const description = describePlan(plan);
    expect(description).not.toHaveProperty("baseSchema");
    expect(description).not.toHaveProperty("targetSchemas");
    expect(description).not.toHaveProperty("pinnedPlan");
    expect(Object.keys(description.catalog)).toEqual([
      "dimension_1",
      "auth_method",
      "plan_tier",
      "user_id",
      "device_model",
      "step_index",
      "is_internal",
      "priority_level",
      "tags",
    ]);
    expect(description.catalog.dimension_1).toMatchObject({ type: "string", name: "orgType" });
    // Common fields of every target, merged over the catalog, with their policy
    expect(Object.keys(description.commonFields)).toEqual(["web", "ios", "android"]);
    expect(Object.keys(description.commonFields.web)).toEqual([
      "application_id",
      "event_name",
      "event_category",
      "build_variant",
    ]);
    expect(description.commonFields.web.application_id).toMatchObject({
      type: "string",
      dict: "data/application_id",
      policy: "fixed",
    });
    expect(description.commonFields.web.event_category).toMatchObject({ policy: "restricted" });
    // A catalog field that spec.targets.ios makes common: its type comes from the catalog
    expect(description.commonFields.ios.device_model).toEqual({
      type: "string",
      description: "Model identifier reported by iOS",
      policy: "specified",
    });
    expect(description.commonFields.android).not.toHaveProperty("device_model");
    // spec.targets settings besides the fields
    expect(description.targetSettings).toEqual({
      all: { title: "Every target", description: "Fields that every event sends on every target" },
      ios: { title: "iOS", "x-acme-team": "mobile" },
    });
    expect(description.key).toMatchObject({ keygen: true });
    expect(description.tracker).toBeNull();
  });
});

describe("searchEvents", () => {
  it("finds events by words from their taxonomy and payload", () => {
    expect(searchEvents(plan, { query: "login button" }).results[0]?.key).toBe(LOGIN_KEY);
    expect(searchEvents(plan, { query: "onboarding step" }).results[0]?.key).toBe(ONBOARDING_KEY);
    expect(searchEvents(plan, { query: "github experiment" }).results[0]?.key).toBe(
      "auth::login_experiment::experiment::login::p3::internal-false",
    );
  });

  it("puts the event first when the query is its whole key", () => {
    const result = searchEvents(plan, { query: ` ${LOGIN_KEY} `, limit: 2 });
    expect(result.results[0]).toMatchObject({ key: LOGIN_KEY, exactKeyMatch: true });
    expect(result.results).toHaveLength(2);
    expect(result.results.filter((hit) => hit.key === LOGIN_KEY)).toHaveLength(1);
  });

  it("returns project-relative files and respects the limit", () => {
    const result = searchEvents(plan, { query: "auth", limit: 2 });
    expect(result.results).toHaveLength(2);
    expect(result.eventCount).toBe(4);
    expect(result.results[0]?.file).toMatch(/^events\/auth\//);
  });
});

describe("getEvent", () => {
  it("merges common fields and groups targets with the same effective schema", () => {
    const event = getEvent(plan, { key: LOGIN_KEY });
    expect(event.file).toBe(`events/${LOGIN_FILE}`);
    expect(event.taxonomy).toMatchObject({ area: "auth", priority_level: 2, is_internal: false });
    // spec.targets.ios adds to device_model, so ios differs from web and android
    const groups = event.payload.map((group) => group.targets.sort());
    expect(groups).toEqual(expect.arrayContaining([["android", "web"], ["ios"]]));
    const web = event.payload.find((group) => group.targets.includes("web"));
    expect(web?.version).toBeNull();
    // Common fields (spec.targets.all) merged with the event layer
    expect(web?.schema.application_id).toMatchObject({ value: "web-app", policy: "fixed" });
    expect(web?.layers.application_id).toEqual(["all", "event"]);
    // A common field the event does not list is still part of it
    expect(web?.schema.build_variant).toMatchObject({ type: "string", required: false });
    expect(web?.layers.build_variant).toEqual(["all"]);
    // A catalog field the event lists, with the type from the catalog
    expect(web?.schema.dimension_1).toMatchObject({ type: "string", value: "enterprise" });
    expect(web?.layers.dimension_1).toEqual(["catalog", "event"]);
    const ios = event.payload.find((group) => group.targets.includes("ios"));
    expect(ios?.layers.device_model).toEqual(["catalog", "target", "event"]);
    expect(ios?.schema.device_model).toMatchObject({ type: "string", policy: "specified" });
  });

  it("leaves out catalog fields that the event does not list", () => {
    const event = getEvent(plan, { key: LOGIN_KEY, target: "web" });
    // plan_tier is in the catalog, but this event does not list it
    expect(event.payload[0]?.schema).not.toHaveProperty("plan_tier");
    // login_experiment lists plan_tier with a narrower enum: the catalog example is dropped
    const experiment = getEvent(plan, {
      key: "auth::login_experiment::experiment::login::p3::internal-false",
      target: "web",
    });
    expect(experiment.payload[0]?.schema.plan_tier).toEqual({
      type: "string",
      enum: ["free", "pro"],
    });
  });

  it("selects a target and a version or alias", () => {
    const current = getEvent(plan, { key: ONBOARDING_KEY, target: "web" });
    expect(current.payload).toHaveLength(1);
    expect(current.payload[0]).toMatchObject({
      targets: ["web"],
      version: "1.1.0",
      current: "1.1.0",
    });
    // 1.1.0 is `$ref: "1.0.0"` plus device_model: the event's own step_index is inherited
    expect(current.payload[0]?.schema.step_index).toMatchObject({ type: "number", required: true });
    expect(current.payload[0]?.versions).toEqual(["1.0.0", "1.1.0"]);
    expect(current.payload[0]?.aliases).toMatchObject({ stable: "1.1.0", legacy: "1.0.0" });

    const legacy = getEvent(plan, { key: ONBOARDING_KEY, target: "web", version: "legacy" });
    expect(legacy.payload[0]).toMatchObject({ version: "1.0.0", current: "1.1.0" });
    expect(legacy.payload[0]?.schema.event_name).toMatchObject({
      value: "onboarding_step_complete",
    });
  });

  it("finds events by an old key from their aliases and tolerates malformed aliases", async () => {
    const root = planCopy();
    editYaml(path.join(root, "events", LOGIN_FILE), (document) => {
      document.event.aliases = [{ key: "legacy_login_click" }];
    });
    editYaml(path.join(root, "events/auth/3/false/login_experiment.yaml"), (document) => {
      document.event.aliases = "not_a_list";
    });
    const copy = await new PlanStore(root).current();
    expect(getEvent(copy, { key: "legacy_login_click" })).toMatchObject({
      key: LOGIN_KEY,
      matchedAlias: "legacy_login_click",
    });
    expect(() => getEvent(copy, { key: "no_such_key" })).toThrow(/No event with key 'no_such_key'/);
    expect(searchEvents(copy, { query: "legacy_login_click" }).results[0]).toMatchObject({
      key: LOGIN_KEY,
      exactKeyMatch: true,
    });
  });

  it("returns payload resolution issues with the event", async () => {
    const invalid = await new PlanStore(INVALID_FIXTURE).current();
    const event = getEvent(invalid, { key: "auth::payload_ref_cycle::p1::internal-false" });
    expect(event.payloadIssues?.map((issue) => issue.message).join("\n")).toContain(
      "Cycle detected in $ref",
    );
  });

  it("reports unknown keys, targets and versions as tool errors", () => {
    for (const version of ["__unversioned__", "toString", "constructor"]) {
      expect(() => getEvent(plan, { key: LOGIN_KEY, version })).toThrow(/has no payload version/);
    }
    expect(() => getEvent(plan, { key: "nope" })).toThrow(ToolError);
    expect(() => getEvent(plan, { key: LOGIN_KEY, target: "tv" })).toThrow(
      /no payload for target 'tv'/,
    );
    expect(() => getEvent(plan, { key: ONBOARDING_KEY, version: "9.9.9" })).toThrow(ToolError);
  });
});

describe("dictionaries", () => {
  it("lists dictionaries and returns their values", () => {
    expect(listDictionaries(plan).dictionaries).toContainEqual({
      name: "taxonomy/areas",
      count: 5,
    });
    expect(getDictionary(plan, { name: "taxonomy/areas" }).values).toContain("auth");
    expect(() => getDictionary(plan, { name: "nope" })).toThrow(
      /Dictionaries: data\/application_id/,
    );
  });
});

describe("validateEventDraft", () => {
  const loginYaml = fs.readFileSync(path.join(FIXTURE, "events", LOGIN_FILE), "utf8");

  it("accepts an existing event at its own path (relative to the events or project root)", async () => {
    const result = await validateEventDraft(plan, { path: LOGIN_FILE, yaml: loginYaml });
    expect(result).toMatchObject({ valid: true, key: LOGIN_KEY, replacesExistingFile: true });
    // The event at the same path is the file the draft replaces: no overlap with itself
    expect(result.warnings).toEqual([]);
    const projectRelative = await validateEventDraft(plan, {
      path: `events/${LOGIN_FILE}`,
      yaml: loginYaml,
    });
    expect(projectRelative.valid).toBe(true);
  });

  it("reports a key that does not fit the path and a key used by another event", async () => {
    const result = await validateEventDraft(plan, {
      path: "auth/2/false/login_copy.yaml",
      yaml: loginYaml,
    });
    expect(result.valid).toBe(false);
    const messages = result.errors.map((error) => error.message).join("\n");
    expect(messages).toContain(`Duplicate event key: also used by events/${LOGIN_FILE}`);
    expect(result.errors).toContainEqual({
      path: "event.key",
      message: `Key mismatch: got '${LOGIN_KEY}', expected 'auth::login_copy::click::login_button::p2::internal-false'`,
    });
    expect(result).toMatchObject({
      expectedKey: "auth::login_copy::click::login_button::p2::internal-false",
      replacesExistingFile: false,
    });
  });

  it("reports a path outside the template, broken YAML and paths that leave the events root", async () => {
    const unmatched = await validateEventDraft(plan, { path: "auth/login.yaml", yaml: loginYaml });
    expect(unmatched.valid).toBe(false);
    expect(unmatched.errors[0]?.message).toContain("does not match spec.paths.events.template");

    const broken = await validateEventDraft(plan, { path: LOGIN_FILE, yaml: "event: [\n" });
    expect(broken.valid).toBe(false);
    expect(broken.errors[0]?.message).toMatch(/^Invalid YAML at line/);

    await expect(
      validateEventDraft(plan, { path: "../x/1/true/a.yaml", yaml: "" }),
    ).rejects.toThrow(ToolError);
  });
});

describe("validateEventDraft safety", () => {
  it("runs webhook bindings for the plan but never for drafts, and rejects webhooks in drafts", async () => {
    const requests: string[] = [];
    const server = http.createServer((request, response) => {
      requests.push(String(request.url));
      response.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const root = planCopy();
      editYaml(path.join(root, "opentp.cli.yaml"), (cli) => {
        cli.checks.bindings["name-registered"] = {
          webhook: { url: `http://127.0.0.1:${port}/check` },
        };
      });
      editYaml(path.join(root, "opentp.yaml"), (config) => {
        config.spec.targets.all.schema.event_name.checks["name-registered"] = true;
      });
      const copy = await new PlanStore(root).current();

      // The plan: one request per fixed event_name value, target and version
      expect((await validatePlan(copy, {})).valid).toBe(true);
      expect(requests.length).toBeGreaterThan(0);
      requests.length = 0;

      const draft = parse(fs.readFileSync(path.join(FIXTURE, "events", LOGIN_FILE), "utf8"));
      const result = await validateEventDraft(copy, { path: LOGIN_FILE, yaml: stringify(draft) });
      expect(result.valid).toBe(true);
      expect((result as { note?: string }).note).toBe(
        "webhook binding 'name-registered' was not run for a draft",
      );
      expect(requests).toEqual([]);

      // A draft cannot define a webhook itself: `webhook` is a reserved check id
      draft.event.payload.schema.event_name.checks = {
        webhook: { url: `http://127.0.0.1:${port}/check?token=\${HOME}` },
      };
      const own = await validateEventDraft(copy, { path: LOGIN_FILE, yaml: stringify(draft) });
      expect(own.valid).toBe(false);
      expect(own.errors).toContainEqual({
        path: "payload.schema.event_name.checks.webhook",
        message:
          "Webhook checks are bound in opentp.cli.yaml (checks.bindings.<id>.webhook); refer to them by id",
      });
      expect(requests).toEqual([]);
    } finally {
      server.close();
    }
  });

  it("returns warnings for a draft (unknown check ids)", async () => {
    const draft = parse(fs.readFileSync(path.join(FIXTURE, "events", LOGIN_FILE), "utf8"));
    draft.event.payload.schema.event_name.checks = { "no-such-check": true };
    const result = await validateEventDraft(plan, { path: LOGIN_FILE, yaml: stringify(draft) });
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([
      {
        path: "payload.schema.event_name.checks.no-such-check",
        message:
          "Unknown check 'no-such-check': not in spec.checks, not a built-in or plugin check, not bound in opentp.cli.yaml",
        rule: "unknownCheck",
      },
    ]);
  });

  it("says when the draft replaces a file that opentp cannot load", async () => {
    const invalid = await new PlanStore(INVALID_FIXTURE).current();
    const result = await validateEventDraft(invalid, {
      path: "auth/1/false/yaml_syntax_error.yaml",
      yaml: "opentp: 2026-09\n",
    });
    expect(result).toMatchObject({ replacesExistingFile: true });
    expect(result.existingFileProblem).toMatch(/^Invalid YAML at line/);
  });

  it("reports an unusable path template instead of failing", async () => {
    const root = planCopy();
    editYaml(path.join(root, "opentp.yaml"), (config) => {
      config.spec.paths.events.template = "{area}/{priority_level}/{area}/{event}.yaml";
    });
    const copy = await new PlanStore(root).current();
    expect(describePlan(copy).pathTemplateProblems?.join("\n")).toContain("area");
    await expect(validateEventDraft(copy, { path: LOGIN_FILE, yaml: "" })).rejects.toThrow(
      /spec.paths.events.template in opentp.yaml is unusable/,
    );
    await expect(suggestEvent(copy, { taxonomy: LOGIN_TAXONOMY })).rejects.toThrow(ToolError);
  });
});

describe("validateEventDraft overlap", () => {
  const COPY_FILE = "auth/2/false/login_copy.yaml";
  const COPY_KEY = "auth::login_copy::click::login_button::p2::internal-false";

  /** The login event as a draft at another path, with the key keygen expects there */
  function copyYaml(change: (document: any) => void = () => {}): string {
    const document = parse(fs.readFileSync(path.join(FIXTURE, "events", LOGIN_FILE), "utf8"));
    document.event.key = COPY_KEY;
    change(document);
    return stringify(document);
  }

  const loginOverlap = {
    path: "payload",
    message: `Overlaps with event '${LOGIN_KEY}' (${LOGIN_FILE}) on web, ios, android: identical: no constrained field tells them apart`,
    rule: "overlap",
  };

  it("warns about plan events that the draft overlaps (all but the event at its path)", async () => {
    const result = await validateEventDraft(plan, { path: COPY_FILE, yaml: copyYaml() });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContainEqual(loginOverlap);
    for (const warning of result.warnings) expect(warning.rule).toBe("overlap");
    // The index of the plan's predicates is built once per snapshot
    expect(plan.overlapIndex).toBe(plan.overlapIndex);
  });

  it("respects the draft's ignore entries (overlap, overlap.<key>)", async () => {
    const all = await validateEventDraft(plan, {
      path: COPY_FILE,
      yaml: copyYaml((document) => {
        document.event.ignore = [{ path: "overlap" }];
      }),
    });
    expect(all.warnings).toEqual([]);
    const one = await validateEventDraft(plan, {
      path: COPY_FILE,
      yaml: copyYaml((document) => {
        document.event.ignore = [{ path: `overlap.${LOGIN_KEY}` }];
      }),
    });
    expect(one.warnings).not.toContainEqual(loginOverlap);
  });

  it("takes the draft's versions in file order, also with keys '2' before '1'", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "opentp-mcp-"));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, "events", "a"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "opentp.yaml"),
      [
        "opentp: 2026-09",
        "info: { title: Versions, version: 1.0.0 }",
        "spec:",
        "  paths:",
        "    events: { root: /events, template: '{area}/{event}.yaml' }",
        "  events:",
        "    taxonomy: {}",
        "    payload:",
        "      targets: { all: [web] }",
        "      schema:",
        "        event_name: { type: string }",
        "        screen: { type: string }",
        "        auth_method: { type: string }",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(root, "events", "a", "b.yaml"),
      "opentp: 2026-09\nevent:\n  key: a::b\n  taxonomy: {}\n  payload:\n    schema: { event_name: { value: x }, screen: { value: home } }\n",
    );
    const versions = await new PlanStore(root).current();
    // Version "2" contains a::b, and a::b contains version "1": the first version decides
    const result = await validateEventDraft(versions, {
      path: "a/a.yaml",
      yaml: [
        "opentp: 2026-09",
        "event:",
        "  key: a::a",
        "  taxonomy: {}",
        "  payload:",
        '    current: "2"',
        '    "2": { schema: { event_name: { value: x } } }',
        '    "1": { schema: { event_name: { value: x }, screen: { value: home }, auth_method: { value: email } } }',
        "",
      ].join("\n"),
    });
    expect(result.warnings).toEqual([
      {
        path: "payload",
        message:
          "Overlaps with event 'a::b' (a/b.yaml) on web: every hit of 'a::b' also matches 'a::a'",
        rule: "overlap",
      },
    ]);
  });

  it("follows the severity: off computes nothing, error makes the draft invalid", async () => {
    const root = planCopy();
    editYaml(path.join(root, "opentp.cli.yaml"), (cli) => {
      cli.checks.severity = { overlap: "off" };
    });
    const off = await new PlanStore(root).current();
    const quiet = await validateEventDraft(off, { path: COPY_FILE, yaml: copyYaml() });
    expect(quiet).toMatchObject({ valid: true, warnings: [] });

    const strict = await new PlanStore(FIXTURE, { failOn: ["overlap"] }).current();
    const result = await validateEventDraft(strict, { path: COPY_FILE, yaml: copyYaml() });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(loginOverlap);
    expect(result.warnings).toEqual([]);
  });
});

describe("validatePlan", () => {
  it("returns the plan's validation result, optionally for some files", async () => {
    expect(await validatePlan(plan, {})).toMatchObject({
      valid: true,
      eventCount: 4,
      errorCount: 0,
    });
    expect(await validatePlan(plan, { files: [LOGIN_FILE] })).toMatchObject({
      filesValid: true,
      files: [{ file: `events/${LOGIN_FILE}`, status: "loaded", errorCount: 0 }],
    });
  });

  it("reports the errors and the load status of the requested files", async () => {
    const root = planCopy(INVALID_FIXTURE);
    fs.writeFileSync(path.join(root, "events/auth/misplaced.yaml"), "opentp: 2026-09\n");
    const invalid = await new PlanStore(root).current();
    const bad = "badarea/1/false/area_not_in_dict.yaml";
    for (const file of [bad, `events/${bad}`]) {
      const result = await validatePlan(invalid, { files: [file] });
      expect(result.filesValid).toBe(false);
      expect(result.files).toEqual([{ file: `events/${bad}`, status: "loaded", errorCount: 1 }]);
      expect(result.errors).toEqual([
        {
          file: bad,
          path: "taxonomy.area",
          message: "Value 'badarea' is not in dictionary 'taxonomy/areas'",
        },
      ]);
    }

    const statuses = await validatePlan(invalid, {
      files: ["auth/1/false/yaml_syntax_error.yaml", "auth/misplaced.yaml", "auth/nope.yaml"],
    });
    expect(statuses.files?.map((file) => file.status)).toEqual([
      "load-error",
      "not-loaded",
      "not-found",
    ]);
    expect(statuses.files?.[1]?.reason).toContain("does not match spec.paths.events.template");

    await expect(
      validatePlan(invalid, { files: [path.join(root, "events", bad)] }),
    ).rejects.toThrow(ToolError);
    await expect(validatePlan(invalid, { files: ["../opentp.yaml"] })).rejects.toThrow(ToolError);
  });

  it("reports the errors of an invalid plan", async () => {
    const invalid = await new PlanStore(path.resolve("tests/data/coverage-invalid")).current();
    const result = await validatePlan(invalid, { limit: 3 });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(3);
    expect(result.truncated).toBe(true);
    expect(result.errorCount).toBeGreaterThan(3);
  });
});

describe("suggestEvent", () => {
  it("derives the file, the key and a skeleton, and finds conflicts", async () => {
    const result = await suggestEvent(plan, { taxonomy: LOGIN_TAXONOMY });
    expect(result.file).toBe(`events/${LOGIN_FILE}`);
    expect(result.key).toBe(LOGIN_KEY);
    expect(result.existingFile).toBe(`events/${LOGIN_FILE}`);
    expect(result.keyUsedBy).toBe(`events/${LOGIN_FILE}`);
    expect(result.missingTaxonomy).toEqual([]);
    expect(result.problems).toEqual([]);
    expect(result.requiredPayloadFields).toContainEqual(
      expect.objectContaining({
        name: "application_id",
        dict: "data/application_id",
        policy: "fixed",
        targets: ["web", "ios", "android"],
      }),
    );
    expect(result.requiredPayloadFields).toContainEqual(
      expect.objectContaining({ name: "device_model", policy: "specified", targets: ["ios"] }),
    );

    const skeleton = parse(result.skeleton);
    expect(skeleton.opentp).toBe("2026-09");
    expect(skeleton.event.key).toBe(LOGIN_KEY);
    // Path fields stay in the path
    expect(skeleton.event.taxonomy).not.toHaveProperty("area");
    expect(skeleton.event.taxonomy.action).toBe("User clicks the login button");
    // Every field with a policy, with a placeholder where the event must write something; the
    // same fields work on every target, so the payload is implicit
    expect(skeleton.event.payload).toEqual({
      schema: {
        application_id: { value: "<...>" },
        event_name: { value: "<...>" },
        event_category: { enum: ["<...>"] },
        device_model: {},
      },
    });
    expect(result.skeleton).toContain("value: <...>");
    // What is left to do: the placeholders are not valid values yet
    expect(result.skeletonErrors.length).toBeGreaterThan(0);
    for (const error of result.skeletonErrors) {
      expect(error.path).toMatch(
        /^payload\.(web|ios|android)\.schema\.(application_id|event_name)/,
      );
    }
  });

  it("writes one payload per target when the targets need different fields", async () => {
    const root = planCopy();
    editYaml(path.join(root, "opentp.yaml"), (config) => {
      // A common field of iOS only (not in the catalog), and a fixed value written with its policy
      config.spec.targets.ios.schema.ios_build = { type: "string", policy: "specified" };
      config.spec.targets.all.schema.schema_version = {
        type: "integer",
        value: 2,
        policy: "fixed",
      };
    });
    const copy = await new PlanStore(root).current();
    const result = await suggestEvent(copy, { taxonomy: LOGIN_TAXONOMY });
    const common = {
      application_id: { value: "<...>" },
      event_name: { value: "<...>" },
      event_category: { enum: ["<...>"] },
      // A fixed value cannot change: the skeleton repeats it
      schema_version: { value: 2 },
    };
    expect(parse(result.skeleton).event.payload).toEqual({
      web: { schema: common },
      ios: { schema: { ...common, device_model: {}, ios_build: {} } },
      android: { schema: common },
    });
  });

  it("writes value: [<...>] for an array field with policy restricted or fixed", async () => {
    const root = planCopy();
    editYaml(path.join(root, "opentp.yaml"), (config) => {
      config.spec.targets.all.schema.tags = {
        type: "array",
        items: { type: "string" },
        policy: "restricted",
      };
      config.spec.targets.all.schema.flags = {
        type: "array",
        items: { type: "boolean" },
        policy: "fixed",
      };
    });
    const copy = await new PlanStore(root).current();
    const result = await suggestEvent(copy, { taxonomy: LOGIN_TAXONOMY });
    const skeleton = parse(result.skeleton);
    expect(skeleton.event.payload.schema.tags).toEqual({ value: ["<...>"] });
    expect(skeleton.event.payload.schema.flags).toEqual({ value: ["<...>"] });

    // Filled in the natural way, the skeleton validates
    const filled = result.skeleton
      .replace("application_id:\n        value: <...>", "application_id:\n        value: web-app")
      .replace(/event_name:\n {8}value: <\.\.\.>/, "event_name:\n        value: login_button_click")
      .replace(
        /event_category:\n {8}enum:\n {10}- <\.\.\.>/,
        "event_category:\n        enum: [auth]",
      )
      .replace(/tags:\n {8}value:\n {10}- <\.\.\.>/, "tags:\n        value: [a]")
      .replace(/flags:\n {8}value:\n {10}- <\.\.\.>/, "flags:\n        value: [true]");
    expect(filled).not.toContain("<...>");
    // At the path of the existing event that the skeleton is for (it replaces that event)
    const draft = await validateEventDraft(copy, { path: LOGIN_FILE, yaml: filled });
    expect(draft.errors).toEqual([]);
  });

  it("reports missing path fields, fragments and unknown fields", async () => {
    const { area: _area, ...rest } = LOGIN_TAXONOMY;
    const result = await suggestEvent(plan, { taxonomy: { ...rest, verb: "click", nope: 1 } });
    expect(result.file).toBeNull();
    expect(result.key).toBeNull();
    expect(result.missingTaxonomy).toContain("area");
    expect(result.problems.join("\n")).toContain("'verb' is a fragment of 'action_detail'");
    expect(result.problems.join("\n")).toContain("'nope' is not a taxonomy field");
  });

  it("refuses a path that the template would read back with other values", async () => {
    const root = planCopy();
    editYaml(path.join(root, "opentp.yaml"), (config) => {
      config.spec.paths.events.template =
        "{area}/{priority_level}/{is_internal}/{event}_{custom_id}.yaml";
    });
    const copy = await new PlanStore(root).current();
    const result = await suggestEvent(copy, {
      taxonomy: { ...LOGIN_TAXONOMY, event: "login_button", custom_id: "cid_x" },
    });
    expect(result.file).toBeNull();
    expect(result.key).toBeNull();
    expect(result.problems.join("\n")).toContain("would be read back with event = 'login'");
  });

  it("explains a missing key when keygen is not configured", async () => {
    const root = planCopy();
    editYaml(path.join(root, "opentp.cli.yaml"), (cli) => {
      delete cli.keygen;
    });
    const copy = await new PlanStore(root).current();
    const result = await suggestEvent(copy, { taxonomy: LOGIN_TAXONOMY });
    expect(result.key).toBeNull();
    expect(result.keyNote).toContain("Key generation is not configured");
    expect(parse(result.skeleton).event.key).toBe("TODO");
  });

  it("rejects path values that would leave their segment", async () => {
    const result = await suggestEvent(plan, { taxonomy: { ...LOGIN_TAXONOMY, event: "../x" } });
    expect(result.file).toBeNull();
    expect(result.problems.join("\n")).toContain("'event' is part of the file path");
  });
});

describe("generate", () => {
  it("exports some events with a built-in generator", async () => {
    const result = await generate(plan, { generator: "json", keys: [LOGIN_KEY] });
    expect(result.eventCount).toBe(1);
    expect(result.bytes).toBe(Buffer.byteLength(result.output));
    expect(JSON.parse(result.output).events.map((event: { key: string }) => event.key)).toEqual([
      LOGIN_KEY,
    ]);
    await expect(generate(plan, { generator: "yaml", keys: ["nope"] })).rejects.toThrow(
      /Unknown event keys: nope/,
    );
  });

  it("refuses a plan that could not be loaded completely", async () => {
    const invalid = await new PlanStore(path.resolve("tests/data/coverage-invalid")).current();
    await expect(generate(invalid, { generator: "json" })).rejects.toThrow(/could not be loaded/);
  });

  it("exports the catalog, targets, checks and the effective payload of every event", async () => {
    const result = await generate(plan, { generator: "json" });
    const data = JSON.parse(result.output);
    expect(Object.keys(data)).toEqual([
      "opentp",
      "info",
      "catalog",
      "targets",
      "checks",
      "events",
      "dictionaries",
    ]);
    expect(data.events.map((event: { key: string }) => event.key)).toEqual(
      plan.events.map((event) => event.key),
    );
    const login = data.events.find((event: { key: string }) => event.key === LOGIN_KEY);
    expect(login.effectivePayload.web.fields.application_id).toMatchObject({
      value: "web-app",
      policy: "fixed",
    });
  });

  it("runs a generate.run entry of opentp.cli.yaml and returns its output without writing it", async () => {
    const root = planCopy();
    fs.mkdirSync(path.join(root, "templates"));
    fs.writeFileSync(
      path.join(root, "templates/keys.txt"),
      "{{#each events}}{{key}} {{effectivePayload.web.fields.event_name.value}}\n{{/each}}",
    );
    editYaml(path.join(root, "opentp.cli.yaml"), (cli) => {
      cli.generate = {
        run: [
          {
            generator: "json",
            target: "android",
            events: { area: "onboarding" },
            output: "dist/onboarding.json",
          },
          {
            generator: "template",
            file: "templates/keys.txt",
            events: { area: "auth" },
            output: "docs/keys.txt",
          },
          { generator: "nope", output: "x" },
        ],
      };
    });
    const copy = await new PlanStore(root).current();

    const json = await generate(copy, { run: 0 });
    expect(json).toMatchObject({
      generator: "json",
      run: 0,
      entryOutput: "dist/onboarding.json",
      eventCount: 1,
    });
    expect(JSON.parse(json.output).events[0].key).toBe(ONBOARDING_KEY);

    const template = await generate(copy, { run: 1, keys: [LOGIN_KEY] });
    expect(template.output).toBe(`${LOGIN_KEY} login_button_click\n`);

    // Nothing is written
    expect(fs.existsSync(path.join(root, "dist"))).toBe(false);
    expect(fs.existsSync(path.join(root, "docs"))).toBe(false);

    await expect(generate(copy, { run: 0, generator: "yaml" })).rejects.toThrow(
      "generate.run[0] uses the json generator, not yaml: pass only run",
    );
    await expect(generate(copy, { run: 0, keys: [LOGIN_KEY] })).rejects.toThrow(
      `Not selected by generate.run[0] (target, events): ${LOGIN_KEY}`,
    );
    await expect(generate(copy, { run: 2 })).rejects.toThrow(
      "Unknown generator 'nope' (opentp mcp does not load generate.plugins)",
    );
    await expect(generate(copy, { run: 3 })).rejects.toThrow(
      "No generate.run entry 3: opentp.cli.yaml has 3 (0 to 2)",
    );
    await expect(generate(copy, {})).rejects.toThrow(
      "Pass generator (json or yaml) or run (the index of a generate.run entry in opentp.cli.yaml)",
    );
    await expect(generate(plan, { run: 0 })).rejects.toThrow(
      "opentp.cli.yaml has no generate.run entries: pass generator instead",
    );
  });

  it("reports a generate.run entry whose filter does not fit the plan", async () => {
    const root = planCopy();
    editYaml(path.join(root, "opentp.cli.yaml"), (cli) => {
      cli.generate = { run: [{ generator: "json", target: "desktop", output: "x.json" }] };
    });
    const copy = await new PlanStore(root).current();
    await expect(generate(copy, { run: 0 })).rejects.toThrow(
      "opentp.cli.yaml: generate.run[0].target: unknown target 'desktop' (targets: web, ios, android)",
    );
  });

  it("reads template files of generate.run entries only inside the directory of opentp.cli.yaml", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "opentp-mcp-contain-"));
    try {
      fs.writeFileSync(path.join(base, "secret.txt"), "SECRET-OUTSIDE");
      const root = path.join(base, "plan");
      fs.cpSync(FIXTURE, root, { recursive: true });
      fs.symlinkSync(path.join(base, "secret.txt"), path.join(root, "linked.txt"));
      fs.mkdirSync(path.join(root, ".git"));
      fs.writeFileSync(path.join(root, ".git", "config"), "[core]\n");
      editYaml(path.join(root, "opentp.cli.yaml"), (cli) => {
        cli.generate = {
          run: [
            { generator: "template", file: "../secret.txt", output: "a.txt" },
            { generator: "template", file: path.join(base, "secret.txt"), output: "b.txt" },
            { generator: "template", file: "linked.txt", output: "c.txt" },
            { generator: "template", file: ".git/config", output: "d.txt" },
            { generator: "template", output: "e.txt" },
            { generator: "template", file: "missing.tpl", output: "f.txt" },
            // The output is never written by the MCP tool, so it is not checked there
            { generator: "json", output: "../outside.json" },
          ],
        };
      });
      const copy = await new PlanStore(root).current();
      const message = async (run: number) =>
        generate(copy, { run }).then(
          () => "",
          (error: Error) => error.message,
        );
      expect(await message(0)).toBe(
        `opentp.cli.yaml: generate.run[0].file: '../secret.txt' leaves the directory of opentp.cli.yaml (${root})`,
      );
      expect(await message(1)).toBe(
        `opentp.cli.yaml: generate.run[1].file: '${path.join(base, "secret.txt")}' is an absolute path: write a path relative to the directory of opentp.cli.yaml`,
      );
      expect(await message(2)).toBe(
        `opentp.cli.yaml: generate.run[2].file: 'linked.txt' leaves the directory of opentp.cli.yaml (${root})`,
      );
      expect(await message(3)).toBe(
        "opentp.cli.yaml: generate.run[3].file: '.git/config' is inside a .git directory",
      );
      expect(await message(4)).toBe(
        "opentp.cli.yaml: generate.run[4].file: the template generator needs a template file",
      );
      expect(await message(5)).toBe(
        `opentp.cli.yaml: generate.run[5].file: file not found: ${path.join(root, "missing.tpl")}`,
      );
      expect(await message(6)).toBe("");
      for (const run of [0, 1, 2]) expect(await message(run)).not.toContain("SECRET");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("PlanStore", () => {
  it("reuses the loaded plan until a file changes, then reloads it", async () => {
    const root = planCopy();
    const store = new PlanStore(root);
    const first = await store.current();
    expect(await store.current()).toBe(first);

    const file = path.join(root, "events", LOGIN_FILE);
    const content = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, content.replace("User clicks the login button", "User taps the zebra"));
    const second = await store.current();
    expect(second).not.toBe(first);
    expect(searchEvents(second, { query: "zebra" }).results[0]?.key).toBe(LOGIN_KEY);

    fs.rmSync(file);
    const third = await store.current();
    expect(third.events).toHaveLength(3);
  });

  it("follows new roots in opentp.yaml", async () => {
    const root = planCopy();
    const store = new PlanStore(root);
    expect((await store.current()).events).toHaveLength(4);
    fs.renameSync(path.join(root, "events"), path.join(root, "tracking"));
    editYaml(path.join(root, "opentp.yaml"), (config) => {
      config.spec.paths.events.root = "/tracking";
    });
    const moved = await store.current();
    expect(moved.eventsRoot).toBe("tracking");
    expect(moved.events).toHaveLength(4);
    // The new directory is watched too
    fs.rmSync(path.join(root, "tracking", LOGIN_FILE));
    expect((await store.current()).events).toHaveLength(3);
  });

  it("reloads when opentp.cli.yaml changes and reports its problems from every tool", async () => {
    const root = planCopy();
    const store = new PlanStore(root);
    const first = await store.current();
    expect(first.keygen?.template).toContain("{area | slug}");

    editYaml(path.join(root, "opentp.cli.yaml"), (cli) => {
      delete cli.keygen;
    });
    const second = await store.current();
    expect(second).not.toBe(first);
    expect(second.keygen).toBeNull();

    editYaml(path.join(root, "opentp.cli.yaml"), (cli) => {
      cli.opentp = "2026-08";
      cli.unknownSection = true;
    });
    await expect(store.current()).rejects.toThrow(PlanError);
    await expect(store.current()).rejects.toThrow(
      "opentp.cli.yaml: unknownSection: Unknown key 'unknownSection' (extensions start with 'x-')",
    );
  });

  it("reports the 2026-01 guidance as a PlanError", async () => {
    const root = planCopy();
    const file = path.join(root, "opentp.yaml");
    fs.writeFileSync(
      file,
      fs.readFileSync(file, "utf8").replace("opentp: 2026-09", "opentp: 2026-01"),
    );
    await expect(new PlanStore(root).current()).rejects.toThrow(
      /This plan uses OpenTrackPlan 2026-01; .* Run "opentp migrate" to upgrade it/,
    );
  });

  it("throws PlanError when opentp.yaml is missing or invalid", async () => {
    const root = planCopy();
    fs.writeFileSync(path.join(root, "opentp.yaml"), "opentp: 2026-09\n");
    await expect(new PlanStore(root).current()).rejects.toThrow(PlanError);
    fs.rmSync(path.join(root, "opentp.yaml"));
    await expect(new PlanStore(root).current()).rejects.toThrow(/opentp.yaml not found/);
  });
});
