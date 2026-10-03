import path from "node:path";
import { describe, expect, it } from "vitest";
import { getBindingProblems, type Severities } from "../checks";
import { buildCheckEnvironment, type CliConfig, getSeverities, loadCliConfig } from "../cliconfig";
import { loadExternalRules } from "../rules";
import type { OpenTPConfig, ValidationError } from "../types";
import {
  getDictsPath,
  getEventsPath,
  getEventsTemplate,
  loadConfig,
  rootToolFiles,
} from "./config";
import { loadDictionaries } from "./dict";
import { loadEvents } from "./event";
import { errorsOnly, loadIssuesToErrors, validateEvents, warningsOnly } from "./validator";

type FixtureName = "coverage-valid" | "coverage-invalid";
type ErrorTuple = [event: string, path: string, message: string];

interface FixtureOptions {
  /** External rule directories (absolute), like --external-rules */
  externalRules?: string[];
  /** Changes the loaded opentp.yaml before anything else runs */
  mutateConfig?: (config: OpenTPConfig) => void;
  /** Changes the loaded opentp.cli.yaml before anything else runs */
  mutateCli?: (cli: CliConfig) => void;
  /** Overrides tool-rule severities (like --fail-on) */
  severities?: Partial<Severities>;
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
 * Mirrors the CLI validate pipeline (runValidate in cli.ts): opentp.yaml, opentp.cli.yaml, plugins,
 * dictionaries, events, validation, with dictionary and event load issues mapped to errors the same
 * way. Errors and warnings are returned apart.
 */
async function runFixture(
  fixtureName: FixtureName,
  options: FixtureOptions = {},
): Promise<{ eventCount: number; errors: ValidationError[]; warnings: ValidationError[] }> {
  const root = fixtureRoot(fixtureName);
  const config = loadConfig(path.join(root, "opentp.yaml"));
  options.mutateConfig?.(config);
  const cli = loadCliConfig(root, { planVersion: config.opentp });
  if (cli) options.mutateCli?.(cli.config);
  const keygen = cli?.config.keygen ?? null;

  for (const dir of options.externalRules ?? []) await loadExternalRules(dir);
  expect(getBindingProblems(cli?.config.checks?.bindings ?? {}, config.spec.checks)).toEqual([]);

  const skipFiles = rootToolFiles(root);
  const dictsPath = getDictsPath(config, root);
  const dictResult = dictsPath
    ? loadDictionaries(dictsPath, config.opentp, { skipFiles })
    : { dictionaries: new Map(), issues: [] };

  const eventsPath = getEventsPath(config, root);
  const eventsTemplate = getEventsTemplate(config);

  expect(eventsPath).toBeTruthy();
  expect(eventsTemplate).toBeTruthy();

  const { events, issues } = loadEvents(eventsPath!, eventsTemplate!, config, {
    keygen,
    skipFiles,
  });

  const eventErrors = await validateEvents(events, config, dictResult.dictionaries, {
    keygen,
    checks: buildCheckEnvironment(config, cli),
    severities: { ...getSeverities(cli), ...options.severities },
  });
  const results = [...loadIssuesToErrors(dictResult.issues, issues), ...eventErrors];
  return {
    eventCount: events.length,
    errors: errorsOnly(results),
    warnings: warningsOnly(results),
  };
}

const KEY_PATTERN_MESSAGE =
  'Key does not match pattern "^[a-z0-9_]+::[a-z0-9_]+::p[0-9]+::internal-(true|false)$"';
const REMOVED_X_OPENTP =
  "x-opentp was removed in 2026-09: move checks to 'checks', keygen to opentp.cli.yaml 'keygen', delete 'role'";
const REMOVED_VALUE_REQUIRED =
  "valueRequired was removed in 2026-09: set 'policy' on the catalog or common field";
const EMPTY_ENUM = "enum must have at least one value";
const UNKNOWN_FIELD = (field: string, target: string) =>
  `Unknown field '${field}': add it to the catalog (spec.events.payload.schema) or to spec.targets.all/${target}.schema`;
const MIGRATE_HINT =
  "Unsupported OpenTrackPlan schema version '2026-01'. Expected '2026-09'. Run \"opentp migrate\" to upgrade it.";

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
    "Unknown target 'desktop'. Keys of spec.targets must be 'all' or listed in spec.events.payload.targets.all.",
  ],
  // Keywords removed in 2026-09, once per occurrence
  ["opentp.yaml", "spec.targets.all.schema.application_id.valueRequired", REMOVED_VALUE_REQUIRED],
  ["opentp.yaml", "spec.events.payload.schema.user_id.x-opentp", REMOVED_X_OPENTP],
  [
    "opentp.yaml",
    "spec.checks.empty-check",
    "A portable check needs at least one of: minLength, maxLength, pattern, format, minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf",
  ],
  ["opentp.yaml", "spec.events.payload.schema.region.dict", "Unknown dictionary 'geo/regions'"],

  // Base layers (catalog, spec.targets.all, spec.targets.<T>): once, where the problem is written
  ["opentp.yaml", "spec.events.payload.schema.empty_choice.enum", EMPTY_ENUM],
  ["opentp.yaml", "spec.events.payload.schema.country_code.enum[1]", "Expected length <= 2"],
  ["opentp.yaml", "spec.events.payload.schema.country_code.example", "Expected length <= 2"],
  [
    "opentp.yaml",
    "spec.events.payload.schema.country_code.example",
    'Example "FRA" is not in allowed enum: [US, DEU]',
  ],
  ["opentp.yaml", "spec.targets.all.schema.sdk_name.value", "Expected string value, got number"],
  [
    "opentp.yaml",
    "spec.targets.all.schema.legacy_flag",
    "Field 'legacy_flag' is always present (it has a fixed value); remove required: false",
  ],
  [
    "opentp.yaml",
    "spec.targets.all.schema.client_build",
    "Code-facing name 'build_variant' is used by both 'build_variant' and 'client_build'",
  ],
  [
    "opentp.yaml",
    "spec.targets.ios.schema.application_id.policy",
    "Cannot lower policy 'fixed' to 'restricted'",
  ],
  [
    "opentp.yaml",
    "spec.targets.ios.schema.sign_in_method.enum",
    "Enum values [apple] are not in spec enum: [email, google]",
  ],
  [
    "opentp.yaml",
    "spec.targets.ios.schema.session_length",
    "Field type conflict: base 'integer' vs target 'number'",
  ],
  [
    "opentp.yaml",
    "spec.targets.ios.schema.os_name",
    "Field 'os_name' has no type: give it a type in the catalog or in spec.targets",
  ],

  // Dictionary issues
  [
    "dictionaries/broken/invalid_yaml.yaml",
    "",
    "Invalid YAML at line 7, column 1: Flow sequence in block collection must be sufficiently indented and end with a ]",
  ],
  ["dictionaries/taxonomy/areas.yaml", "dict.values", 'Duplicate values are not allowed: "auth"'],
  [
    "dictionaries/governance/pii-kinds.yml",
    "",
    "Both governance/pii-kinds.yaml and governance/pii-kinds.yml exist; keep one (governance/pii-kinds.yaml is used)",
  ],
  ["dictionaries/legacy/old_version.yaml", "opentp", MIGRATE_HINT],
  ["dictionaries/legacy/old_version.yaml", "dict.x-opentp", REMOVED_X_OPENTP],

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

  // An event file that still says 2026-01
  ["auth/1/false/old_version.yaml", "opentp", MIGRATE_HINT],

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
    "auth/1/false/payload_value_type_invalid.yaml",
    "payload.web.schema.application_id.value",
    "Expected scalar value, got object",
  ],
  [
    "auth/1/false/payload_value_type_invalid.yaml",
    "payload.web.schema.application_id.value",
    "Value '[object Object]' is not in dictionary 'data/application_id'",
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

  // Written in an event file: once per file at the written path (the implicit `all` payload of
  // optional_constant_missing_value.yaml covers three targets), never ignorable
  [
    "auth/1/false/payload_missing_value_required.yaml",
    "payload.web.schema.application_id.valueRequired",
    REMOVED_VALUE_REQUIRED,
  ],
  [
    "auth/1/false/optional_constant_missing_value.yaml",
    "payload.schema.build_variant.x-opentp",
    REMOVED_X_OPENTP,
  ],
  [
    "auth/1/false/payload_null_field.yaml",
    "payload.schema.user_id",
    "Field definition must be a mapping (write {} to list the field)",
  ],
  [
    "auth/1/false/webhook_check.yaml",
    "payload.schema.event_name.checks.webhook",
    "Webhook checks are bound in opentp.cli.yaml (checks.bindings.<id>.webhook); refer to them by id",
  ],

  // Closed vocabulary (per target, never ignorable), with suggestions
  [
    "auth/1/false/field_unknown.yaml",
    "payload.web.schema.event_nme",
    `${UNKNOWN_FIELD("event_nme", "web")}. Did you mean 'event_name'?`,
  ],
  [
    "auth/1/false/field_unknown.yaml",
    "payload.web.schema.Event_Category",
    `${UNKNOWN_FIELD("Event_Category", "web")}. Did you mean 'event_category'?`,
  ],
  [
    "auth/1/false/field_unknown.yaml",
    "payload.web.schema.dimension_",
    `${UNKNOWN_FIELD("dimension_", "web")}. Did you mean 'dimension_1', 'dimension_2' or 'dimension_3'?`,
  ],
  [
    "auth/1/false/field_unknown.yaml",
    "payload.android.schema.os_name",
    `${UNKNOWN_FIELD("os_name", "android")}. Did you mean 'sdk_name'?`,
  ],

  // Type conflicts with the catalog (never ignorable): the field and its items
  [
    "auth/1/false/field_type_conflict.yaml",
    "payload.web.schema.screen_name",
    "Field type conflict: base 'string' vs override 'integer'",
  ],
  [
    "auth/1/false/field_type_conflict.yaml",
    "payload.web.schema.tags.items",
    "Item type conflict: base 'string' vs override 'integer'",
  ],

  // Narrowing: event values, enums and item enums within the catalog enum or dictionary
  [
    "auth/1/false/field_narrowing.yaml",
    "payload.web.schema.sign_in_method.value",
    'Value "github" is not in allowed enum: [email, google]',
  ],
  [
    "auth/1/false/field_narrowing.yaml",
    "payload.web.schema.owner_team.value",
    "Value 'nobody' is not in dictionary 'governance/pii-owners'",
  ],
  [
    "auth/1/false/field_narrowing.yaml",
    "payload.web.schema.tags.items.enum",
    "Enum values [z] are not in spec enum: [a, b, c]",
  ],
  [
    "auth/1/false/field_narrowing.yaml",
    "payload.web.schema.country_code.enum",
    "Enum values [CA] are not in spec enum: [US, DEU]",
  ],

  // A fixed value of spec.targets.all cannot change or be replaced (never ignorable)
  [
    "auth/1/false/field_fixed_value.yaml",
    "payload.web.schema.schema_version.value",
    "Cannot change the fixed value 2 to 3",
  ],
  [
    "auth/1/false/field_fixed_value.yaml",
    "payload.ios.schema.schema_version.enum",
    "Cannot replace the fixed value 2 with an enum",
  ],
  [
    "auth/1/false/field_fixed_value.yaml",
    "payload.android.schema.schema_version.dict",
    "Cannot replace the fixed value 2 with a dictionary",
  ],

  // required: false on a field that is always present (never ignorable)
  [
    "auth/1/false/field_presence.yaml",
    "payload.web.schema.event_category",
    "Field 'event_category' is always present (its policy is 'restricted'); remove required: false",
  ],
  [
    "auth/1/false/field_presence.yaml",
    "payload.web.schema.schema_version",
    "Field 'schema_version' is always present (it has a fixed value); remove required: false",
  ],

  // Policy: specified, restricted (declared on spec.targets.all, restricted again on ios) and
  // fixed; a version with meta.deprecated is exempt, lifecycle.status is not
  [
    "auth/1/false/policy_violations.yaml",
    "payload.web.schema.application_id",
    "Field 'application_id' has policy 'fixed': every event must set its value",
  ],
  [
    "auth/1/false/policy_violations.yaml",
    "payload.web.schema.event_name",
    "Field 'event_name' has policy 'specified': every event must list it",
  ],
  [
    "auth/1/false/policy_violations.yaml",
    "payload.web.schema.event_category",
    "Field 'event_category' has policy 'restricted': every event must restrict it with value, enum or dict",
  ],
  [
    "auth/1/false/policy_deprecated.yaml",
    "payload.web.1.1.0.schema.event_category",
    "Field 'event_category' has policy 'restricted': every event must restrict it with value, enum or dict",
  ],
  [
    "auth/1/false/policy_in_event.yaml",
    "payload.schema.event_category.policy",
    "policy is set on catalog and common fields in opentp.yaml, not in events",
  ],

  // Code-facing names of one event version
  [
    "auth/1/false/code_names.yaml",
    "payload.web.schema.user_email",
    "Code-facing name 'user_email' is used by both 'screen_name' and 'user_email'",
  ],
  [
    "auth/1/false/code_names.yaml",
    "payload.web.schema.ticket_id",
    "Code-facing name 'build_variant' is used by both 'build_variant' and 'ticket_id'",
  ],

  // Examples are checked where they are written (an inherited one that no longer fits is dropped)
  [
    "auth/1/false/example_checks.yaml",
    "payload.web.schema.sign_in_method.example",
    'Example "google" is not in allowed enum: [email]',
  ],
  [
    "auth/1/false/example_checks.yaml",
    "payload.web.schema.screen_name.example",
    "Expected string value, got number",
  ],
  [
    "auth/1/false/example_checks.yaml",
    "payload.web.schema.ticket_id.example",
    "Value does not match pattern \"^[A-Z]+-[0-9]+$\" (check 'ticket-key')",
  ],
  [
    "auth/1/false/example_checks.yaml",
    "payload.ios.schema.plan_tier.example",
    'Example "gold" is not in allowed enum: [free, pro, team]',
  ],

  // Once per file at the written path, although the implicit payload covers three targets
  ["auth/1/false/enum_empty.yaml", "payload.schema.sign_in_method.enum", EMPTY_ENUM],
  [
    "auth/1/false/enum_empty.yaml",
    "payload.schema.owner_team.dict",
    "Unknown dictionary 'governance/teams'",
  ],

  // Ignore forms silence field-level checks only
  [
    "auth/1/false/ignore_forms.yaml",
    "payload.web.schema.schema_version.value",
    "Cannot change the fixed value 2 to 5",
  ],
  [
    "auth/1/false/ignore_forms.yaml",
    "payload.web.schema.unknown_field",
    UNKNOWN_FIELD("unknown_field", "web"),
  ],

  // Checks on fixed values: a portable check (spec.checks), format, a rule binding (opentp.cli.yaml)
  [
    "auth/1/false/value_checks_fail.yaml",
    "payload.web.schema.ticket_id.value",
    "Value does not match pattern \"^[A-Z]+-[0-9]+$\" (check 'ticket-key')",
  ],
  [
    "auth/1/false/value_checks_fail.yaml",
    "payload.web.schema.user_email.value",
    "Value is not a valid email",
  ],
  [
    "auth/1/false/value_checks_fail.yaml",
    "payload.web.schema.screen_name.value",
    "Length 15 exceeds maximum 5",
  ],
  [
    "auth/1/false/value_checks_fail.yaml",
    "payload.ios.schema.ticket_id.checks.ticket-key",
    "Check 'ticket-key' is defined in spec.checks: set it to true or false",
  ],
];

const UNKNOWN_CHECK = (id: string) =>
  `Unknown check '${id}': not in spec.checks, not a built-in or plugin check, not bound in opentp.cli.yaml`;

/** Every warning expected from tests/data/coverage-invalid (exhaustive, like the errors) */
const COVERAGE_INVALID_WARNINGS: ErrorTuple[] = [
  // Unknown check ids: once against opentp.yaml for opentp.yaml, once per event file otherwise
  [
    "opentp.yaml",
    "spec.events.taxonomy.custom_id.checks.unknown-check",
    UNKNOWN_CHECK("unknown-check"),
  ],
  [
    "auth/1/false/unknown_check.yaml",
    "payload.schema.event_name.checks.unknown-event-check",
    UNKNOWN_CHECK("unknown-event-check"),
  ],
  // A portable check named like a built-in check wins over it
  [
    "opentp.yaml",
    "spec.checks.ends-with",
    "spec.checks.ends-with shadows the tool check 'ends-with'",
  ],
];

describe("fixtures", () => {
  it("validates tests/data/coverage-valid", async () => {
    const result = await runFixture("coverage-valid");
    expect(result.eventCount).toBe(4);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("reports exactly the expected errors and warnings in tests/data/coverage-invalid", async () => {
    const result = await runFixture("coverage-invalid", {
      externalRules: [path.join(fixtureRoot("coverage-invalid"), "external-rules")],
    });

    // 39 matching event files; yaml_syntax_error, missing_event and missing_taxonomy do not load
    expect(result.eventCount).toBe(36);
    expect(toSortedTuples(result.errors)).toEqual(toSortedTuples(COVERAGE_INVALID_ERRORS));
    // Many of these minimal events overlap; overlap is covered by tests/data/overlap
    const warnings = result.warnings.filter((warning) => warning.rule !== "overlap");
    expect(toSortedTuples(warnings)).toEqual(toSortedTuples(COVERAGE_INVALID_WARNINGS));
    // Warnings of a tool rule say which rule
    expect(result.warnings.filter((warning) => warning.rule === "unknownCheck")).toHaveLength(2);
  });

  it("reports unknownCheck as errors with severity error, and not at all with off", async () => {
    const asErrors = await runFixture("coverage-invalid", {
      externalRules: [path.join(fixtureRoot("coverage-invalid"), "external-rules")],
      severities: { unknownCheck: "error" },
    });
    const unknown = asErrors.errors.filter((error) => error.rule === "unknownCheck");
    expect(unknown.map((error) => error.path).sort()).toEqual([
      "payload.schema.event_name.checks.unknown-event-check",
      "spec.events.taxonomy.custom_id.checks.unknown-check",
    ]);
    const off = await runFixture("coverage-invalid", { severities: { unknownCheck: "off" } });
    expect(off.warnings.filter((warning) => warning.rule === "unknownCheck")).toEqual([]);
    expect(off.errors.filter((error) => error.rule === "unknownCheck")).toEqual([]);
  });

  it("reports a check id that is not loaded as unknown, and runs nothing for it", async () => {
    // Registries are module-level (throwing-check may be loaded already): use an id nobody loads
    const result = await runFixture("coverage-invalid", {
      mutateConfig: (config) => {
        const ticket = config.spec.events.taxonomy.ticket;
        ticket.checks = { "not-loaded-check": true };
      },
    });
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        event: "opentp.yaml",
        path: "spec.events.taxonomy.ticket.checks.not-loaded-check",
        message: UNKNOWN_CHECK("not-loaded-check"),
        severity: "warning",
        rule: "unknownCheck",
      }),
    );
    expect(result.errors.filter((error) => error.path === "taxonomy.ticket")).toEqual([]);
  });
});

describe("dict overrides", () => {
  it("a base enum that is not a list does not crash the dict override check", async () => {
    // onboarding_step_complete overrides auth_method with dict data/social_auth_methods
    const result = await runFixture("coverage-valid", {
      mutateConfig: (config) => {
        (config.spec.events.payload.schema!.auth_method as { enum: unknown }).enum = "google";
      },
    });
    expect(result.eventCount).toBe(4);
    expect(result.errors.filter((error) => error.path.endsWith("auth_method.dict"))).toEqual([]);
  });

  it("a dict override that leaves the base enum is reported", async () => {
    const result = await runFixture("coverage-valid", {
      mutateConfig: (config) => {
        config.spec.events.payload.schema!.auth_method.enum = ["email", "google"];
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

  it("unknown keygen transform step: events load, one opentp.cli.yaml error and no per-event key errors", async () => {
    let index = -1;
    const result = await runFixture("coverage-valid", {
      mutateCli: (cli) => {
        const keygen = cli.keygen;
        if (!keygen?.transforms?.slug) throw new Error("coverage-valid must define keygen 'slug'");
        index = keygen.transforms.slug.length;
        keygen.transforms.slug = [...keygen.transforms.slug, "to-pascal-case"];
      },
    });

    expect(result.eventCount).toBe(4);
    expect(toSortedTuples(result.errors)).toEqual([
      [
        "opentp.cli.yaml",
        `keygen.transforms.slug[${index}]`,
        "Unknown transform step 'to-pascal-case' (custom steps: keygen.plugins in opentp.cli.yaml, or --external-transforms)",
      ],
    ]);
  });

  it("unknown keygen pipeline: events load, one opentp.cli.yaml error and no per-event key errors", async () => {
    const result = await runFixture("coverage-valid", {
      mutateCli: (cli) => {
        const keygen = cli.keygen;
        if (!keygen) throw new Error("coverage-valid must configure keygen");
        keygen.template = keygen.template.replace("{event | slug}", "{event | slugify}");
      },
    });

    expect(result.eventCount).toBe(4);
    expect(toSortedTuples(result.errors)).toEqual([
      [
        "opentp.cli.yaml",
        "keygen.template",
        "Unknown keygen pipeline 'slugify'. Define it in keygen.transforms.",
      ],
    ]);
  });

  it("without keygen in opentp.cli.yaml, keys are not compared", async () => {
    const result = await runFixture("coverage-invalid", {
      mutateCli: (cli) => {
        delete cli.keygen;
      },
    });
    expect(result.errors.filter((error) => error.message.startsWith("Key mismatch"))).toEqual([]);
  });
});
