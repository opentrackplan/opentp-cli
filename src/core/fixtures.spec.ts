import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenTPConfig, ValidationError } from "../types";
import { getDictsPath, getEventsPath, getEventsTemplate, loadConfig } from "./config";
import { loadDictionaries } from "./dict";
import { loadEvents } from "./event";
import { loadIssuesToErrors, validateEvents } from "./validator";

type FixtureName = "coverage-valid" | "coverage-invalid";
type ErrorTuple = [event: string, path: string, message: string];

interface FixtureOptions {
  /** External rule directories (absolute), like --external-rules */
  externalRules?: string[];
  /** Changes the loaded opentp.yaml before anything else runs */
  mutateConfig?: (config: OpenTPConfig) => void;
}

function fixtureRoot(fixtureName: FixtureName): string {
  return path.join(process.cwd(), "tests", "data", fixtureName);
}

// Code-point order (not localeCompare), so the result does not depend on the ICU locale
function compareTuples(a: ErrorTuple, b: ErrorTuple): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function toSortedTuples(errors: ValidationError[] | ErrorTuple[]): ErrorTuple[] {
  return errors
    .map((e): ErrorTuple => (Array.isArray(e) ? e : [e.event, e.path, e.message]))
    .sort(compareTuples);
}

/**
 * Mirrors the CLI validate pipeline (runValidate in cli.ts): config, dictionaries, events,
 * validation, with dictionary and event load issues mapped to errors the same way.
 */
async function runFixture(
  fixtureName: FixtureName,
  options: FixtureOptions = {},
): Promise<{ eventCount: number; errors: ValidationError[] }> {
  const root = fixtureRoot(fixtureName);
  const config = loadConfig(path.join(root, "opentp.yaml"));
  options.mutateConfig?.(config);

  const dictsPath = getDictsPath(config, root);
  const dictResult = dictsPath
    ? loadDictionaries(dictsPath, config.opentp)
    : { dictionaries: new Map(), issues: [] };

  const eventsPath = getEventsPath(config, root);
  const eventsTemplate = getEventsTemplate(config);

  expect(eventsPath).toBeTruthy();
  expect(eventsTemplate).toBeTruthy();

  const { events, issues } = loadEvents(eventsPath!, eventsTemplate!, config);

  const eventErrors = await validateEvents(
    events,
    config,
    dictResult.dictionaries,
    options.externalRules,
  );
  const errors = [...loadIssuesToErrors(dictResult.issues, issues), ...eventErrors];
  return { eventCount: events.length, errors };
}

const KEY_PATTERN_MESSAGE =
  'Key does not match pattern "^[a-z0-9_]+::[a-z0-9_]+::p[0-9]+::internal-(true|false)$"';
const MISSING_FIXED_VALUE =
  "Missing required fixed value: valueRequired=true requires a fixed 'value'";

/**
 * Every error expected from tests/data/coverage-invalid (order does not matter). The comparison is
 * exhaustive: a missing, extra or duplicated error fails the test.
 */
const COVERAGE_INVALID_ERRORS: ErrorTuple[] = [
  // opentp.yaml: config-level problems, reported once
  [
    "opentp.yaml",
    "spec.events.payload.targets.legacy",
    "Unknown target 'desktop' in group 'legacy'. Group members must be listed in spec.events.payload.targets.all.",
  ],
  [
    "opentp.yaml",
    "spec.events.taxonomy.action_detail.fragments.verb.dict",
    "Unknown dictionary 'taxonomy/verbs'",
  ],
  ["opentp.yaml", "spec.events.taxonomy.team.dict", "Unknown dictionary 'taxonomy/teams'"],
  [
    "opentp.yaml",
    "spec.targets.desktop",
    "Unknown target 'desktop'. Keys of spec.targets must be listed in spec.events.payload.targets.all.",
  ],

  // Dictionary issues
  [
    "dictionaries/broken/invalid_yaml.yaml",
    "",
    "Invalid YAML at line 7, column 1: Flow sequence in block collection must be sufficiently indented and end with a ]",
  ],
  ["dictionaries/taxonomy/areas.yaml", "dict.values", 'Duplicate values are not allowed: "auth"'],

  // Event files that could not be loaded
  [
    "auth/1/false/yaml_syntax_error.yaml",
    "",
    "Invalid YAML at line 9, column 20: Nested mappings are not allowed in compact mappings",
  ],
  ["auth/1/false/missing_event.yaml", "event", "Missing required field: event"],
  [
    "auth/1/false/missing_taxonomy.yaml",
    "event.taxonomy",
    "Missing required field: event.taxonomy",
  ],

  // Key
  ["auth/1/false/key_empty.yaml", "event.key", "Missing required field: event.key"],
  ["auth/1/false/key_mismatch.yaml", "event.key", KEY_PATTERN_MESSAGE],
  [
    "auth/1/false/key_mismatch.yaml",
    "event.key",
    "Key mismatch: got 'auth::key_mismatch__WRONG::p1::internal-false', expected 'auth::key_mismatch::p1::internal-false'",
  ],
  ["auth/1/maybe/boolean_type_violation.yaml", "event.key", KEY_PATTERN_MESSAGE],

  // Taxonomy
  [
    "auth/1/maybe/boolean_type_violation.yaml",
    "taxonomy.is_internal",
    "Expected boolean, got string",
  ],
  [
    "auth/5/false/priority_enum_violation.yaml",
    "taxonomy.priority_level",
    "Value '5' is not in allowed values for 'priority_level'",
  ],
  [
    "badarea/1/false/area_not_in_dict.yaml",
    "taxonomy.area",
    "Value 'badarea' is not in dictionary 'taxonomy/areas'",
  ],
  [
    "auth/1/false/fragments_missing.yaml",
    "taxonomy.action_detail",
    'Value does not match template "{verb}::{object}"',
  ],
  ["auth/1/false/unknown_check.yaml", "taxonomy.custom_id", "Unknown check: unknown-check"],
  [
    "auth/1/false/check_throws.yaml",
    "taxonomy.ticket",
    "check throwing-check failed: lookup service unavailable",
  ],

  // Payload resolution
  [
    "auth/1/false/payload_unknown_selector.yaml",
    "payload.desktop",
    "Unknown target selector 'desktop'. Define it in spec.events.payload.targets or include it in targets.all.",
  ],
  [
    "auth/1/false/payload_selector_no_targets.yaml",
    "payload.legacy",
    "Target selector 'legacy' does not cover any target listed in spec.events.payload.targets.all",
  ],
  [
    "auth/1/false/payload_ambiguous_selectors.yaml",
    "payload.ios",
    "Target 'ios' is covered by both 'mobile' and 'web_ios'. Each target must be covered at most once.",
  ],
  ["auth/1/false/payload_alias_cycle.yaml", "payload.web.aliases.a", "Alias cycle detected at 'b'"],
  ["auth/1/false/payload_alias_cycle.yaml", "payload.web.aliases.b", "Alias cycle detected at 'a'"],
  ["auth/1/false/payload_alias_cycle.yaml", "payload.web.current", "Alias cycle detected at 'a'"],
  [
    "auth/1/false/payload_ref_cycle.yaml",
    "payload.web.1.0.0.$ref",
    "Cycle detected in $ref: 1.0.0 -> 1.1.0",
  ],

  // A dict override must narrow the base enum or dict
  [
    "auth/1/false/payload_dict_override_not_subset.yaml",
    "payload.web.schema.sign_in_method.dict",
    "Dictionary 'data/application_id' has values [web-app, mobile-app, admin-panel] that are not in base enum [email, google]",
  ],
  [
    "auth/1/false/payload_dict_override_not_subset.yaml",
    "payload.web.schema.owner_team.dict",
    "Dictionary 'data/application_id' has values [web-app, mobile-app, admin-panel] that are not in dictionary 'governance/pii-owners'",
  ],

  // Payload fields
  [
    "auth/1/false/payload_missing_required.yaml",
    "payload.web.schema.application_id",
    "Cannot weaken required field (base required=true, override required=false)",
  ],
  [
    "auth/1/false/payload_missing_value_required.yaml",
    "payload.web.schema.application_id.value",
    MISSING_FIXED_VALUE,
  ],
  [
    "auth/1/false/payload_value_type_invalid.yaml",
    "payload.web.schema.application_id.value",
    "Expected scalar value, got object",
  ],
  [
    "auth/1/false/payload_value_type_invalid.yaml",
    "payload.web.schema.application_id.value",
    "Value '[object Object]' is not in dictionary 'data/application_id'",
  ],
  // Implicit `all` covers web, ios and android: the error repeats once per target
  [
    "auth/1/false/optional_constant_missing_value.yaml",
    "payload.web.schema.build_variant.value",
    MISSING_FIXED_VALUE,
  ],
  [
    "auth/1/false/optional_constant_missing_value.yaml",
    "payload.ios.schema.build_variant.value",
    MISSING_FIXED_VALUE,
  ],
  [
    "auth/1/false/optional_constant_missing_value.yaml",
    "payload.android.schema.build_variant.value",
    MISSING_FIXED_VALUE,
  ],
  [
    "auth/1/false/pii_meta_missing_required.yaml",
    "payload.web.schema.user_id.pii.owner",
    "Required pii metadata 'owner' is missing",
  ],
  [
    "auth/1/false/pii_missing_kind.yaml",
    "payload.web.schema.user_id.pii.kind",
    "pii.kind is required",
  ],
];

describe("fixtures", () => {
  it("validates tests/data/coverage-valid", async () => {
    const result = await runFixture("coverage-valid");
    expect(result.eventCount).toBe(4);
    expect(result.errors).toEqual([]);
  });

  it("reports exactly the expected errors in tests/data/coverage-invalid", async () => {
    const result = await runFixture("coverage-invalid", {
      externalRules: [path.join(fixtureRoot("coverage-invalid"), "external-rules")],
    });

    // 23 matching event files; yaml_syntax_error, missing_event and missing_taxonomy do not load
    expect(result.eventCount).toBe(20);
    expect(toSortedTuples(result.errors)).toEqual(toSortedTuples(COVERAGE_INVALID_ERRORS));
  });
});

describe("dict overrides", () => {
  it("a base enum that is not a list does not crash the dict override check", async () => {
    // onboarding_step_complete overrides auth_method with dict data/social_auth_methods
    const result = await runFixture("coverage-valid", {
      mutateConfig: (config) => {
        (config.spec.events.payload.schema.auth_method as { enum: unknown }).enum = "google";
      },
    });
    expect(result.eventCount).toBe(4);
    expect(result.errors.filter((error) => error.path.endsWith("auth_method.dict"))).toEqual([]);
  });

  it("a dict override that leaves the base enum is reported", async () => {
    const result = await runFixture("coverage-valid", {
      mutateConfig: (config) => {
        config.spec.events.payload.schema.auth_method.enum = ["email", "google"];
      },
    });
    // Reported for every target and version that carries the override (1.1.0 inherits it via $ref)
    const dictErrors = result.errors.filter((error) => error.path.endsWith(".auth_method.dict"));
    expect(dictErrors.map((error) => error.path).sort()).toEqual([
      "payload.ios.ios-1.schema.auth_method.dict",
      "payload.web.1.0.0.schema.auth_method.dict",
      "payload.web.1.1.0.schema.auth_method.dict",
    ]);
    for (const error of dictErrors) {
      expect(error.message).toBe(
        "Dictionary 'data/social_auth_methods' has values [github] that are not in base enum [email, google]",
      );
    }
  });
});

describe("config-level problems are reported once, against opentp.yaml", () => {
  it("duplicate path-template placeholder: no event is loaded, one error", async () => {
    const result = await runFixture("coverage-valid", {
      mutateConfig: (config) => {
        config.spec.paths.events.template = "{area}/{priority_level}/{area}/{event}.yaml";
      },
    });

    expect(result.eventCount).toBe(0);
    expect(toSortedTuples(result.errors)).toEqual([
      ["opentp.yaml", "spec.paths.events.template", "Duplicate placeholder '{area}'"],
    ]);
  });

  it("invalid path-template placeholder: no event is loaded, one error", async () => {
    const result = await runFixture("coverage-valid", {
      mutateConfig: (config) => {
        config.spec.paths.events.template = "{area}/{priority-level}/{is_internal}/{event}.yaml";
      },
    });

    expect(result.eventCount).toBe(0);
    expect(toSortedTuples(result.errors)).toEqual([
      [
        "opentp.yaml",
        "spec.paths.events.template",
        "Invalid placeholder '{priority-level}': names must start with a letter, '_' or '$' and contain only letters, digits, '_' or '$'",
      ],
    ]);
  });

  it("unknown keygen transform step: events load, one error and no per-event key errors", async () => {
    let index = -1;
    const result = await runFixture("coverage-valid", {
      mutateConfig: (config) => {
        const keygen = config.spec.events["x-opentp"]?.keygen;
        if (!keygen?.transforms?.slug) throw new Error("coverage-valid must define keygen 'slug'");
        index = keygen.transforms.slug.length;
        keygen.transforms.slug = [...keygen.transforms.slug, "to-pascal-case"];
      },
    });

    expect(result.eventCount).toBe(4);
    expect(toSortedTuples(result.errors)).toEqual([
      [
        "opentp.yaml",
        `spec.events.x-opentp.keygen.transforms.slug[${index}]`,
        "Unknown transform step 'to-pascal-case' (custom steps are loaded with --external-transforms)",
      ],
    ]);
  });

  it("unknown keygen pipeline: events load, one error and no per-event key errors", async () => {
    const result = await runFixture("coverage-valid", {
      mutateConfig: (config) => {
        const keygen = config.spec.events["x-opentp"]?.keygen;
        if (!keygen) throw new Error("coverage-valid must configure keygen");
        keygen.template = keygen.template.replace("{event | slug}", "{event | slugify}");
      },
    });

    expect(result.eventCount).toBe(4);
    expect(toSortedTuples(result.errors)).toEqual([
      [
        "opentp.yaml",
        "spec.events.x-opentp.keygen.template",
        "Unknown keygen pipeline 'slugify'. Define it in spec.events.x-opentp.keygen.transforms.",
      ],
    ]);
  });
});
