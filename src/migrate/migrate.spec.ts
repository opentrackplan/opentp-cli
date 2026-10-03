import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBindingProblems } from "../checks";
import { buildCheckEnvironment, getSeverities, loadCliConfig } from "../cliconfig";
import {
  getDictsPath,
  getEventsPath,
  getEventsTemplate,
  loadConfig,
  rootToolFiles,
} from "../core/config";
import { loadDictionaries } from "../core/dict";
import { loadEvents } from "../core/event";
import { errorsOnly, loadIssuesToErrors, validateEvents } from "../core/validator";
import type { ValidationError } from "../types";
import { type MigrateMode, migrate } from "./index";

const FIXTURE = path.join(process.cwd(), "tests", "data", "migrate-2026-01");
const EXPECTED = path.join(process.cwd(), "tests", "data", "migrate-2026-01.expected");

let tmpRoot: string;
let counter = 0;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opentp-migrate-spec-"));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/** A fresh copy of a directory (fixtures are never changed in place) */
function copy(source: string): string {
  counter += 1;
  const target = path.join(tmpRoot, `plan-${counter}`);
  fs.cpSync(source, target, { recursive: true });
  return target;
}

/** A plan made of the given files (relative path -> text) */
function plan(files: Record<string, string>): string {
  counter += 1;
  const root = path.join(tmpRoot, `plan-${counter}`);
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

/** Every file under a directory: relative path -> content (a symbolic link: its target) */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink())
        out.set(path.relative(dir, full).split(path.sep).join("/"), `-> ${fs.readlinkSync(full)}`);
      else if (entry.isDirectory()) walk(full);
      else
        out.set(path.relative(dir, full).split(path.sep).join("/"), fs.readFileSync(full, "utf-8"));
    }
  };
  walk(dir);
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : 1)));
}

function expectSameFiles(actual: string, expected: string): void {
  const got = snapshot(actual);
  const want = snapshot(expected);
  expect([...got.keys()]).toEqual([...want.keys()]);
  for (const [file, text] of want) {
    // Byte for byte, with the file name in the failure message
    expect({ file, text: got.get(file) }).toEqual({ file, text });
  }
}

function run(root: string, mode: MigrateMode = "write", cliConfig?: string) {
  return migrate({ root, mode, cliConfig });
}

/**
 * The validate pipeline of fixtures.spec.ts (and runValidate in cli.ts) on any plan root:
 * opentp.yaml, opentp.cli.yaml, dictionaries, events, validation.
 */
async function validatePlan(root: string): Promise<ValidationError[]> {
  const config = loadConfig(path.join(root, "opentp.yaml"));
  const cli = loadCliConfig(root, { planVersion: config.opentp });
  const keygen = cli?.config.keygen ?? null;
  expect(getBindingProblems(cli?.config.checks?.bindings ?? {}, config.spec.checks)).toEqual([]);
  const skipFiles = rootToolFiles(root);
  const dictsPath = getDictsPath(config, root);
  const dictResult = dictsPath
    ? loadDictionaries(dictsPath, config.opentp, { skipFiles })
    : { dictionaries: new Map(), issues: [] };
  const { events, issues } = loadEvents(
    getEventsPath(config, root) as string,
    getEventsTemplate(config) as string,
    config,
    { keygen, skipFiles },
  );
  expect(events.length).toBeGreaterThan(0);
  const results = [
    ...loadIssuesToErrors(dictResult.issues, issues),
    ...(await validateEvents(events, config, dictResult.dictionaries, {
      keygen,
      checks: buildCheckEnvironment(config, cli),
      severities: getSeverities(cli),
    })),
  ];
  return errorsOnly(results);
}

describe("opentp migrate: the 2026-01 fixture", () => {
  it("produces the expected files byte for byte", async () => {
    const root = copy(FIXTURE);
    const result = await run(root);

    expect(result.exitCode).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.manual).toEqual([]);
    expectSameFiles(root, EXPECTED);

    expect(result.changed.map((change) => change.file)).toEqual([
      "dictionaries/data/application_id.yaml",
      "dictionaries/taxonomy/areas.yaml",
      "events/auth/login.yaml",
      "events/auth/logout.yaml",
      "events/checkout/purchase.yaml",
      "templates/event.yaml",
      "opentp.yaml",
    ]);
    expect(result.created).toEqual([
      {
        file: "opentp.cli.yaml",
        kind: "cli-config",
        changes: ["keygen from opentp.yaml", "webhook bindings: webhook-1, webhook-2"],
      },
    ]);
    expect(result.changed.find((change) => change.file === "templates/event.yaml")).toEqual({
      file: "templates/event.yaml",
      kind: "event",
      outsideRoots: true,
      changes: ["opentp: 2026-01 -> 2026-09", "removed enum: []"],
    });
    expect(result.summary).toMatchObject({
      from: "2026-01",
      to: "2026-09",
      written: true,
      changed: 7,
      created: 1,
      manual: 0,
      catalog: { fields: 12, slots: ["dimension_4"] },
      movedBaseFields: 10,
      webhookBindings: ["webhook-1", "webhook-2"],
      keygenMoved: true,
    });
  });

  it("warns about every change of meaning", async () => {
    const result = await run(copy(FIXTURE), "dry-run");
    const warnings = result.warnings.map((warning) => [
      warning.file,
      warning.path,
      warning.message,
    ]);
    expect(warnings).toEqual([
      ["notes/other.yaml", "", "Has opentp: 2026-01 but no event or dict key: not migrated"],
      [
        "opentp.yaml",
        "spec.events.payload.schema.button_id",
        "Field 'button_id' is declared with different types in events: string (2), integer (1); the catalog uses string. Files with another type: templates/event.yaml",
      ],
      [
        "opentp.yaml",
        "spec.targets.all.schema.event_label",
        "valueRequired removed from 'event_label': 5 of 9 event versions do not pin a value, and 2026-09 has no 'this value if present' rule (pin it in every event and set policy: fixed, or leave the field free)",
      ],
      [
        "opentp.yaml",
        "spec.targets.all.schema.platform",
        "valueRequired removed from 'platform': only ios, android set a value in opentp.yaml; on web events no longer have to pin it",
      ],
      [
        "opentp.yaml",
        "spec.targets.all.schema.schema_version.required",
        "required: false next to value removed: the field is now always present (2026-09 has no optional constant; use versions for a transition period)",
      ],
      [
        "events/auth/login.yaml",
        "payload.schema.event_label.required",
        "required: false next to value removed: the field is now always present (2026-09 has no optional constant; use versions for a transition period)",
      ],
      [
        "events/auth/login.yaml",
        "payload.schema.button_id.valueRequired",
        "valueRequired removed: 2026-09 has no valueRequired (a policy on the catalog or common field says what every event must do)",
      ],
    ]);
  });

  it("changes nothing on a second run", async () => {
    const root = copy(FIXTURE);
    await run(root);
    const before = snapshot(root);
    const second = await run(root);
    expect(second.exitCode).toBe(0);
    expect(second.nothingToMigrate).toBe(true);
    expect(second.changed).toEqual([]);
    expect(second.created).toEqual([]);
    expect(snapshot(root)).toEqual(before);
    expect((await run(root, "check")).exitCode).toBe(0);
  });

  it("writes nothing with --check (exit 1) and --dry-run (exit 0)", async () => {
    const root = copy(FIXTURE);
    const check = await run(root, "check");
    expect(check.exitCode).toBe(1);
    expect(check.summary.written).toBe(false);
    expect(snapshot(root)).toEqual(snapshot(FIXTURE));

    const dryRun = await run(root, "dry-run");
    expect(dryRun.exitCode).toBe(0);
    expect(dryRun.changed).toHaveLength(7);
    expect(dryRun.created).toHaveLength(1);
    expect(snapshot(root)).toEqual(snapshot(FIXTURE));
  });

  it("resumes when only opentp.yaml was left (event files and opentp.cli.yaml written)", async () => {
    const root = copy(EXPECTED);
    fs.copyFileSync(path.join(FIXTURE, "opentp.yaml"), path.join(root, "opentp.yaml"));
    const result = await run(root);
    expect(result.exitCode).toBe(0);
    expect(result.changed.map((change) => change.file)).toEqual(["opentp.yaml"]);
    expect(result.created).toEqual([]);
    expect(result.manual).toEqual([]);
    expectSameFiles(root, EXPECTED);
  });

  it("resumes when only some event and dictionary files were written", async () => {
    const root = copy(FIXTURE);
    for (const file of ["events/checkout/purchase.yaml", "dictionaries/taxonomy/areas.yaml"]) {
      fs.copyFileSync(path.join(EXPECTED, file), path.join(root, file));
    }
    const result = await run(root);
    expect(result.exitCode).toBe(0);
    expect(result.changed.map((change) => change.file)).not.toContain(
      "events/checkout/purchase.yaml",
    );
    expectSameFiles(root, EXPECTED);
  });

  it("gives a plan that opentp validate accepts with zero errors", async () => {
    expect(await validatePlan(EXPECTED)).toEqual([]);
    const root = copy(FIXTURE);
    await run(root);
    expect(await validatePlan(root)).toEqual([]);
  });
});

const PLAN_2026_01 = `opentp: 2026-01
info:
  title: Small
  version: 1.0.0
spec:
  paths:
    events:
      root: /events
      template: "{area}/{event}.yaml"

  # Events
  events:
    taxonomy:
      area: { title: Area, type: string, required: true }
      event: { title: Event, type: string, required: true }
    payload:
      targets:
        all: [web, ios]
      schema:
        app_id: # comment survives the move
          type: string
          required: true
        level: { value: 2 }
`;

const EVENT_2026_01 = `opentp: 2026-01
event:
  key: shop::open
  taxonomy: {}
  payload:
    schema:
      screen: { type: string, example: 7 }
      tags: { type: array, items: { type: string }, example: [1, two, true] }
`;

describe("opentp migrate: opentp.yaml", () => {
  it("inserts spec.targets before spec.events (with its comments) when there is none", async () => {
    const root = plan({ "opentp.yaml": PLAN_2026_01, "events/shop/open.yaml": EVENT_2026_01 });
    const result = await run(root);
    expect(result.exitCode).toBe(0);
    expect(result.manual).toEqual([]);
    expect(fs.readFileSync(path.join(root, "opentp.yaml"), "utf-8")).toBe(`opentp: 2026-09
info:
  title: Small
  version: 1.0.0
spec:
  paths:
    events:
      root: /events
      template: "{area}/{event}.yaml"

  targets:
    all:
      schema:
        app_id: # comment survives the move
          type: string
          required: true
        level: { type: integer, value: 2 }

  # Events
  events:
    taxonomy:
      area: { title: Area, type: string, required: true }
      event: { title: Event, type: string, required: true }
    payload:
      targets:
        all: [web, ios]
      schema:
        screen: { type: string }
        tags: { type: array, items: { type: string } }
`);
    expect(fs.readFileSync(path.join(root, "events/shop/open.yaml"), "utf-8")).toBe(`opentp: 2026-09
event:
  key: shop::open
  taxonomy: {}
  payload:
    schema:
      screen: { type: string, example: "7" }
      tags: { type: array, items: { type: string }, example: ["1", two, "true"] }
`);
    // No keygen and no webhooks: no opentp.cli.yaml
    expect(fs.existsSync(path.join(root, "opentp.cli.yaml"))).toBe(false);
    expect(result.created).toEqual([]);
  });

  it("writes the catalog after payload.targets when the plan has no base fields", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01.replace(/ {6}schema:\n[\s\S]*$/, ""),
      "events/shop/open.yaml": EVENT_2026_01,
    });
    const result = await run(root);
    expect(result.manual).toEqual([]);
    expect(fs.readFileSync(path.join(root, "opentp.yaml"), "utf-8")).toContain(`    payload:
      targets:
        all: [web, ios]
      schema:
        screen: { type: string }
        tags: { type: array, items: { type: string } }
`);
    expect(result.summary.movedBaseFields).toBe(0);
  });

  it("handles files whose last line has no line break", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01.replace(
        "    taxonomy:\n",
        "    x-opentp:\n      keygen:\n        template: '{area}::{event}'\n    taxonomy:\n",
      ).replace(/\n$/, ""),
      "events/shop/open.yaml": EVENT_2026_01.replace(
        "screen: { type: string, example: 7 }",
        "screen: { type: string }",
      ).replace(
        /\n$/,
        "\n      label:\n        type: string\n        x-opentp:\n          checks:\n            webhook:\n              url: https://example.com/a",
      ),
      "opentp.cli.yaml":
        'opentp: 2026-09\nchecks:\n  bindings:\n    other:\n      webhook: { url: "https://example.com/b" }',
    });
    const result = await run(root);
    expect(result.errors).toEqual([]);
    expect(result.manual).toEqual([]);
    const config = fs.readFileSync(path.join(root, "opentp.yaml"), "utf-8");
    expect(config).toContain(
      "        level: { type: integer, value: 2 }\n\n  # Events\n  events:\n",
    );
    expect(config.endsWith("        tags: { type: array, items: { type: string } }\n")).toBe(true);
    expect(fs.readFileSync(path.join(root, "opentp.cli.yaml"), "utf-8")).toBe(
      `opentp: 2026-09
checks:
  bindings:
    other:
      webhook: { url: "https://example.com/b" }
    webhook-1:
      webhook:
        url: https://example.com/a

keygen:
  template: '{area}::{event}'
`,
    );
    expect(await validatePlan(root)).toEqual([]);
  });

  it("takes the type of fields that only name a dictionary from the dictionary", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01.replace(
        '      template: "{area}/{event}.yaml"\n',
        '      template: "{area}/{event}.yaml"\n    dictionaries:\n      root: /dictionaries\n',
      ).replace("        level: { value: 2 }\n", "        tier: { dict: tiers }\n"),
      "dictionaries/tiers.yaml": "opentp: 2026-01\ndict:\n  values: [1, 2, 3]\n",
      "dictionaries/data/countries.yml": "opentp: 2026-01\ndict:\n  type: string\n  values: [de]\n",
      "events/shop/open.yaml": EVENT_2026_01.replace(
        "    schema:\n",
        "    schema:\n      country: { dict: data/countries }\n      ranks: { type: array, items: { dict: tiers } }\n",
      ),
    });
    const result = await run(root);
    expect(result.warnings).toEqual([]);
    expect(result.manual).toEqual([]);
    const config = fs.readFileSync(path.join(root, "opentp.yaml"), "utf-8");
    expect(config).toContain("        tier: { type: integer, dict: tiers }\n");
    expect(config).toContain("        country: { type: string }\n");
    expect(config).toContain("        ranks: { type: array, items: { type: integer } }\n");
  });

  it("keeps CRLF line endings", async () => {
    const crlf = (text: string) => text.replace(/\n/g, "\r\n");
    const root = plan({
      "opentp.yaml": crlf(PLAN_2026_01),
      "events/shop/open.yaml": crlf(
        `${EVENT_2026_01}      flag:\n        type: boolean\n        enum: []\n`,
      ),
    });
    const result = await run(root);
    expect(result.exitCode).toBe(0);
    for (const file of ["opentp.yaml", "events/shop/open.yaml"]) {
      const text = fs.readFileSync(path.join(root, file), "utf-8");
      expect(text.replace(/\r\n/g, "")).not.toContain("\n");
      expect(text).toContain("opentp: 2026-09\r\n");
    }
    expect(fs.readFileSync(path.join(root, "events/shop/open.yaml"), "utf-8")).toContain(
      "      flag:\r\n        type: boolean\r\n",
    );
  });

  it("maps valueRequired on target fields and removes required next to policy: fixed", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01.replace(
        "\n  # Events\n",
        `
  targets:
    ios:
      schema:
        app_id:
          required: true
          valueRequired: true
        build: { type: string, valueRequired: false }

  # Events
`,
      ),
      "events/shop/open.yaml": EVENT_2026_01.replace(
        "    schema:\n",
        "    schema:\n      app_id: { value: shop }\n",
      ),
    });
    const result = await run(root);
    expect(result.manual).toEqual([]);
    const text = fs.readFileSync(path.join(root, "opentp.yaml"), "utf-8");
    expect(text).toContain(`    ios:
      schema:
        app_id:
          policy: fixed
        build: { type: string }
`);
  });

  it("keeps unknown x-opentp members, moves the rest and reports them under manual", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01.replace(
        "          required: true\n",
        "          required: true\n          x-opentp: { checks: { min-length: 2 }, owner: data }\n",
      ).replace(
        "    taxonomy:\n",
        "    x-opentp:\n      keygen:\n        template: '{area}::{event}'\n      lint: strict\n    taxonomy:\n",
      ),
      "events/shop/open.yaml": EVENT_2026_01.replace(
        "screen: { type: string, example: 7 }",
        "screen: { type: string, x-opentp: { role: constant, checks: { not-empty: true } } } # flow",
      ),
    });
    const result = await run(root);
    const text = fs.readFileSync(path.join(root, "opentp.yaml"), "utf-8");
    expect(text).toContain(
      "          required: true\n          checks: { min-length: 2 }\n          x-opentp: { owner: data }\n",
    );
    expect(text).toContain("    x-opentp:\n      lint: strict\n    taxonomy:\n");
    expect(fs.readFileSync(path.join(root, "events/shop/open.yaml"), "utf-8")).toContain(
      "screen: { type: string, checks: { not-empty: true } } # flow",
    );
    expect(result.manual.filter((item) => item.message.includes("no 2026-09 equivalent"))).toEqual([
      {
        file: "opentp.yaml",
        path: "spec.targets.all.schema.app_id.x-opentp.owner",
        message:
          "x-opentp.owner has no 2026-09 equivalent: move or remove it, then remove x-opentp",
      },
      {
        file: "opentp.yaml",
        path: "spec.events.x-opentp.lint",
        message:
          "spec.events.x-opentp.lint has no 2026-09 equivalent: move or remove it, then remove x-opentp",
      },
    ]);
    // validate still rejects the x-opentp that is left
    expect(result.manual.some((item) => item.path.endsWith("x-opentp"))).toBe(true);
  });

  it("migrates the remaining 2026-01 files of a plan whose opentp.yaml is on 2026-09", async () => {
    const root = copy(EXPECTED);
    fs.copyFileSync(
      path.join(FIXTURE, "events/auth/logout.yaml"),
      path.join(root, "events/auth/logout.yaml"),
    );
    fs.writeFileSync(
      path.join(root, "events/auth/extra.yaml"),
      "opentp: 2026-01\nevent:\n  key: auth::extra\n  taxonomy: {}\n  payload:\n    schema:\n      event_category: { value: auth }\n      event_name: { value: extra }\n      dimension_9: { example: 12 }\n",
    );
    const configBefore = fs.readFileSync(path.join(root, "opentp.yaml"), "utf-8");
    const result = await run(root);
    expect(result.exitCode).toBe(0);
    expect(fs.readFileSync(path.join(root, "opentp.yaml"), "utf-8")).toBe(configBefore);
    expect(fs.readFileSync(path.join(root, "events/auth/logout.yaml"), "utf-8")).toBe(
      fs.readFileSync(path.join(EXPECTED, "events/auth/logout.yaml"), "utf-8"),
    );
    // Not in the catalog: reported, not added
    expect(result.manual.map((item) => [item.file, item.path])).toContainEqual([
      "events/auth/extra.yaml",
      "payload.web.schema.dimension_9",
    ]);
    expect(fs.readFileSync(path.join(root, "events/auth/extra.yaml"), "utf-8")).toContain(
      "dimension_9: { example: 12 }",
    );
  });
});

describe("opentp migrate: opentp.cli.yaml", () => {
  const CLI_HEADER = `# yaml-language-server: $schema=https://opentp.dev/schemas/cli/opentp.cli.schema.json
opentp: 2026-09
cli: ">=0.10 <0.11"
`;
  const withWebhook = (url: string) =>
    EVENT_2026_01.replace(
      "screen: { type: string, example: 7 }",
      `screen: { type: string, x-opentp: { checks: { webhook: { url: "${url}" } } } }`,
    );

  it("merges into an existing file: same keygen, new bindings after the existing ones", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01.replace(
        "    taxonomy:\n",
        "    x-opentp:\n      keygen: { template: '{area}::{event}' }\n    taxonomy:\n",
      ),
      "events/shop/open.yaml": withWebhook("https://example.com/a"),
      "events/shop/close.yaml": withWebhook("https://example.com/b").replace(
        "shop::open",
        "shop::close",
      ),
      "opentp.cli.yaml": `opentp: 2026-01 # header
keygen:
  template: "{area}::{event}"
checks:
  bindings:
    webhook-1:
      webhook: { url: "https://example.com/b" }
    webhook-2:
      rule: pattern
      params: "^[a-z]+$"
`,
    });
    const result = await run(root);
    expect(result.errors).toEqual([]);
    expect(
      fs.readFileSync(path.join(root, "opentp.cli.yaml"), "utf-8"),
    ).toBe(`opentp: 2026-09 # header
keygen:
  template: "{area}::{event}"
checks:
  bindings:
    webhook-1:
      webhook: { url: "https://example.com/b" }
    webhook-2:
      rule: pattern
      params: "^[a-z]+$"
    webhook-3:
      webhook: { url: "https://example.com/a" }
`);
    expect(fs.readFileSync(path.join(root, "events/shop/close.yaml"), "utf-8")).toContain(
      "screen: { type: string, checks: { webhook-1: true } }",
    );
    expect(fs.readFileSync(path.join(root, "events/shop/open.yaml"), "utf-8")).toContain(
      "screen: { type: string, checks: { webhook-3: true } }",
    );
  });

  it("normalizes a copied webhook configuration: method upper-cased, unknown keys dropped with a warning", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01,
      // Block style: only the changed parts of the copied text change (comments stay)
      "events/auth/login.yaml": EVENT_2026_01.replace("shop::open", "auth::login").replace(
        "      screen: { type: string, example: 7 }\n",
        `      user_id:
        type: string
        x-opentp:
          checks:
            webhook:
              url: https://example.com/hooks/user # the user service
              method: post
              description: checks the user id
`,
      ),
      // Flow style: written from its data; the same configuration after normalization shares the id
      "events/auth/logout.yaml": EVENT_2026_01.replace("shop::open", "auth::logout").replace(
        "screen: { type: string, example: 7 }",
        'user_id: { type: string, x-opentp: { checks: { webhook: { url: "https://example.com/hooks/user", method: Post } } } }',
      ),
      "events/auth/view.yaml": EVENT_2026_01.replace("shop::open", "auth::view").replace(
        "screen: { type: string, example: 7 }",
        "screen: { type: string, x-opentp: { checks: { webhook: { url: https://example.com/hooks/screen, method: get, owner: web } } } }",
      ),
    });
    const result = await run(root);
    expect(result.errors).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.warnings).toEqual([
      {
        file: "events/auth/login.yaml",
        path: "payload.schema.user_id.x-opentp.checks.webhook.description",
        message:
          "Unknown webhook setting 'description': not copied to the binding in opentp.cli.yaml (a webhook binding takes url, method, headers, timeout, retries and cache)",
      },
      {
        file: "events/auth/view.yaml",
        path: "payload.schema.screen.x-opentp.checks.webhook.owner",
        message:
          "Unknown webhook setting 'owner': not copied to the binding in opentp.cli.yaml (a webhook binding takes url, method, headers, timeout, retries and cache)",
      },
    ]);
    expect(fs.readFileSync(path.join(root, "opentp.cli.yaml"), "utf-8")).toBe(`${CLI_HEADER}
checks:
  bindings:
    webhook-1:
      webhook:
        url: https://example.com/hooks/user # the user service
        method: POST
    webhook-2:
      webhook:
        url: https://example.com/hooks/screen
        method: GET
`);
    expect(fs.readFileSync(path.join(root, "events/auth/logout.yaml"), "utf-8")).toContain(
      "user_id: { type: string, checks: { webhook-1: true } }",
    );
    expect(await validatePlan(root)).toEqual([]);
  });

  it("stops at every source of a webhook configuration it cannot bind, not at opentp.cli.yaml", async () => {
    const hook = "{ url: https://example.com/hooks/user, method: patch, timeout: 2s }";
    const root = plan({
      "opentp.yaml": PLAN_2026_01,
      "events/auth/login.yaml": EVENT_2026_01.replace("shop::open", "auth::login").replace(
        "screen: { type: string, example: 7 }",
        `screen: { type: string, x-opentp: { checks: { webhook: ${hook} } } }`,
      ),
      "events/auth/logout.yaml": EVENT_2026_01.replace("shop::open", "auth::logout").replace(
        "screen: { type: string, example: 7 }",
        `screen: { type: string, x-opentp: { checks: { webhook: ${hook} } } }`,
      ),
    });
    const before = snapshot(root);
    const result = await run(root);
    expect(result.exitCode).toBe(1);
    const problems = [
      'method: Invalid option: expected one of "GET"|"POST"|"PUT"',
      "timeout: Invalid input: expected number, received string",
    ];
    expect(result.errors).toEqual(
      ["events/auth/login.yaml", "events/auth/logout.yaml"].flatMap((file) =>
        problems.map((problem) => ({
          file,
          path: "payload.schema.screen.x-opentp.checks.webhook",
          message: `Cannot become a webhook binding in opentp.cli.yaml (${problem}): fix the webhook configuration here and run opentp migrate again`,
        })),
      ),
    );
    expect(snapshot(root)).toEqual(before);
  });

  it("refuses a keygen that differs from the existing one (nothing written)", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01.replace(
        "    taxonomy:\n",
        "    x-opentp:\n      keygen: { template: '{area}::{event}' }\n    taxonomy:\n",
      ),
      "events/shop/open.yaml": EVENT_2026_01,
      "opentp.cli.yaml": "opentp: 2026-09\nkeygen:\n  template: '{event}'\n",
    });
    const before = snapshot(root);
    const result = await run(root);
    expect(result.exitCode).toBe(1);
    expect(result.errors[0].message).toContain("already has a keygen that differs");
    expect(snapshot(root)).toEqual(before);
  });

  it("stops with exit code 2 in an application repository (plan:)", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01,
      "opentp.cli.yaml": "opentp: 2026-09\nplan: ../plan\n",
    });
    const result = await run(root);
    expect(result.exitCode).toBe(2);
    expect(result.usageError).toContain("migrate edits the plan repository; run it there");

    // An application repository has no opentp.yaml: the same message, not "opentp.yaml not found"
    const app = await run(plan({ "opentp.cli.yaml": "opentp: 2026-09\nplan: ../plan\n" }));
    expect(app.exitCode).toBe(2);
    expect(app.usageError).toContain("migrate edits the plan repository; run it there");
  });
});

describe("opentp migrate: refusals", () => {
  it("exits 2 for a missing opentp.yaml, another version, or opentp.yaml next to opentp.yml", async () => {
    expect((await run(plan({ "events/a/b.yaml": EVENT_2026_01 }))).exitCode).toBe(2);
    const other = await run(plan({ "opentp.yaml": PLAN_2026_01.replace("2026-01", "2025-12") }));
    expect(other.exitCode).toBe(2);
    expect(other.usageError).toContain("upgrades 2026-01 plans");
    const both = await run(plan({ "opentp.yaml": PLAN_2026_01, "opentp.yml": PLAN_2026_01 }));
    expect(both.exitCode).toBe(2);
  });

  it("writes nothing when a plan file cannot be parsed (exit 1, the files listed)", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01,
      "events/shop/open.yaml": EVENT_2026_01,
      "events/shop/broken.yaml": "opentp: 2026-01\nevent: [\n",
      "drafts/other.yaml": "opentp: 2026-01\nkey: a\nkey: b\n",
      "misc/not-a-plan-file.yaml": "a: [\n",
    });
    const before = snapshot(root);
    const result = await run(root);
    expect(result.exitCode).toBe(1);
    expect(result.errors.map((error) => error.file)).toEqual([
      "drafts/other.yaml",
      "events/shop/broken.yaml",
    ]);
    expect(snapshot(root)).toEqual(before);
  });

  it("lists files with a 2026-01 header that are neither events nor dictionaries", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01,
      "events/shop/open.yaml": EVENT_2026_01,
      "events/shop/odd.yaml": "opentp: 2026-01\nevent: {}\ndict: {}\n",
    });
    const result = await run(root);
    expect(result.warnings).toContainEqual({
      file: "events/shop/odd.yaml",
      path: "",
      message: "Has opentp: 2026-01 and both an event and a dict key: not migrated",
    });
    expect(fs.readFileSync(path.join(root, "events/shop/odd.yaml"), "utf-8")).toContain(
      "opentp: 2026-01",
    );
  });

  it("completes slot families only when most of their numbers are used", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01,
      "events/shop/open.yaml": EVENT_2026_01.replace(
        "    schema:\n",
        `    schema:
      dimension_1: { type: string }
      dimension_3: { type: string }
      build_2025: { type: string }
      build_2026: { type: string }
      slot_2: { type: string }
      slot_5: { type: string }
`,
      ),
    });
    const result = await run(root);
    expect(result.summary.catalog.slots).toEqual(["dimension_2"]);
    expect(fs.readFileSync(path.join(root, "opentp.yaml"), "utf-8")).toContain(`      schema:
        build_2025: { type: string }
        build_2026: { type: string }
        dimension_1: { type: string }
        dimension_2: { type: string }
        dimension_3: { type: string }
        screen: { type: string }
        slot_2: { type: string }
        slot_5: { type: string }
        tags: { type: array, items: { type: string } }
`);
  });

  it("writes {} after the anchor of a definition left empty", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01,
      "events/shop/open.yaml": EVENT_2026_01.replace(
        "    schema:\n",
        "    schema:\n      slot_1: &slot # shared\n        enum: []\n      slot_2: *slot\n",
      ),
    });
    const result = await run(root);
    expect(result.errors).toEqual([]);
    expect(result.manual).toEqual([]);
    expect(fs.readFileSync(path.join(root, "events/shop/open.yaml"), "utf-8")).toContain(
      "      slot_1: &slot {} # shared\n      slot_2: *slot\n",
    );
  });

  it("migrates an events root outside the plan root", async () => {
    const workspace = plan({
      "plan/opentp.yaml": PLAN_2026_01.replace("root: /events", "root: ../events"),
      "events/shop/open.yaml": EVENT_2026_01,
    });
    const result = await run(path.join(workspace, "plan"));
    expect(result.exitCode).toBe(0);
    expect(result.manual).toEqual([]);
    expect(result.changed.map((change) => change.file)).toEqual([
      "../events/shop/open.yaml",
      "opentp.yaml",
    ]);
    expect(fs.readFileSync(path.join(workspace, "events/shop/open.yaml"), "utf-8")).toContain(
      'screen: { type: string, example: "7" }',
    );
  });

  it("does not follow symbolic links outside the events and dictionaries roots", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01,
      "events/shop/open.yaml": EVENT_2026_01,
      "shared/skeleton.yaml": EVENT_2026_01,
    });
    fs.symlinkSync(path.join(root, "shared/skeleton.yaml"), path.join(root, "link.yaml"));
    const result = await run(root);
    expect(result.warnings).toContainEqual({
      file: "link.yaml",
      path: "",
      message: "Symbolic link: not followed or migrated (migrate the file it points to)",
    });
    expect(fs.lstatSync(path.join(root, "link.yaml")).isSymbolicLink()).toBe(true);
  });
});

describe("opentp migrate: symbolic links", () => {
  it("follows a symlinked events root, like validate (F4, F28)", async () => {
    const workspace = plan({
      "plan/opentp.yaml": PLAN_2026_01,
      "shared/events/shop/open.yaml": EVENT_2026_01,
    });
    const root = path.join(workspace, "plan");
    fs.symlinkSync(path.join(workspace, "shared/events"), path.join(root, "events"), "dir");
    const result = await run(root);
    expect(result.errors).toEqual([]);
    expect(result.manual).toEqual([]);
    expect(result.changed.map((change) => change.file)).toEqual([
      "events/shop/open.yaml",
      "opentp.yaml",
    ]);
    expect(result.summary.catalog.fields).toBe(2);
    expect(fs.lstatSync(path.join(root, "events")).isSymbolicLink()).toBe(true);
    expect(
      fs.readFileSync(path.join(workspace, "shared/events/shop/open.yaml"), "utf-8"),
    ).toContain("opentp: 2026-09");
    expect(await validatePlan(root)).toEqual([]);
    expect((await run(root)).nothingToMigrate).toBe(true);
  });

  it("finishes 2026-01 event files under a symlinked events root of a 2026-09 plan", async () => {
    const workspace = plan({
      "plan/opentp.yaml": PLAN_2026_01,
      "shared/events/shop/open.yaml": EVENT_2026_01,
    });
    const root = path.join(workspace, "plan");
    fs.symlinkSync(path.join(workspace, "shared/events"), path.join(root, "events"), "dir");
    await run(root);
    fs.writeFileSync(path.join(workspace, "shared/events/shop/open.yaml"), EVENT_2026_01);
    const second = await run(root);
    expect(second.nothingToMigrate).toBe(false);
    expect(second.changed.map((change) => change.file)).toEqual(["events/shop/open.yaml"]);
  });

  it("follows a symlinked dictionaries root", async () => {
    const workspace = plan({
      "plan/opentp.yaml": PLAN_2026_01.replace(
        '      template: "{area}/{event}.yaml"\n',
        '      template: "{area}/{event}.yaml"\n    dictionaries:\n      root: /dictionaries\n',
      ).replace("        level: { value: 2 }\n", "        tier: { dict: tiers }\n"),
      "plan/events/shop/open.yaml": EVENT_2026_01,
      "shared/dictionaries/tiers.yaml": "opentp: 2026-01\ndict:\n  values: [1, 2, 3]\n",
    });
    const root = path.join(workspace, "plan");
    fs.symlinkSync(
      path.join(workspace, "shared/dictionaries"),
      path.join(root, "dictionaries"),
      "dir",
    );
    const result = await run(root);
    expect(result.errors).toEqual([]);
    expect(result.changed.map((change) => change.file)).toContain("dictionaries/tiers.yaml");
    expect(fs.readFileSync(path.join(root, "opentp.yaml"), "utf-8")).toContain(
      "        tier: { type: integer, dict: tiers }\n",
    );
    expect(
      fs.readFileSync(path.join(workspace, "shared/dictionaries/tiers.yaml"), "utf-8"),
    ).toContain("opentp: 2026-09");
  });

  it("writes a symlinked opentp.yaml and opentp.cli.yaml to their targets and keeps the links (F33)", async () => {
    const workspace = plan({
      "shared/opentp.yaml": PLAN_2026_01.replace(
        "    taxonomy:\n",
        "    x-opentp:\n      keygen: { template: '{area}::{event}' }\n    taxonomy:\n",
      ),
      "shared/opentp.cli.yaml": "opentp: 2026-09\n",
      "plan/events/shop/open.yaml": EVENT_2026_01,
    });
    const root = path.join(workspace, "plan");
    fs.symlinkSync(path.join(workspace, "shared/opentp.yaml"), path.join(root, "opentp.yaml"));
    fs.symlinkSync(
      path.join(workspace, "shared/opentp.cli.yaml"),
      path.join(root, "opentp.cli.yaml"),
    );
    const result = await run(root);
    expect(result.errors).toEqual([]);
    for (const name of ["opentp.yaml", "opentp.cli.yaml"]) {
      expect(fs.lstatSync(path.join(root, name)).isSymbolicLink()).toBe(true);
    }
    expect(fs.readFileSync(path.join(workspace, "shared/opentp.yaml"), "utf-8")).toContain(
      "opentp: 2026-09",
    );
    expect(fs.readFileSync(path.join(workspace, "shared/opentp.cli.yaml"), "utf-8")).toBe(
      "opentp: 2026-09\n\nkeygen: { template: '{area}::{event}' }\n",
    );
    expect(fs.readdirSync(path.join(workspace, "shared")).sort()).toEqual([
      "opentp.cli.yaml",
      "opentp.yaml",
    ]);
  });

  it("follows a symlinked event file inside the events root, like validate: the target is written, the link stays", async () => {
    const workspace = plan({
      "plan/opentp.yaml": PLAN_2026_01,
      "plan/events/shop/open.yaml": EVENT_2026_01,
      "shared/close.yaml": EVENT_2026_01.replace("shop::open", "shop::close"),
    });
    const root = path.join(workspace, "plan");
    fs.symlinkSync(
      path.join(workspace, "shared/close.yaml"),
      path.join(root, "events/shop/close.yaml"),
    );
    const result = await run(root);
    expect(result.errors).toEqual([]);
    expect(result.manual).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.changed.map((change) => change.file)).toEqual([
      "events/shop/close.yaml",
      "events/shop/open.yaml",
      "opentp.yaml",
    ]);
    expect(fs.lstatSync(path.join(root, "events/shop/close.yaml")).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(workspace, "shared/close.yaml"), "utf-8")).toBe(
      fs
        .readFileSync(path.join(root, "events/shop/open.yaml"), "utf-8")
        .replace("shop::open", "shop::close"),
    );
    expect(fs.readdirSync(path.join(workspace, "shared"))).toEqual(["close.yaml"]);
    expect(await validatePlan(root)).toEqual([]);
    expect((await run(root)).nothingToMigrate).toBe(true);
  });

  it("follows a symlinked dictionary file inside the dictionaries root", async () => {
    const workspace = plan({
      "plan/opentp.yaml": PLAN_2026_01.replace(
        '      template: "{area}/{event}.yaml"\n',
        '      template: "{area}/{event}.yaml"\n    dictionaries:\n      root: /dictionaries\n',
      ).replace("        level: { value: 2 }\n", "        tier: { dict: tiers }\n"),
      "plan/events/shop/open.yaml": EVENT_2026_01,
      "plan/dictionaries/.keep": "",
      "shared/tiers.yaml": "opentp: 2026-01\ndict:\n  values: [1, 2, 3]\n",
    });
    const root = path.join(workspace, "plan");
    fs.symlinkSync(
      path.join(workspace, "shared/tiers.yaml"),
      path.join(root, "dictionaries/tiers.yaml"),
    );
    const result = await run(root);
    expect(result.errors).toEqual([]);
    expect(result.changed.map((change) => change.file)).toContain("dictionaries/tiers.yaml");
    expect(fs.readFileSync(path.join(root, "opentp.yaml"), "utf-8")).toContain(
      "        tier: { type: integer, dict: tiers }\n",
    );
    expect(fs.lstatSync(path.join(root, "dictionaries/tiers.yaml")).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(workspace, "shared/tiers.yaml"), "utf-8")).toBe(
      "opentp: 2026-09\ndict:\n  values: [1, 2, 3]\n",
    );
  });

  it("migrates a file reached through a link and by its own path once, under its own path", async () => {
    const root = plan({ "opentp.yaml": PLAN_2026_01, "events/shop/open.yaml": EVENT_2026_01 });
    fs.symlinkSync(
      path.join(root, "events/shop/open.yaml"),
      path.join(root, "events/shop/link.yaml"),
    );
    const result = await run(root);
    expect(result.errors).toEqual([]);
    expect(result.changed.map((change) => change.file)).toEqual([
      "events/shop/open.yaml",
      "opentp.yaml",
    ]);
    expect(result.warnings).toEqual([
      {
        file: "events/shop/link.yaml",
        path: "",
        message: "Symbolic link to events/shop/open.yaml: migrated as that file (the link stays)",
      },
    ]);
    // validate reads the file twice (the same key): that is the only problem left
    expect(result.manual.map((item) => item.message)).toEqual([
      expect.stringMatching(/^Duplicate event key/),
    ]);
    expect(fs.lstatSync(path.join(root, "events/shop/link.yaml")).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(root, "events/shop/open.yaml"), "utf-8")).toContain(
      "opentp: 2026-09",
    );
  });

  it("warns about a symbolic link to a directory that it does not follow", async () => {
    const workspace = plan({
      "plan/opentp.yaml": PLAN_2026_01,
      "plan/events/shop/open.yaml": EVENT_2026_01,
      "other/shop/more.yaml": EVENT_2026_01,
    });
    const root = path.join(workspace, "plan");
    fs.symlinkSync(path.join(workspace, "other"), path.join(root, "events/linked"), "dir");
    const result = await run(root, "dry-run");
    expect(result.warnings).toContainEqual({
      file: "events/linked",
      path: "",
      message:
        "Symbolic link to a directory: not followed or migrated (opentp validate does not read it either)",
    });
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "writes nothing when a directory cannot be read",
    async () => {
      const root = plan({
        "opentp.yaml": PLAN_2026_01,
        "events/shop/open.yaml": EVENT_2026_01,
        "events/locked/a.yaml": EVENT_2026_01,
      });
      const before = snapshot(root);
      fs.chmodSync(path.join(root, "events/locked"), 0o000);
      try {
        const result = await run(root);
        expect(result.exitCode).toBe(1);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].file).toBe("events/locked");
        expect(result.errors[0].message).toMatch(/^Cannot read this directory/);
      } finally {
        fs.chmodSync(path.join(root, "events/locked"), 0o755);
      }
      expect(snapshot(root)).toEqual(before);
    },
  );

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "skips a directory outside the events and dictionaries roots that cannot be read, with a warning",
    async () => {
      const root = plan({
        "opentp.yaml": PLAN_2026_01,
        "events/shop/open.yaml": EVENT_2026_01,
        "volumes/db/data.yaml": "a: 1\n",
      });
      const locked = path.join(root, "volumes/db");
      fs.chmodSync(locked, 0o000);
      try {
        const warning = {
          file: "volumes/db",
          path: "",
          message: expect.stringMatching(
            /^Cannot read this directory \(.*\): skipped; a 2026-01 file in it would not be migrated$/,
          ),
        };
        const result = await run(root);
        expect(result.exitCode).toBe(0);
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([warning]);
        expect(result.changed.map((change) => change.file)).toEqual([
          "events/shop/open.yaml",
          "opentp.yaml",
        ]);

        // A migrated plan: still nothing to migrate, also with --check (exit 0)
        for (const mode of ["write", "check"] as const) {
          const again = await run(root, mode);
          expect(again.exitCode).toBe(0);
          expect(again.nothingToMigrate).toBe(true);
          expect(again.warnings).toEqual([warning]);
        }
      } finally {
        fs.chmodSync(locked, 0o755);
      }
    },
  );

  it("writes nothing when the events root is missing or a broken link", async () => {
    const missing = plan({ "opentp.yaml": PLAN_2026_01 });
    const result = await run(missing);
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([
      {
        file: "opentp.yaml",
        path: "spec.paths.events.root",
        message: `Events directory not found: ${path.join(missing, "events")}`,
      },
    ]);

    const broken = plan({ "opentp.yaml": PLAN_2026_01 });
    fs.symlinkSync(path.join(broken, "nowhere"), path.join(broken, "events"), "dir");
    const before = snapshot(broken);
    const second = await run(broken);
    expect(second.exitCode).toBe(1);
    expect(second.errors[0]).toMatchObject({ file: "events", path: "" });
    expect(second.errors[0].message).toMatch(/^Cannot read this directory/);
    expect(snapshot(broken)).toEqual(before);
  });
});

describe("opentp migrate: anchors and aliases", () => {
  it("stops when an alias would come before its anchor (F27)", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01.replace(
        "      area: { title: Area, type: string, required: true }",
        "      area: &str { title: Area, type: string, required: true }",
      ).replace(
        "        level: { value: 2 }\n",
        "        level: { value: 2 }\n        app_name: *str\n",
      ),
      "events/shop/open.yaml": EVENT_2026_01,
    });
    const before = snapshot(root);
    const result = await run(root);
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([
      {
        file: "opentp.yaml",
        path: "spec.targets.all.schema.app_name",
        message:
          "The alias *str needs the anchor &str set at spec.events.taxonomy.area, which the migration moves after the alias or removes: expand the alias (write the anchored content in its place) and run opentp migrate again",
      },
    ]);
    expect(snapshot(root)).toEqual(before);
  });

  it("binds a webhook check reused through an alias once and rewrites both places (F29)", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01.replace(
        "          required: true\n",
        '          required: true\n          x-opentp: { checks: { webhook: &hook { url: "https://example.com/a" } } }\n',
      ).replace(
        "        level: { value: 2 }\n",
        "        level: { value: 2 }\n        session_id:\n          type: string\n          x-opentp:\n            checks:\n              webhook: *hook\n",
      ),
      "events/shop/open.yaml": EVENT_2026_01.replace(
        "screen: { type: string, example: 7 }",
        'screen: { type: string, x-opentp: { checks: { webhook: { url: "https://example.com/a" } } } }',
      ),
    });
    const result = await run(root);
    expect(result.errors).toEqual([]);
    expect(result.manual).toEqual([]);
    expect(result.summary.webhookBindings).toEqual(["webhook-1"]);
    const config = fs.readFileSync(path.join(root, "opentp.yaml"), "utf-8");
    expect(config).toContain("          checks: { webhook-1: true }\n");
    expect(config).toContain("          checks:\n            webhook-1: true\n");
    expect(config).not.toContain("*hook");
    expect(fs.readFileSync(path.join(root, "events/shop/open.yaml"), "utf-8")).toContain(
      "screen: { type: string, checks: { webhook-1: true } }",
    );
    expect(fs.readFileSync(path.join(root, "opentp.cli.yaml"), "utf-8")).toContain(
      '    webhook-1:\n      webhook: { url: "https://example.com/a" }\n',
    );
    expect(await validatePlan(root)).toEqual([]);
  });

  it("migrates an x-opentp block reused through an alias (F29)", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01,
      "events/shop/open.yaml": EVENT_2026_01.replace(
        "    schema:\n",
        `    schema:
      user_id:
        type: string
        x-opentp: &ids
          role: identifier
          checks:
            not-empty: true
            webhook: { url: "https://example.com/ids" }
      session_id: { type: string, x-opentp: *ids }
      device_id:
        type: string
        x-opentp: *ids
`,
      ),
    });
    const result = await run(root);
    expect(result.errors).toEqual([]);
    expect(result.manual).toEqual([]);
    const event = fs.readFileSync(path.join(root, "events/shop/open.yaml"), "utf-8");
    expect(event).toContain(`      user_id:
        type: string
        checks:
          not-empty: true
          webhook-1: true
      session_id: { type: string, checks: { not-empty: true, webhook-1: true } }
      device_id:
        type: string
        checks: { not-empty: true, webhook-1: true }
`);
    expect(result.summary.webhookBindings).toEqual(["webhook-1"]);
    expect(await validatePlan(root)).toEqual([]);
  });

  it("binds a webhook configuration taken from an alias with its data", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01,
      "events/shop/open.yaml": `${EVENT_2026_01.replace(
        "screen: { type: string, example: 7 }",
        "screen: { type: string, x-opentp: { checks: { webhook: *hook } } }",
      ).replace(
        "  key: shop::open\n",
        '  key: shop::open\n  x-acme-hook: &hook { url: "https://example.com/h", retries: 2 }\n',
      )}`,
    });
    const result = await run(root);
    expect(result.errors).toEqual([]);
    expect(fs.readFileSync(path.join(root, "events/shop/open.yaml"), "utf-8")).toContain(
      "screen: { type: string, checks: { webhook-1: true } }",
    );
    expect(fs.readFileSync(path.join(root, "opentp.cli.yaml"), "utf-8")).toContain(
      "    webhook-1:\n      webhook:\n        url: https://example.com/h\n        retries: 2\n",
    );
  });

  it("moves a keygen that uses an alias with its data", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01.replace(
        "    taxonomy:\n",
        "    x-acme-template: &template '{area}::{event}'\n    x-opentp:\n      keygen:\n        template: *template\n    taxonomy:\n",
      ),
      "events/shop/open.yaml": EVENT_2026_01,
    });
    const result = await run(root);
    expect(result.errors).toEqual([]);
    expect(fs.readFileSync(path.join(root, "opentp.cli.yaml"), "utf-8")).toContain(
      'keygen:\n  template: "{area}::{event}"\n',
    );
    expect(fs.readFileSync(path.join(root, "opentp.yaml"), "utf-8")).not.toContain("x-opentp");
  });

  it("keeps an x-opentp alias whose mapping has members with no 2026-09 equivalent", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01,
      "events/shop/open.yaml": EVENT_2026_01.replace(
        "    schema:\n",
        `    schema:
      user_id:
        type: string
        x-opentp: &ids
          owner: data
          checks:
            not-empty: true
      session_id: { type: string, x-opentp: *ids }
`,
      ),
    });
    const result = await run(root);
    expect(result.errors).toEqual([]);
    const event = fs.readFileSync(path.join(root, "events/shop/open.yaml"), "utf-8");
    expect(event).toContain(
      "        checks:\n          not-empty: true\n        x-opentp: &ids\n          owner: data\n",
    );
    expect(event).toContain(
      "      session_id: { type: string, checks: { not-empty: true }, x-opentp: *ids }\n",
    );
    expect(result.manual.map((item) => item.path)).toContain(
      "payload.schema.session_id.x-opentp.owner",
    );
  });

  it("removes an aliased empty enum together with its anchor", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01,
      "events/shop/open.yaml": EVENT_2026_01.replace(
        "    schema:\n",
        "    schema:\n      kind: { type: string, enum: &none [] }\n      mode: { type: string, enum: *none }\n",
      ),
    });
    const result = await run(root);
    expect(result.errors).toEqual([]);
    expect(fs.readFileSync(path.join(root, "events/shop/open.yaml"), "utf-8")).toContain(
      "      kind: { type: string }\n      mode: { type: string }\n",
    );
  });

  it("stops when an anchor inside a removed node is still used elsewhere (F29)", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01,
      "events/shop/open.yaml": `${EVENT_2026_01.replace(
        "    schema:\n",
        "    schema:\n      user_id:\n        type: string\n        x-opentp:\n          role: &role identifier\n",
      )}x-acme-role: *role\n`,
    });
    const before = snapshot(root);
    const result = await run(root);
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([
      {
        file: "events/shop/open.yaml",
        path: "x-acme-role",
        message:
          "The alias *role needs the anchor &role set at event.payload.schema.user_id.x-opentp.role, which the migration moves after the alias or removes: expand the alias (write the anchored content in its place) and run opentp migrate again",
      },
    ]);
    expect(snapshot(root)).toEqual(before);
  });

  it("stops when spec.events.payload.schema is an alias (F30)", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01.replace(
        "\n  # Events\n",
        "\n  targets:\n    ios:\n      schema: &common\n        app_id: { type: string, required: true }\n\n  # Events\n",
      ).replace(
        / {6}schema:\n {8}app_id: # comment survives the move\n[\s\S]*$/,
        "      schema: *common\n",
      ),
      "events/shop/open.yaml": EVENT_2026_01,
    });
    const before = snapshot(root);
    const result = await run(root);
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([
      {
        file: "opentp.yaml",
        path: "spec.events.payload.schema",
        message:
          "An alias (*common): 2026-09 turns spec.events.payload.schema into the catalog and moves its fields to spec.targets.all.schema, which an alias cannot express. Expand the alias (write the fields in its place) and run opentp migrate again",
      },
    ]);
    expect(snapshot(root)).toEqual(before);
  });

  it("stops when spec.events.payload.schema has an anchor (F30)", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01.replace(
        "\n  # Events\n",
        "\n  targets:\n    ios:\n      schema:\n        build: { type: string }\n\n  # Events\n",
      )
        .replace(
          "      schema:\n        app_id: # comment survives the move\n",
          "      schema: &base\n        app_id: # comment survives the move\n",
        )
        .concat("x-acme-base: *base\n"),
      "events/shop/open.yaml": EVENT_2026_01,
    });
    const result = await run(root);
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([
      {
        file: "opentp.yaml",
        path: "spec.events.payload.schema",
        message:
          "Has the anchor &base (used by the alias at x-acme-base): 2026-09 turns spec.events.payload.schema into the catalog and moves its fields to spec.targets.all.schema, so the anchor cannot stay. Remove the anchor, write the fields in place of every alias to it, and run opentp migrate again",
      },
    ]);
  });
});

describe("opentp migrate: clean errors", () => {
  it("skips an unrelated YAML file that cannot be loaded, with a warning (F31)", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01,
      "events/shop/open.yaml": EVENT_2026_01,
      "ci/pipeline.yml": "jobs: { build: *missing }\n",
    });
    const result = await run(root);
    expect(result.exitCode).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContainEqual({
      file: "ci/pipeline.yml",
      path: "",
      message:
        "Cannot be loaded (Unresolved alias (the anchor must be set before the alias): missing): skipped (not a plan file)",
    });
  });

  it("lists a plan file with a dangling alias as a file that cannot be loaded", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01,
      "events/shop/open.yaml": `${EVENT_2026_01}      other: *missing\n`,
    });
    const result = await run(root);
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([
      {
        file: "events/shop/open.yaml",
        path: "",
        message: "Unresolved alias (the anchor must be set before the alias): missing",
      },
    ]);
  });

  it("reports an explicit key in the base schema with file and path (F31)", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01.replace(
        "        level: { value: 2 }\n",
        "        ? level\n        : value: 2\n",
      ),
      "events/shop/open.yaml": EVENT_2026_01,
    });
    const before = snapshot(root);
    const result = await run(root);
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([
      {
        file: "opentp.yaml",
        path: "spec.events.payload.schema.level",
        message:
          "Cannot be edited automatically (the key does not start its line): write it as a plain block mapping and run opentp migrate again",
      },
    ]);
    expect(snapshot(root)).toEqual(before);
  });

  it("reports a missing spec.events.payload (F31)", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01.replace(/ {4}payload:\n[\s\S]*$/, ""),
      "events/shop/open.yaml": EVENT_2026_01,
    });
    const result = await run(root);
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([
      {
        file: "opentp.yaml",
        path: "spec.events.payload",
        message: "Missing: add spec.events.payload (with targets.all) and run opentp migrate again",
      },
    ]);
  });

  it("asks for block style when spec.events.payload is a flow mapping (F32)", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01.replace(
        / {4}payload:\n[\s\S]*$/,
        "    payload: { targets: { all: [web] }, schema: { app: { type: string } } }\n",
      ),
      "events/shop/open.yaml": EVENT_2026_01,
    });
    const before = snapshot(root);
    const result = await run(root, "dry-run");
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([
      {
        file: "opentp.yaml",
        path: "spec.events.payload",
        message:
          "Written in flow style, which migrate cannot insert into: rewrite spec.events.payload in block style and run opentp migrate again",
      },
    ]);
    expect(snapshot(root)).toEqual(before);
  });
});

describe("opentp migrate: merge keys and opentp.cli.yaml", () => {
  it("lists YAML merge keys under manual (F21)", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01.replace(
        "        level: { value: 2 }\n",
        "        level: { value: 2 }\n        level_2: { <<: { value: 2 }, title: Level }\n",
      ),
      "events/shop/open.yaml": EVENT_2026_01.replace(
        "    schema:\n",
        "    schema:\n      method: &m { type: string, enum: [email, google] }\n      method_2: { <<: *m, title: Second method }\n",
      ),
    });
    const result = await run(root);
    expect(result.exitCode).toBe(0);
    const message =
      "YAML merge keys (<<) are not supported (2026-09 is YAML 1.2, where << is an ordinary key): write the merged keys out in this mapping";
    expect(result.manual.filter((item) => item.message === message)).toEqual([
      { file: "events/shop/open.yaml", path: "payload.schema.method_2.<<", message },
      { file: "opentp.yaml", path: "spec.targets.all.schema.level_2.<<", message },
    ]);
  });

  it("stops with exit code 2 when an existing opentp.cli.yaml has the wrong shape", async () => {
    const root = plan({
      "opentp.yaml": PLAN_2026_01,
      "events/shop/open.yaml": EVENT_2026_01,
      "opentp.cli.yaml":
        "opentp: 2026-09\nkeygen:\n  template: '{event}'\n  extra: 1\nunknown: 2\n",
    });
    const before = snapshot(root);
    const result = await run(root);
    expect(result.exitCode).toBe(2);
    expect(result.usageError).toBe(
      [
        'opentp.cli.yaml: keygen: Unrecognized key: "extra"',
        "opentp.cli.yaml: unknown: Unknown key 'unknown' (extensions start with 'x-')",
      ].join("\n"),
    );
    expect(snapshot(root)).toEqual(before);
  });
});
