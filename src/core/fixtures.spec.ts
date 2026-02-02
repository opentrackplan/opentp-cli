import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ValidationError } from "../types";
import { getDictsPath, getEventsPath, getEventsTemplate, loadConfig } from "./config";
import type { DictionaryIssue } from "./dict";
import { loadDictionaries } from "./dict";
import { loadEvents } from "./event";
import { validateEvents } from "./validator";

type FixtureName = "coverage-valid" | "coverage-invalid";

function sortDictIssues(issues: DictionaryIssue[]): DictionaryIssue[] {
  return [...issues].sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    return a.message.localeCompare(b.message);
  });
}

function sortValidationErrors(errors: ValidationError[]): ValidationError[] {
  return [...errors].sort((a, b) => {
    if (a.event !== b.event) return a.event.localeCompare(b.event);
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    if (a.message !== b.message) return a.message.localeCompare(b.message);
    return a.severity.localeCompare(b.severity);
  });
}

async function runFixture(fixtureName: FixtureName): Promise<{
  dictIssues: DictionaryIssue[];
  errors: ValidationError[];
}> {
  const root = path.join(process.cwd(), "tests", "data", fixtureName);
  const configPath = path.join(root, "opentp.yaml");
  const config = loadConfig(configPath);

  const dictsPath = getDictsPath(config, root);
  const dictResult = dictsPath
    ? loadDictionaries(dictsPath, config.opentp)
    : { dictionaries: new Map(), issues: [] };

  const eventsPath = getEventsPath(config, root);
  const eventsTemplate = getEventsTemplate(config);

  expect(eventsPath).toBeTruthy();
  expect(eventsTemplate).toBeTruthy();

  const events = loadEvents(eventsPath!, eventsTemplate!, config);
  expect(events.length).toBeGreaterThan(0);

  const errors = await validateEvents(events, config, dictResult.dictionaries);
  return {
    dictIssues: sortDictIssues(dictResult.issues),
    errors: sortValidationErrors(errors),
  };
}

describe("fixtures", () => {
  it("validates tests/data/coverage-valid", async () => {
    const result = await runFixture("coverage-valid");
    expect(result.dictIssues).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("detects expected errors in tests/data/coverage-invalid", async () => {
    const result = await runFixture("coverage-invalid");

    expect(result.dictIssues).toEqual([
      {
        file: "taxonomy/areas.yaml",
        path: "dict.values",
        message: 'Duplicate values are not allowed: "auth"',
      },
    ]);

    expect(result.errors.length).toBeGreaterThan(0);

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "badarea/1/false/area_not_in_dict.yaml",
          path: "taxonomy.area",
        }),
        expect.objectContaining({
          event: "auth/5/false/priority_enum_violation.yaml",
          path: "taxonomy.priority_level",
        }),
        expect.objectContaining({
          event: "auth/1/maybe/boolean_type_violation.yaml",
          path: "taxonomy.is_internal",
        }),
        expect.objectContaining({
          event: "auth/1/false/fragments_missing.yaml",
          path: "taxonomy.action_detail",
          message: expect.stringContaining("Value does not match template"),
        }),
        expect.objectContaining({
          event: "auth/1/false/key_mismatch.yaml",
          path: "event.key",
        }),
        expect.objectContaining({
          event: "auth/1/false/unknown_check.yaml",
          path: "taxonomy.custom_id",
          message: "Unknown check: unknown-check",
        }),
        expect.objectContaining({
          event: "auth/1/false/payload_unknown_selector.yaml",
          path: "payload.desktop",
        }),
        expect.objectContaining({
          event: "auth/1/false/payload_ambiguous_selectors.yaml",
          path: "payload.ios",
        }),
        expect.objectContaining({
          event: "auth/1/false/payload_alias_cycle.yaml",
          message: expect.stringContaining("Alias cycle detected"),
        }),
        expect.objectContaining({
          event: "auth/1/false/payload_ref_cycle.yaml",
          message: expect.stringContaining("Cycle detected in $ref"),
        }),
        expect.objectContaining({
          event: "auth/1/false/payload_missing_required.yaml",
          path: "payload.web.schema.application_id",
        }),
        expect.objectContaining({
          event: "auth/1/false/payload_value_type_invalid.yaml",
          path: "payload.web.schema.application_id.value",
        }),
        expect.objectContaining({
          event: "auth/1/false/payload_missing_value_required.yaml",
          path: "payload.web.schema.application_id.value",
        }),
        expect.objectContaining({
          event: "auth/1/false/optional_constant_missing_value.yaml",
          path: "payload.web.schema.build_variant.value",
        }),
        expect.objectContaining({
          event: "auth/1/false/pii_missing_kind.yaml",
          path: "payload.web.schema.user_id.pii.kind",
          message: "pii.kind is required",
        }),
        expect.objectContaining({
          event: "auth/1/false/pii_meta_missing_required.yaml",
          path: "payload.web.schema.user_id.pii.owner",
        }),
      ]),
    );
  });
});
