/**
 * Field semantics through the whole validate pipeline (`main(["validate", "--json"])`) on small
 * plans written to temp directories: examples inherited through `$ref`, payload map keys that look
 * like keywords, `__proto__` field names, ignores of dotted field names, type-dependent keywords,
 * YAML merge keys, opentp.yaml rules that the schemas enforce, and checks on pii and item values.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, main } from "../cli";
import { setLogLevel } from "../util/logger";

interface Report {
  success: boolean;
  events: number;
  errors: Array<{ event: string; path: string; message: string }>;
  warnings: Array<{ event: string; path: string; message: string; rule?: string }>;
}

interface PlanFiles {
  /** spec.events.payload.schema (YAML flow or block text, indented by the helper) */
  catalog?: string;
  /** Extra text under spec: (e.g. targets, checks), at two spaces */
  spec?: string;
  /** Extra text under spec.events: (e.g. pii), at four spaces */
  events?: string;
  /** Event files by path below events/ (whole file text) */
  eventFiles?: Record<string, string>;
  /** Dictionaries by path below dictionaries/ without extension: values */
  dictionaries?: Record<string, unknown[]>;
  /** opentp.cli.yaml text after the header */
  cli?: string;
  /** The whole opentp.yaml (replaces the generated one) */
  opentp?: string;
}

const tempDirs: string[] = [];

function indent(text: string, spaces: number): string {
  return text
    .split("\n")
    .map((line) => (line === "" ? line : `${" ".repeat(spaces)}${line}`))
    .join("\n");
}

function writePlan(files: PlanFiles): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opentp-semantics-"));
  tempDirs.push(root);
  const opentp =
    files.opentp ??
    `opentp: 2026-09
info: { title: Semantics, version: 1.0.0 }
spec:
  paths:
    events: { root: /events, template: "{area}/{event}.yaml" }
    dictionaries: { root: /dictionaries }
${files.spec ? indent(files.spec, 2) : ""}
  events:
    taxonomy:
      area: { title: Area, type: string }
      event: { title: Event, type: string }
    payload:
      targets: { all: [web, ios] }
      schema:
${indent(files.catalog ?? "{}", 8)}
${files.events ? indent(files.events, 4) : ""}
`;
  fs.writeFileSync(path.join(root, "opentp.yaml"), opentp);
  for (const [relative, text] of Object.entries(files.eventFiles ?? {})) {
    const file = path.join(root, "events", relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  fs.mkdirSync(path.join(root, "dictionaries"), { recursive: true });
  for (const [name, values] of Object.entries(files.dictionaries ?? {})) {
    const file = path.join(root, "dictionaries", `${name}.yaml`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `opentp: 2026-09\ndict:\n  type: string\n  values: ${JSON.stringify(values)}\n`,
    );
  }
  if (files.cli !== undefined) {
    fs.writeFileSync(path.join(root, "opentp.cli.yaml"), `opentp: 2026-09\n${files.cli}`);
  }
  return root;
}

/** An event file `auth/login.yaml` with this text under `event:` after key and taxonomy */
function loginEvent(payload: string, extra = ""): Record<string, string> {
  return {
    "auth/login.yaml": `opentp: 2026-09
event:
  key: auth::login
  taxonomy: {}
${indent(extra, 2)}
  payload:
${indent(payload, 4)}
`,
  };
}

let stdout: string[] = [];
let stderr: string[] = [];

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
});

afterAll(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function validate(files: PlanFiles, ...flags: string[]): Promise<Report> {
  const root = writePlan(files);
  stdout = [];
  const code = await main(["validate", "--json", "--root", root, ...flags]);
  const report = JSON.parse(stdout.join("")) as Report;
  expect(code).toBe(report.success ? EXIT_OK : EXIT_FAILURE);
  return report;
}

/** `[path, message]` of the errors (event files and opentp.yaml) */
function errorList(report: Report): string[][] {
  return report.errors.map((error) => [error.event, error.path, error.message]);
}

// --- Examples inherited through $ref -------------------------------------------------------------

describe("examples inherited through $ref", () => {
  it("are not checked again in a derived version that narrows the enum (checked where written)", async () => {
    const report = await validate({
      catalog: "method: { type: string, enum: [email, google, github] }",
      eventFiles: loginEvent(`current: "2"
"1":
  schema:
    method: { enum: [email, google], example: google }
"2":
  $ref: "1"
  schema:
    method: { enum: [email] }`),
    });
    expect(errorList(report)).toEqual([]);
  });

  it("are dropped from the effective payload when the derived version no longer allows them", async () => {
    const root = writePlan({
      catalog: "method: { type: string, enum: [email, google, github] }",
      eventFiles: loginEvent(`current: "2"
"1":
  schema:
    method: { enum: [email, google], example: google }
"2":
  $ref: "1"
  schema:
    method: { enum: [email] }`),
    });
    expect(await main(["generate", "json", "--root", root])).toBe(EXIT_OK);
    const exported = JSON.parse(stdout.join(""));
    const versions = exported.events[0].effectivePayload.web.versions;
    expect(versions["1"].fields.method).toEqual({
      type: "string",
      enum: ["email", "google"],
      example: "google",
    });
    expect(versions["2"].fields.method).toEqual({ type: "string", enum: ["email"] });
  });

  it("are dropped when the derived version narrows with dict or items.dict to values without them", async () => {
    const files: PlanFiles = {
      catalog: `method: { type: string, enum: [email, google, github] }
tags: { type: array, items: { type: string } }`,
      dictionaries: { "auth/small": ["email"], small: ["a"] },
      eventFiles: loginEvent(`current: "2"
"1":
  schema:
    method: { enum: [email, google], example: google }
    tags: { example: [a, b] }
"2":
  $ref: "1"
  schema:
    method: { dict: auth/small }
    tags: { items: { dict: small } }`),
    };
    expect(errorList(await validate(files))).toEqual([]);

    const root = writePlan(files);
    stdout = [];
    expect(await main(["generate", "json", "--root", root])).toBe(EXIT_OK);
    const versions = JSON.parse(stdout.join("")).events[0].effectivePayload.web.versions;
    expect(versions["1"].fields.method.example).toBe("google");
    expect(versions["1"].fields.tags.example).toEqual(["a", "b"]);
    expect(versions["2"].fields.method).toEqual({ type: "string", dict: "auth/small" });
    expect(versions["2"].fields.tags).toEqual({
      type: "array",
      items: { type: "string", dict: "small" },
    });
  });

  it("are kept when the dictionary of the derived version allows them, or does not exist", async () => {
    const root = writePlan({
      catalog: "method: { type: string, enum: [email, google, github] }",
      dictionaries: { "auth/methods": ["email", "google"] },
      eventFiles: loginEvent(`current: "3"
"1":
  schema:
    method: { enum: [email, google], example: google }
"2":
  $ref: "1"
  schema:
    method: { dict: auth/methods }
"3":
  $ref: "1"
  schema:
    method: { dict: auth/missing }`),
    });
    stdout = [];
    expect(await main(["validate", "--json", "--root", root])).toBe(EXIT_FAILURE);
    // Only the unknown dictionary is reported
    expect(errorList(JSON.parse(stdout.join("")))).toEqual([
      ["auth/login.yaml", "payload.3.schema.method.dict", expect.stringContaining("auth/missing")],
    ]);

    stdout = [];
    expect(await main(["generate", "json", "--root", root])).toBe(EXIT_OK);
    const versions = JSON.parse(stdout.join("")).events[0].effectivePayload.web.versions;
    expect(versions["2"].fields.method.example).toBe("google");
    expect(versions["3"].fields.method.example).toBe("google");
  });

  it("are still checked in the version that writes them", async () => {
    const report = await validate({
      catalog: "method: { type: string, enum: [email, google, github] }",
      eventFiles: loginEvent(`current: "2"
"1":
  schema:
    method: { enum: [email, google], example: apple }
"2":
  $ref: "1"
  schema:
    method: { enum: [email, google] }`),
    });
    expect(errorList(report)).toEqual([
      [
        "auth/login.yaml",
        "payload.web.1.schema.method.example",
        'Example "apple" is not in allowed enum: [email, google]',
      ],
      [
        "auth/login.yaml",
        "payload.ios.1.schema.method.example",
        'Example "apple" is not in allowed enum: [email, google]',
      ],
    ]);
  });
});

// --- Payload map keys are names ------------------------------------------------------------------

describe("payload version keys and selectors are names, not keywords", () => {
  const BROKEN = `method: { policy: fixed, dict: no/such, enum: [], checks: { nosuch: true }, x-opentp: { role: r } }
other: null`;

  it("walks a version named like an extension (x-beta) and reports never-ignorable problems", async () => {
    const named = (key: string) =>
      validate({
        catalog: "method: { type: string }\nother: { type: string }",
        eventFiles: loginEvent(`current: ${key}
${key}:
  schema:
${indent(BROKEN, 4)}`),
      });
    const pathsOf = (report: Report, key: string) =>
      [...errorList(report), ...report.warnings.map((w) => [w.event, w.path, w.message])]
        .map(([, errorPath, message]) => [errorPath.replace(key, "<v>"), message])
        .filter(([errorPath]) => errorPath.startsWith("payload.<v>."));
    const beta = await named("x-beta");
    const plain = await named("beta");
    expect(pathsOf(beta, "x-beta")).toEqual(pathsOf(plain, "beta"));
    expect(pathsOf(beta, "x-beta").length).toBeGreaterThanOrEqual(6);
  });

  it("walks selectors and versions named value, enum, example, values, checks or dict", async () => {
    for (const key of ["value", "enum", "example", "values", "checks", "dict"]) {
      const report = await validate({
        catalog: "method: { type: string }",
        eventFiles: loginEvent(`current: ${key}
${key}:
  schema:
    method: { enum: [] }`),
      });
      expect(errorList(report)).toEqual([
        [
          "auth/login.yaml",
          `payload.${key}.schema.method.enum`,
          "enum must have at least one value",
        ],
      ]);
    }
  });

  it("does not read an alias as a dictionary reference or check ids", async () => {
    const report = await validate({
      catalog: "method: { type: string }",
      eventFiles: loginEvent(`current: dict
dict: "1"
checks: "1"
"1":
  schema:
    method: {}`),
    });
    expect(errorList(report)).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("walks map-form selectors named like keywords", async () => {
    const report = await validate({
      spec: "",
      catalog: "method: { type: string }",
      opentp: `opentp: 2026-09
info: { title: Semantics, version: 1.0.0 }
spec:
  paths:
    events: { root: /events, template: "{area}/{event}.yaml" }
  events:
    taxonomy:
      area: { title: Area, type: string }
      event: { title: Event, type: string }
    payload:
      targets: { all: [web, x-tv] }
      schema:
        method: { type: string }
`,
      eventFiles: loginEvent(`web:
  schema:
    method: {}
x-tv:
  schema:
    method: { x-opentp: {} }`),
    });
    expect(errorList(report)).toEqual([
      [
        "auth/login.yaml",
        "payload.x-tv.schema.method.x-opentp",
        "x-opentp was removed in 2026-09: move checks to 'checks', keygen to opentp.cli.yaml 'keygen', delete 'role'",
      ],
    ]);
  });
});

// --- __proto__ -----------------------------------------------------------------------------------

describe("a field named __proto__", () => {
  it("is an unknown field when the catalog does not have it, and is validated", async () => {
    const report = await validate({
      catalog: "event_name: { type: string }",
      eventFiles: loginEvent(`schema:
  event_name: { value: login }
  __proto__: { type: integer, value: "not an integer" }`),
    });
    expect(errorList(report)).toEqual([
      [
        "auth/login.yaml",
        "payload.web.schema.__proto__",
        "Unknown field '__proto__': add it to the catalog (spec.events.payload.schema) or to spec.targets.all/web.schema",
      ],
      [
        "auth/login.yaml",
        "payload.ios.schema.__proto__",
        "Unknown field '__proto__': add it to the catalog (spec.events.payload.schema) or to spec.targets.all/ios.schema",
      ],
    ]);
  });

  it("is merged and checked like any field when the catalog has it", async () => {
    const report = await validate({
      catalog: "__proto__: { type: integer }",
      eventFiles: loginEvent(`schema:
  __proto__: { value: "x" }`),
    });
    expect(errorList(report)).toEqual([
      [
        "auth/login.yaml",
        "payload.web.schema.__proto__.value",
        "Expected integer value, got string",
      ],
      [
        "auth/login.yaml",
        "payload.ios.schema.__proto__.value",
        "Expected integer value, got string",
      ],
    ]);
  });
});

describe("a payload version keyed __proto__", () => {
  it("validates and is exported in effectivePayload (json and yaml) like any version", async () => {
    const files: PlanFiles = {
      catalog: "method: { type: string }",
      eventFiles: loginEvent(`current: __proto__
__proto__: { schema: { method: { value: x } } }
v1: { schema: {} }`),
    };
    expect(errorList(await validate(files))).toEqual([]);

    const root = writePlan(files);
    stdout = [];
    expect(await main(["generate", "json", "--root", root])).toBe(EXIT_OK);
    const web = JSON.parse(stdout.join("")).events[0].effectivePayload.web;
    expect(web.current).toBe("__proto__");
    expect(web.fields).toEqual({ method: { type: "string", value: "x" } });
    expect(Object.keys(web.versions)).toEqual(["__proto__", "v1"]);
    expect(Object.hasOwn(web.versions, "__proto__")).toBe(true);
    expect(web.versions.v1).toEqual({ fields: {} });

    stdout = [];
    expect(await main(["generate", "yaml", "--root", root])).toBe(EXIT_OK);
    expect(stdout.join("")).toContain("        current: __proto__\n");
    expect(stdout.join("")).toMatch(/ {8}versions:\n {10}__proto__:\n {12}fields:\n {14}method:\n/);
  });
});

// --- Closed vocabulary message ---------------------------------------------------------------------

describe("the closed-vocabulary message", () => {
  it("ends the sentence before the suggestion", async () => {
    const report = await validate({
      catalog: "auth_method: { type: string }",
      eventFiles: loginEvent("schema:\n  auth_methd: {}"),
    });
    expect(report.errors[0].message).toBe(
      "Unknown field 'auth_methd': add it to the catalog (spec.events.payload.schema) or to spec.targets.all/web.schema. Did you mean 'auth_method'?",
    );
  });
});

// --- Ignoring a field whose name contains a dot -------------------------------------------------------

describe("ignore: payload::<f> for a field whose name contains a dot", () => {
  it("silences its unknown checks and unknown dictionaries, and only those of that field", async () => {
    const files = (ignored: string) => ({
      catalog: '"a.b": { type: string }\na: { type: string }',
      eventFiles: loginEvent(
        `schema:
  "a.b": { checks: { nosuch: true }, dict: missing/d }`,
        `ignore: [{ path: "${ignored}" }]`,
      ),
    });
    const exact = await validate(files("payload::a.b"));
    expect(errorList(exact)).toEqual([]);
    expect(exact.warnings).toEqual([]);

    const other = await validate(files("payload::a"));
    expect(errorList(other)).toEqual([
      ["auth/login.yaml", "payload.schema.a.b.dict", "Unknown dictionary 'missing/d'"],
    ]);
    expect(other.warnings.map((warning) => warning.rule)).toEqual(["unknownCheck"]);
  });
});

// --- Keywords that depend on the type -------------------------------------------------------------

describe("keywords that depend on the field type", () => {
  const CATALOG = `tags: { type: array, items: { type: string } }
auth_method: { type: string, enum: [email, google] }
n: { type: integer }
flag: { type: boolean }`;

  it("rejects them in event fields that inherit the type, once per file at the written path", async () => {
    const report = await validate({
      catalog: CATALOG,
      dictionaries: { x: ["a"] },
      eventFiles: {
        ...loginEvent(`schema:
  tags: { dict: x }
  auth_method: { items: { enum: [email] }, minimum: 1 }
  n: { maxLength: 3, pattern: "^a" }
  flag: { uniqueItems: true }`),
        "auth/enum.yaml": `opentp: 2026-09
event:
  key: auth::enum
  taxonomy: {}
  payload:
    current: "1"
    "1":
      schema:
        tags: { enum: [[a], [b]] }
`,
      },
    });
    expect(errorList(report)).toEqual([
      [
        "auth/enum.yaml",
        "payload.1.schema.tags.enum",
        "enum is not allowed on an array field: use items.enum",
      ],
      [
        "auth/login.yaml",
        "payload.schema.tags.dict",
        "dict is not allowed on an array field: use items.dict",
      ],
      [
        "auth/login.yaml",
        "payload.schema.auth_method.minimum",
        "minimum applies only to number and integer fields (the type of 'auth_method' is string)",
      ],
      [
        "auth/login.yaml",
        "payload.schema.auth_method.items",
        "items applies only to array fields (the type of 'auth_method' is string)",
      ],
      [
        "auth/login.yaml",
        "payload.schema.n.maxLength",
        "maxLength applies only to string fields (the type of 'n' is integer)",
      ],
      [
        "auth/login.yaml",
        "payload.schema.n.pattern",
        "pattern applies only to string fields (the type of 'n' is integer)",
      ],
      [
        "auth/login.yaml",
        "payload.schema.flag.uniqueItems",
        "uniqueItems applies only to array fields (the type of 'flag' is boolean)",
      ],
    ]);
  });

  it("are not ignorable", async () => {
    const report = await validate({
      catalog: CATALOG,
      eventFiles: loginEvent("schema:\n  n: { maxLength: 3 }", 'ignore: [{ path: "payload::n" }]'),
    });
    expect(errorList(report)).toEqual([
      [
        "auth/login.yaml",
        "payload.schema.n.maxLength",
        "maxLength applies only to string fields (the type of 'n' is integer)",
      ],
    ]);
  });

  it("rejects them in opentp.yaml once, at the base layer that writes them", async () => {
    const report = await validate({
      catalog: `tags: { type: array, items: { type: string, minimum: 1 }, enum: [[a], [b]] }
n: { type: integer, minLength: 1 }`,
      spec: `targets:
  all:
    schema:
      tags: { maxItems: 3 }
      n: { format: email }
  ios:
    schema:
      n: { items: { type: string } }`,
      eventFiles: loginEvent("schema:\n  tags: {}\n  n: {}"),
    });
    expect(errorList(report)).toEqual([
      [
        "opentp.yaml",
        "spec.events.payload.schema.tags.enum",
        "enum is not allowed on an array field: use items.enum",
      ],
      [
        "opentp.yaml",
        "spec.events.payload.schema.tags.items.minimum",
        "minimum applies only to number and integer items (the item type of 'tags' is string)",
      ],
      [
        "opentp.yaml",
        "spec.events.payload.schema.n.minLength",
        "minLength applies only to string fields (the type of 'n' is integer)",
      ],
      [
        "opentp.yaml",
        "spec.targets.all.schema.n.format",
        "format applies only to string fields (the type of 'n' is integer)",
      ],
      [
        "opentp.yaml",
        "spec.targets.ios.schema.n.items",
        "items applies only to array fields (the type of 'n' is integer)",
      ],
    ]);
  });

  it("says that a restricted array field needs a value", async () => {
    const report = await validate({
      spec: `targets:
  all:
    schema:
      tags: { type: array, items: { type: string }, policy: restricted }`,
      eventFiles: {
        ...loginEvent("schema:\n  tags: { items: { enum: [a] } }"),
        "auth/valued.yaml": `opentp: 2026-09
event:
  key: auth::valued
  taxonomy: {}
  payload:
    schema:
      tags: { value: [a] }
`,
      },
    });
    expect(errorList(report)).toEqual([
      [
        "auth/login.yaml",
        "payload.web.schema.tags",
        "Field 'tags' has policy 'restricted': every event must restrict it with a value (enum and dict are not allowed on arrays)",
      ],
      [
        "auth/login.yaml",
        "payload.ios.schema.tags",
        "Field 'tags' has policy 'restricted': every event must restrict it with a value (enum and dict are not allowed on arrays)",
      ],
    ]);
  });

  it("accepts the keywords of the matching type", async () => {
    const report = await validate({
      catalog: `tags: { type: array, items: { type: string, minLength: 1 }, maxItems: 3 }
n: { type: integer, minimum: 0 }
s: { type: string, format: email }`,
      eventFiles: loginEvent(`schema:
  tags: { items: { enum: [a] }, minItems: 1, uniqueItems: true }
  n: { maximum: 9, multipleOf: 3 }
  s: { maxLength: 40 }`),
    });
    expect(errorList(report)).toEqual([]);
  });
});

// --- Checks on pii values and array items ------------------------------------------------------------

describe("checks on values written in opentp.yaml", () => {
  const SPEC_CHECKS = `checks:
  jira-key: { pattern: "^[A-Z]+-[0-9]+$" }`;

  it("run on pii meta values, kind and masker written in the catalog and spec.targets", async () => {
    const report = await validate({
      catalog: "user_name: { type: string, pii: { kind: email, ticket: NOPE } }",
      spec: `${SPEC_CHECKS}
targets:
  all:
    schema:
      email: { type: string, pii: { kind: x, ticket: "bad key" } }`,
      events: `pii:
  kind: { checks: { jira-key: true } }
  schema:
    ticket: { type: string, maxLength: 3, checks: { jira-key: true } }`,
      eventFiles: loginEvent("schema:\n  user_name: { pii: { kind: AB-1, ticket: A-2 } }"),
    });
    expect(errorList(report)).toEqual([
      ["opentp.yaml", "spec.events.payload.schema.user_name.pii.ticket", "Expected length <= 3"],
      ["opentp.yaml", "spec.targets.all.schema.email.pii.ticket", "Expected length <= 3"],
      [
        "opentp.yaml",
        "spec.events.payload.schema.user_name.pii.kind",
        `Value does not match pattern "^[A-Z]+-[0-9]+$" (check 'jira-key')`,
      ],
      [
        "opentp.yaml",
        "spec.events.payload.schema.user_name.pii.ticket",
        `Value does not match pattern "^[A-Z]+-[0-9]+$" (check 'jira-key')`,
      ],
      [
        "opentp.yaml",
        "spec.targets.all.schema.email.pii.kind",
        `Value does not match pattern "^[A-Z]+-[0-9]+$" (check 'jira-key')`,
      ],
      [
        "opentp.yaml",
        "spec.targets.all.schema.email.pii.ticket",
        `Value does not match pattern "^[A-Z]+-[0-9]+$" (check 'jira-key')`,
      ],
    ]);
  });

  it("run the portable checks of items on each item of an array example (catalog and events)", async () => {
    const report = await validate({
      catalog:
        "tickets: { type: array, items: { type: string, checks: { jira-key: true } }, example: [AB-1, nope] }",
      spec: SPEC_CHECKS,
      eventFiles: loginEvent("schema:\n  tickets: { example: [also-bad, CD-2] }"),
    });
    expect(errorList(report)).toEqual([
      [
        "opentp.yaml",
        "spec.events.payload.schema.tickets.example[1]",
        `Value does not match pattern "^[A-Z]+-[0-9]+$" (check 'jira-key')`,
      ],
      [
        "auth/login.yaml",
        "payload.web.schema.tickets.example[0]",
        `Value does not match pattern "^[A-Z]+-[0-9]+$" (check 'jira-key')`,
      ],
      [
        "auth/login.yaml",
        "payload.ios.schema.tickets.example[0]",
        `Value does not match pattern "^[A-Z]+-[0-9]+$" (check 'jira-key')`,
      ],
    ]);
  });
});

describe("a check bound to a rule that was not loaded", () => {
  it("is an unknownCheck with its own message that names the plugin gating", async () => {
    const files: PlanFiles = {
      catalog: "method: { type: string, checks: { mine: true } }",
      cli: "checks:\n  bindings:\n    mine: { rule: my-rule }\n  plugins: [plugins/rules]\n",
      eventFiles: loginEvent("schema:\n  method: { checks: { mine: true } }"),
    };
    const message =
      "Check 'mine' is bound to rule 'my-rule', which is not loaded: plugins from checks.plugins load only with --allow-plugins or OPENTP_ALLOW_PLUGINS=1";
    const report = await validate(files);
    expect(report.warnings.map((warning) => [warning.path, warning.message, warning.rule])).toEqual(
      [
        ["spec.events.payload.schema.method.checks.mine", message, "unknownCheck"],
        ["payload.schema.method.checks.mine", message, "unknownCheck"],
      ],
    );
    const failing = await validate(files, "--fail-on", "unknownCheck");
    expect(errorList(failing).map(([, , text]) => text)).toEqual([message, message]);
  });
});

// --- YAML merge keys -------------------------------------------------------------------------------

describe("YAML merge keys (<<)", () => {
  const MESSAGE = "YAML merge keys (<<) are not supported: write the keys out or use an alias";

  it("are errors in event files that an ignore entry cannot silence", async () => {
    const report = await validate({
      catalog: "method: { type: string, enum: [email, google] }\nmethod_2: { type: string }",
      eventFiles: loginEvent(
        `schema:
  method: &m { enum: [email], required: true }
  method_2: { <<: *m, title: Second method }`,
        'ignore: [{ path: "payload::method_2" }]',
      ),
    });
    expect(errorList(report)).toEqual([["auth/login.yaml", "payload.schema.method_2.<<", MESSAGE]]);
  });

  it("are errors in opentp.yaml and dictionaries, anywhere (also in data and extensions)", async () => {
    const root = writePlan({
      catalog: `base: &base { type: string }
method: { <<: *base, x-acme: { <<: { a: 1 } } }`,
      eventFiles: loginEvent("schema: {}"),
    });
    fs.writeFileSync(
      path.join(root, "dictionaries", "apps.yaml"),
      "opentp: 2026-09\ndict:\n  <<: { type: string }\n  values: [a]\n",
    );
    stdout = [];
    expect(await main(["validate", "--json", "--root", root])).toBe(EXIT_FAILURE);
    const report = JSON.parse(stdout.join("")) as Report;
    expect(errorList(report)).toEqual([
      ["dictionaries/apps.yaml", "dict.<<", MESSAGE],
      ["opentp.yaml", "spec.events.payload.schema.method.<<", MESSAGE],
      ["opentp.yaml", "spec.events.payload.schema.method.x-acme.<<", MESSAGE],
      // Nothing was merged
      [
        "opentp.yaml",
        "spec.events.payload.schema.method",
        "Field 'method' has no type: give it a type in the catalog or in spec.targets",
      ],
    ]);
  });

  it("are only plain << keys: a quoted '<<' is an ordinary key everywhere", async () => {
    const root = writePlan({
      catalog: `method: { type: string, x-acme: { "<<": heredoc marker } }`,
      eventFiles: loginEvent(
        "schema: { method: { x-acme: { '<<': a } } }",
        'x-acme-notes: { "<<": b }',
      ),
      cli: `x-acme: { "<<": c, nested: [{ '<<': d }] }\n`,
    });
    fs.writeFileSync(
      path.join(root, "dictionaries", "apps.yaml"),
      'opentp: 2026-09\ndict:\n  type: string\n  values: [a]\n  x-acme: { "<<": e }\n',
    );
    stdout = [];
    expect(await main(["validate", "--json", "--root", root])).toBe(EXIT_OK);
    expect(JSON.parse(stdout.join("")).errors).toEqual([]);
  });

  it("are found in the YAML text: a plain << inside an aliased mapping is reported once, where it is written", async () => {
    const report = await validate({
      catalog: `method: { type: string, x-acme: &x { <<: { a: 1 } } }
other: { type: string, x-acme: *x }`,
      eventFiles: loginEvent("schema: {}"),
    });
    expect(errorList(report)).toEqual([
      ["opentp.yaml", "spec.events.payload.schema.method.x-acme.<<", MESSAGE],
    ]);
  });

  it("stop every command in opentp.cli.yaml (exit 2)", async () => {
    const root = writePlan({
      catalog: "method: { type: string }",
      cli: "x-defaults: &d { overlap: error }\nchecks:\n  severity: { <<: *d }\n",
      eventFiles: loginEvent("schema: {}"),
    });
    expect(await main(["validate", "--root", root])).toBe(EXIT_USAGE);
    expect(stderr).toContain(`✗ opentp.cli.yaml: checks.severity.<<: ${MESSAGE}`);
  });
});

// --- opentp.yaml rules that the schemas enforce ------------------------------------------------------

describe("opentp.yaml rules that the 2026-09 schemas enforce", () => {
  const PLAN = (targets: string, rest = "") => `opentp: 2026-09
info: { title: Semantics, version: 1.0.0 }
spec:
  paths:
    events: { root: /events, template: "{area}/{event}.yaml" }
    dictionaries: { root: /dictionaries }
  events:
    taxonomy:
      area: { title: Area, type: string }
      event: { title: Event, type: string }
${rest}
    payload:
      targets: { all: ${targets} }
      schema:
        method: { type: string }
`;

  it("reports duplicate and empty target ids in targets.all", async () => {
    const report = await validate({
      opentp: PLAN('[web, web, "", ios]'),
      eventFiles: loginEvent("schema: {}"),
    });
    expect(errorList(report)).toEqual([
      ["opentp.yaml", "spec.events.payload.targets.all[1]", "Duplicate target id 'web'"],
      ["opentp.yaml", "spec.events.payload.targets.all[2]", "A target id must not be empty"],
    ]);
  });

  it("reports check ids that do not match the id pattern, in opentp.yaml and in events (errors)", async () => {
    const report = await validate({
      catalog: 'method: { type: string, checks: { "my check": true } }',
      eventFiles: loginEvent(
        'schema:\n  method: { checks: { "1st": true } }',
        'ignore: [{ path: "payload::method" }]',
      ),
    });
    const invalid = (id: string) =>
      `Invalid check id '${id}': it must start with a letter and contain only letters, digits, '_', '.' or '-'`;
    expect(errorList(report)).toEqual([
      ["opentp.yaml", "spec.events.payload.schema.method.checks.my check", invalid("my check")],
      ["auth/login.yaml", "payload.schema.method.checks.1st", invalid("1st")],
    ]);
    expect(report.warnings).toEqual([]);
  });

  it("reports enum together with dict in taxonomy fields, fragments and pii settings", async () => {
    const MESSAGE = "enum and dict cannot be used together";
    const report = await validate({
      opentp: PLAN(
        "[web]",
        `      team: { title: Team, type: string, enum: [auth], dict: owners }
      contact:
        title: Contact
        type: string
        template: "{name}<{mail}>"
        fragments:
          name: { title: Name, type: string, enum: [a], dict: owners }
          mail: { title: Mail, type: string }
    pii:
      kind: { enum: [a], dict: owners }
      masker: { enum: [a], dict: owners }
      schema:
        owner: { type: string, enum: [a], dict: owners }`,
      ),
      dictionaries: { owners: ["a", "auth"] },
      eventFiles: {
        "auth/login.yaml": `opentp: 2026-09
event:
  key: auth::login
  taxonomy: { team: auth, contact: "a<x>" }
  payload:
    schema: {}
`,
      },
    });
    expect(errorList(report)).toEqual([
      ["opentp.yaml", "spec.events.taxonomy.team", MESSAGE],
      ["opentp.yaml", "spec.events.taxonomy.contact.fragments.name", MESSAGE],
      ["opentp.yaml", "spec.events.pii.kind", MESSAGE],
      ["opentp.yaml", "spec.events.pii.masker", MESSAGE],
      ["opentp.yaml", "spec.events.pii.schema.owner", MESSAGE],
    ]);
  });
});
