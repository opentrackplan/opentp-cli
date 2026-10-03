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
    expect(description.opentp).toBe("2026-01");
    expect(description.eventsRoot).toBe("events");
    expect(description.pathTemplate).toBe("{area}/{priority_level}/{is_internal}/{event}.yaml");
    expect(description.taxonomy.area).toMatchObject({ fromPath: true, dict: "taxonomy/areas" });
    expect(description.taxonomy.action).toMatchObject({ fromPath: false, required: true });
    expect(description.key.keygenTemplate).toContain("{area | slug}");
    expect(description.targets).toEqual({
      all: ["web", "ios", "android"],
      mobile: ["ios", "android"],
    });
    expect(description.targetSchemas).toHaveProperty("ios.device_model");
    expect(description.counts).toEqual({ events: 4, dictionaries: 4, loadProblems: 0 });
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
    expect(web?.schema.application_id).toMatchObject({ value: "web-app", required: true });
    expect(web?.schema.build_variant).toMatchObject({ required: false });
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
  it("does not run webhook checks defined in the draft", async () => {
    let requests = 0;
    const server = http.createServer((_request, response) => {
      requests++;
      response.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const draft = parse(fs.readFileSync(path.join(FIXTURE, "events", LOGIN_FILE), "utf8"));
      draft.event.payload.schema.event_name["x-opentp"] = {
        checks: { webhook: { url: `http://127.0.0.1:${port}/check?token=\${HOME}` } },
      };
      const result = await validateEventDraft(plan, { path: LOGIN_FILE, yaml: stringify(draft) });
      expect(result.valid).toBe(true);
      expect((result as { note?: string }).note).toContain(
        "1 webhook check(s) defined in the draft were not run",
      );
      expect(requests).toBe(0);
    } finally {
      server.close();
    }
  });

  it("says when the draft replaces a file that opentp cannot load", async () => {
    const invalid = await new PlanStore(INVALID_FIXTURE).current();
    const result = await validateEventDraft(invalid, {
      path: "auth/1/false/yaml_syntax_error.yaml",
      yaml: "opentp: 2026-01\n",
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
    fs.writeFileSync(path.join(root, "events/auth/misplaced.yaml"), "opentp: 2026-01\n");
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
        needsValue: true,
        dict: "data/application_id",
      }),
    );

    const skeleton = parse(result.skeleton);
    expect(skeleton.opentp).toBe("2026-01");
    expect(skeleton.event.key).toBe(LOGIN_KEY);
    // Path fields stay in the path
    expect(skeleton.event.taxonomy).not.toHaveProperty("area");
    expect(skeleton.event.taxonomy.action).toBe("User clicks the login button");
    // The empty payload still lacks the fixed values of required common fields
    expect(result.skeletonErrors.map((error) => error.path).join("\n")).toContain("application_id");
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
    editYaml(path.join(root, "opentp.yaml"), (config) => {
      delete config.spec.events["x-opentp"];
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

  it("throws PlanError when opentp.yaml is missing or invalid", async () => {
    const root = planCopy();
    fs.writeFileSync(path.join(root, "opentp.yaml"), "opentp: 2026-01\n");
    await expect(new PlanStore(root).current()).rejects.toThrow(PlanError);
    fs.rmSync(path.join(root, "opentp.yaml"));
    await expect(new PlanStore(root).current()).rejects.toThrow(/opentp.yaml not found/);
  });
});
