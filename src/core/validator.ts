import {
  CHECK_ID_PATTERN,
  CheckEnvironment,
  DEFAULT_SEVERITIES,
  invalidCheckIdMessage,
  type Severities,
} from "../checks";
import { type CliTracker, getTrackerProblems, type TrackerOrigin } from "../cliconfig/tracker";
import type { RuleContext } from "../rules";
import type {
  ChecksMap,
  DictRef,
  Field,
  KeygenConfig,
  OpenTPConfig,
  PiiConfig,
  ResolvedEvent,
  TaxonomyField,
  ValidationError,
} from "../types";
import { getMatchTemplateProblems, getOwn, isYamlMapping, patternToRegex } from "../util";
import { type ConfigIssue, fileVersionMessage, getKeygenProblems, validateConfig } from "./config";
import {
  codePointLength,
  compilePattern,
  matchesFormat,
  numberConstraintProblems,
  stringConstraintProblems,
} from "./constraints";
import type { DictionaryIssue } from "./dict";
import { getDictValues } from "./dict";
import { walkConfigDocument } from "./document";
import type { EventLoadIssue } from "./event";
import {
  alwaysPresentMessage,
  analyzeBaseLayers,
  codeName,
  codeNameMessage,
  exampleProblems,
  isDeprecatedVersion,
  piiConfigOf,
  piiProblems,
  presenceReason,
  targetIds,
  typedKeywordProblems,
  unknownFieldMessage,
  type ValueProblem,
  valueProblems,
} from "./fields";
import { findOverlaps, overlapIgnores, overlapMessageWeight, overlapResults } from "./overlap";
import {
  BaseFieldCache,
  type DictionaryLookup,
  type EffectiveField,
  effectiveFields,
  mergeBaseLayers,
  resolveEventPayload,
  UNVERSIONED_VERSION_KEY,
} from "./payload";

/**
 * What a validation run needs besides the plan: the opentp.cli.yaml settings that add strictness.
 */
export interface ValidationSettings {
  /** `keygen` from opentp.cli.yaml: its problems are reported once, and keys are compared with it */
  keygen?: KeygenConfig | null;
  /** `tracker` from opentp.cli.yaml: its problems are reported once (event "opentp.cli.yaml") */
  tracker?: CliTracker | null;
  /**
   * Application repository mode: which keys of `tracker` come from the plan repository's file (their
   * problems carry its label)
   */
  trackerOrigin?: TrackerOrigin;
  /** How check ids resolve (default: spec.checks, built-in and loaded rules, no bindings) */
  checks?: CheckEnvironment;
  /** Severity of the tool rules (default: warning) */
  severities?: Severities;
  /**
   * Run the key checks of each event: a missing key, spec.events.key constraints and the keygen
   * comparison (default true). Application repository mode turns them off: keys are checked in the
   * plan repository.
   */
  keyChecks?: boolean;
  /**
   * Application repository mode: the plan is pinned by `plan:`, so an event file on the previous
   * version asks for another plan ref instead of `opentp migrate` (default false)
   */
  pinnedPlan?: boolean;
}

interface ResolvedSettings {
  keygen: KeygenConfig | null;
  checks: CheckEnvironment;
  severities: Severities;
  keyChecks: boolean;
  pinnedPlan: boolean;
}

function resolveSettings(config: OpenTPConfig, settings: ValidationSettings): ResolvedSettings {
  return {
    keygen: settings.keygen ?? null,
    checks: settings.checks ?? new CheckEnvironment({ specChecks: config.spec.checks }),
    severities: settings.severities ?? { ...DEFAULT_SEVERITIES },
    keyChecks: settings.keyChecks ?? true,
    pinnedPlan: settings.pinnedPlan ?? false,
  };
}

/**
 * The payload field that an ignore path (or a check path written in an event) names, 2026-09
 * grammar:
 * - `payload::<f>` names `<f>` (the only form for a field whose name contains `.`);
 * - a path that starts with `payload.` and contains `.schema.` names the segment right after the
 *   first `.schema.` (`payload.web.1.0.0.schema.user_id.value` -> `user_id`); the text before it
 *   is not interpreted;
 * - any other `payload.<seg>[.<more>]` names `<seg>` (later segments are keywords).
 */
export function payloadFieldOf(path: string): string | null {
  if (path.startsWith("payload::")) return path.slice("payload::".length) || null;
  if (!path.startsWith("payload.")) return null;
  const schemaMarker = ".schema.";
  const index = path.indexOf(schemaMarker);
  const rest =
    index === -1 ? path.slice("payload.".length) : path.slice(index + schemaMarker.length);
  return rest.split(".")[0] || null;
}

/** What an event's `ignore` list silences */
interface IgnoreList {
  /**
   * Literal paths with their aliases: `key`/`event.key` (key checks), `opentp` (the version
   * check), `taxonomy.<name>` (a taxonomy field or fragment), `overlap[.<key>]`
   */
  paths: Set<string>;
  /** Payload fields whose field-level checks are silenced on every target and version */
  fields: Set<string>;
}

function buildIgnoreList(ignoreChecks: Array<{ path: string }>): IgnoreList {
  const paths = new Set<string>();
  const fields = new Set<string>();

  for (const entry of ignoreChecks) {
    // Ignore entries are not schema-checked by the CLI: skip anything without a string path
    const path = isYamlMapping(entry) ? entry.path : undefined;
    if (typeof path !== "string") continue;
    paths.add(path);

    if (path === "key") paths.add("event.key");
    if (path === "event.key") paths.add("key");

    const field = payloadFieldOf(path);
    if (field !== null) fields.add(field);
  }

  return { paths, fields };
}

/**
 * Whether an event's `ignore` list silences the overlap warnings between it and the event with key
 * `otherKey`: `overlap` silences every overlap warning involving the event, `overlap.<key>` (all
 * text after the first `overlap.`) silences one pair. Either event of a pair can carry it.
 */
export function ignoresOverlap(ignore: Array<{ path: string }>, otherKey: string): boolean {
  const { all, keys } = overlapIgnores(ignore);
  return all || keys.has(otherKey);
}

function normalizeEventKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.trim() === "") return null;
  return value;
}

/**
 * Converts opentp.yaml configuration issues into validation errors with event "opentp.yaml"
 */
export function configIssuesToErrors(issues: ConfigIssue[]): ValidationError[] {
  return issues.map((issue) => ({
    event: "opentp.yaml",
    path: issue.path,
    message: issue.message,
    severity: "error" as const,
  }));
}

/**
 * Converts opentp.cli.yaml problems that do not stop a run (keygen and tracker problems) into
 * validation errors with event "opentp.cli.yaml", or the issue's own `file` label (a tracker key of
 * the plan repository's file in an application repository)
 */
export function cliConfigIssuesToErrors(issues: ConfigIssue[]): ValidationError[] {
  return issues.map((issue) => ({
    event: issue.file ?? "opentp.cli.yaml",
    path: issue.path,
    message: issue.message,
    severity: "error" as const,
  }));
}

/**
 * Converts dictionary and event-file load issues into validation errors, so that files that could
 * not be loaded fail the run. Dictionary issues are labelled "dictionaries/<file>", event issues
 * use the path relative to the events root (or "opentp.yaml" / "opentp.cli.yaml").
 */
export function loadIssuesToErrors(
  dictionaryIssues: DictionaryIssue[],
  eventIssues: EventLoadIssue[],
): ValidationError[] {
  return [
    ...dictionaryIssues.map((issue) => ({
      event: `dictionaries/${issue.file}`,
      path: issue.path,
      message: issue.message,
      severity: "error" as const,
    })),
    ...eventIssues.map((issue) => ({
      event: issue.file,
      path: issue.path,
      message: issue.message,
      severity: "error" as const,
    })),
  ];
}

/** Only the errors (warnings never fail a run) */
export function errorsOnly(results: ValidationError[]): ValidationError[] {
  return results.filter((result) => result.severity === "error");
}

/** Only the warnings */
export function warningsOnly(results: ValidationError[]): ValidationError[] {
  return results.filter((result) => result.severity === "warning");
}

/** Dictionary values by reference (null for an unknown dictionary) */
function dictionaryLookup(
  dictionaries: Map<string, (string | number | boolean)[]>,
): DictionaryLookup {
  return (dict) => getDictValues(dict, dictionaries);
}

/**
 * Validates all events and returns their errors and warnings (see `severity`).
 *
 * Also reports configuration problems once: validateConfig issues, keygen problems (event
 * "opentp.cli.yaml"), `dict` references in opentp.yaml to dictionaries that were not loaded, the
 * problems of the base layers that need dictionaries, the checks of values written in opentp.yaml,
 * spec.checks entries that shadow a tool check, and check ids written in opentp.yaml. Overlapping
 * events (tool rule `overlap`, see overlap.ts) are compared within `events` only.
 *
 * Plugins (rules, transform steps) must be loaded before: unknown check ids are reported here.
 *
 * @param events - Resolved events to validate
 * @param config - OpenTP configuration
 * @param dictionaries - Loaded dictionaries
 * @param settings - Settings from opentp.cli.yaml and the command line
 */
export async function validateEvents(
  events: ResolvedEvent[],
  config: OpenTPConfig,
  dictionaries: Map<string, (string | number | boolean)[]>,
  settings: ValidationSettings = {},
): Promise<ValidationError[]> {
  const resolved = resolveSettings(config, settings);
  const { checks, severities } = resolved;
  const errors: ValidationError[] = [];
  const lookup = dictionaryLookup(dictionaries);
  const configWalk = walkConfigDocument(config);

  // Config-level problems, reported once
  errors.push(...configIssuesToErrors(validateConfig(config)));
  errors.push(...cliConfigIssuesToErrors(getKeygenProblems(resolved.keygen, config)));
  errors.push(
    ...cliConfigIssuesToErrors(
      getTrackerProblems(settings.tracker, config, settings.trackerOrigin),
    ),
  );
  for (const ref of configWalk.dicts) {
    if (!isKnownDictionary(ref, dictionaries)) {
      errors.push({
        event: "opentp.yaml",
        path: ref.path,
        message: unknownDictionaryMessage(ref),
        severity: "error",
      });
    }
  }
  for (const issue of analyzeBaseLayers(config, lookup)) {
    if (issue.dictionary) {
      errors.push({
        event: "opentp.yaml",
        path: issue.path,
        message: issue.message,
        severity: "error",
      });
    }
  }
  errors.push(...(await checkBaseValues(config, checks)));
  errors.push(...checks.shadowWarnings());
  for (const ref of configWalk.checks) {
    // An id that does not match the pattern is reported by validateConfig
    if (!CHECK_ID_PATTERN.test(ref.id)) continue;
    const problem = checks.classify(ref, severities.unknownCheck);
    if (problem) errors.push({ event: "opentp.yaml", ...problem });
  }

  // 0. Unique event keys across the tracking plan
  const seenKeys = new Map<string, string>();
  for (const event of events) {
    const key = normalizeEventKey(event.key);
    if (key === null) continue;

    const prev = seenKeys.get(key);
    if (prev) {
      errors.push({
        event: event.relativePath,
        path: "event.key",
        message: `Duplicate event key '${key}' (already used in '${prev}')`,
        severity: "error",
      });
    } else {
      seenKeys.set(key, event.relativePath);
    }
  }

  const baseFields = new BaseFieldCache(config, lookup);
  for (const event of events) {
    const eventErrors = await validateEvent(event, config, dictionaries, resolved, baseFields);
    errors.push(...eventErrors);
  }

  // Events whose predicates can match the same hit (tool rule `overlap`; off skips the computation)
  if (severities.overlap !== "off") {
    const overlaps = findOverlaps(events, config, { lookup, baseFields });
    // Bounded per event (summaries), but a large plan can still have more results than
    // push(...) accepts as arguments
    for (const result of overlapResults(overlaps, severities.overlap)) errors.push(result);
  }

  return errors;
}

/** Whether a `dict` reference names a loaded dictionary */
function isKnownDictionary(
  ref: DictRef,
  dictionaries: Map<string, (string | number | boolean)[]>,
): boolean {
  return typeof ref.dict === "string" && getDictValues(ref.dict, dictionaries) !== null;
}

function unknownDictionaryMessage(ref: DictRef): string {
  return `Unknown dictionary '${String(ref.dict)}'`;
}

/** A `checks` map of a definition, or null */
function checksOf(definition: { checks?: unknown }): ChecksMap | null {
  return isYamlMapping(definition.checks) ? definition.checks : null;
}

/**
 * Runs checks on one value at `valuePath`; for an array value on each item (`<valuePath>[<i>]`).
 * Returns the error messages by path.
 */
async function runValueChecks(
  checks: CheckEnvironment,
  value: unknown,
  fieldChecks: ChecksMap,
  context: { fieldName: string; eventKey: string },
  valuePath: string,
): Promise<Array<{ path: string; message: string }>> {
  const results: Array<{ path: string; message: string }> = [];
  if (Object.keys(fieldChecks).length === 0) return results;
  const values = Array.isArray(value) ? value : [value];
  for (const [index, item] of values.entries()) {
    const itemPath = Array.isArray(value) ? `${valuePath}[${index}]` : valuePath;
    const ctx: RuleContext = { ...context, fieldPath: itemPath };
    for (const ruleError of await checks.run(item, fieldChecks, ctx)) {
      results.push({ path: itemPath, message: ruleError.error || "Validation failed" });
    }
  }
  return results;
}

/**
 * The `checks` of the pii setting for one pii key: `spec.events.pii.kind`, `.masker` or
 * `.schema.<key>` (null when there is none)
 */
function piiKeyChecks(piiConfig: PiiConfig | undefined, key: string): ChecksMap | null {
  if (!piiConfig) return null;
  const keyConfig =
    key === "kind" || key === "masker"
      ? piiConfig[key]
      : isYamlMapping(piiConfig.schema)
        ? getOwn(piiConfig.schema, key)
        : undefined;
  return isYamlMapping(keyConfig) ? checksOf(keyConfig) : null;
}

/**
 * Runs the checks of the values written in opentp.yaml once, where they are written: every check
 * on fixed values (each item of an array) and on pii values (the checks of the pii settings),
 * portable checks on enum members and examples (the items of an array example also get the
 * portable checks of `items`)
 */
async function checkBaseValues(
  config: OpenTPConfig,
  checks: CheckEnvironment,
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];
  const seen = new Set<string>();
  const piiConfig = piiConfigOf(config);
  const push = (results: Array<{ path: string; message: string }>) => {
    for (const { path, message } of results) {
      errors.push({ event: "opentp.yaml", path, message, severity: "error" });
    }
  };

  for (const targetId of ["all", ...targetIds(config)]) {
    for (const site of mergeBaseLayers(config, targetId).sites) {
      if (seen.has(site.path)) continue;
      seen.add(site.path);
      const { written, merged, name } = site;
      const context = { fieldName: name, eventKey: "" };
      const fieldChecks = checksOf(merged);
      const portable = fieldChecks ? checks.portableOnly(fieldChecks) : {};
      const itemChecks = isYamlMapping(merged.items) ? checksOf(merged.items) : null;
      const itemPortable = itemChecks ? checks.portableOnly(itemChecks) : {};

      if (written.value !== undefined) {
        const path = `${site.path}.value`;
        if (fieldChecks)
          push(await runValueChecks(checks, merged.value, fieldChecks, context, path));
        if (itemChecks && Array.isArray(merged.value)) {
          push(await runValueChecks(checks, merged.value, itemChecks, context, path));
        }
      }
      // A top-level enum on an array is reported as such (typedKeywordProblems)
      if (Array.isArray(written.enum) && merged.type !== "array") {
        for (const [index, member] of written.enum.entries()) {
          push(
            await runValueChecks(checks, member, portable, context, `${site.path}.enum[${index}]`),
          );
        }
      }
      if (isYamlMapping(written.items) && Array.isArray(written.items.enum)) {
        for (const [index, member] of written.items.enum.entries()) {
          push(
            await runValueChecks(
              checks,
              member,
              itemPortable,
              context,
              `${site.path}.items.enum[${index}]`,
            ),
          );
        }
      }
      if (written.example !== undefined) {
        const path = `${site.path}.example`;
        push(await runValueChecks(checks, written.example, portable, context, path));
        if (Array.isArray(written.example)) {
          push(await runValueChecks(checks, written.example, itemPortable, context, path));
        }
      }
      // The pii values written here (each key's checks from spec.events.pii)
      if (isYamlMapping(written.pii) && isYamlMapping(merged.pii)) {
        for (const key of Object.keys(written.pii)) {
          const keyChecks = piiKeyChecks(piiConfig, key);
          const value = getOwn(merged.pii, key);
          if (!keyChecks || value === undefined) continue;
          push(
            await runValueChecks(
              checks,
              value,
              keyChecks,
              { fieldName: `${name}.pii.${key}`, eventKey: "" },
              `${site.path}.pii.${key}`,
            ),
          );
        }
      }
    }
  }
  return errors;
}

/**
 * Validates a single event
 */
export async function validateEvent(
  event: ResolvedEvent,
  config: OpenTPConfig,
  dictionaries: Map<string, (string | number | boolean)[]>,
  settings: ValidationSettings = {},
  baseFields: BaseFieldCache = new BaseFieldCache(config, dictionaryLookup(dictionaries)),
): Promise<ValidationError[]> {
  const resolved = resolveSettings(config, settings);
  const errors: ValidationError[] = [];
  const ignoreList = buildIgnoreList(event.ignore);
  const ignore = ignoreList.paths;
  /** A check or dictionary reference in a payload field that the event ignores */
  const ignoredField = (ref: { path: string; field?: string }): boolean => {
    // The walk knows the field key; parsing the path would cut a name such as `a.b` at the dot
    const field = ref.field ?? payloadFieldOf(ref.path);
    return field !== null && ignoreList.fields.has(field);
  };

  // Problems found in the raw file while loading it (removed keywords, field definitions that are
  // not mappings, `policy`, empty enums): never ignorable
  for (const issue of event.fileIssues ?? []) {
    errors.push({
      event: event.relativePath,
      path: issue.path,
      message: issue.message,
      severity: "error",
    });
  }

  // Check ids written in the file: classified once per file, never per target or version. An id
  // that does not match the pattern is invalid shape, not a field-level check: never ignorable.
  for (const ref of event.checkRefs ?? []) {
    if (!CHECK_ID_PATTERN.test(ref.id)) {
      errors.push({
        event: event.relativePath,
        path: `${ref.path}.${ref.id}`,
        message: invalidCheckIdMessage(ref.id),
        severity: "error",
      });
      continue;
    }
    const problem = resolved.checks.classify(ref, resolved.severities.unknownCheck);
    if (!problem || ignoredField(ref)) continue;
    errors.push({ event: event.relativePath, ...problem });
  }

  // Dictionaries written in the file: an unknown one is reported once, where it is written
  for (const ref of event.dictRefs ?? []) {
    if (isKnownDictionary(ref, dictionaries) || ignoredField(ref)) continue;
    errors.push({
      event: event.relativePath,
      path: ref.path,
      message: unknownDictionaryMessage(ref),
      severity: "error",
    });
  }

  // 0. Spec version validation (event file)
  if (!ignore.has("opentp")) {
    const eventVersion = event.opentp;
    if (typeof eventVersion !== "string") {
      errors.push({
        event: event.relativePath,
        path: "opentp",
        message: "Missing required field: opentp",
        severity: "error",
      });
    } else if (eventVersion !== config.opentp) {
      errors.push({
        event: event.relativePath,
        path: "opentp",
        message: fileVersionMessage(eventVersion, config.opentp, resolved.pinnedPlan),
        severity: "error",
      });
    }
  }

  // 1. Key validation (not in application repository mode)
  if (resolved.keyChecks && !ignore.has("key")) {
    const key = normalizeEventKey(event.key);
    const constraints = config.spec.events.key;

    if (key === null) {
      errors.push({
        event: event.relativePath,
        path: "event.key",
        message: "Missing required field: event.key",
        severity: "error",
      });
    } else {
      const keyLength = codePointLength(key);
      if (typeof constraints?.minLength === "number" && keyLength < constraints.minLength) {
        errors.push({
          event: event.relativePath,
          path: "event.key",
          message: `Key length must be >= ${constraints.minLength}`,
          severity: "error",
        });
      }

      if (typeof constraints?.maxLength === "number" && keyLength > constraints.maxLength) {
        errors.push({
          event: event.relativePath,
          path: "event.key",
          message: `Key length must be <= ${constraints.maxLength}`,
          severity: "error",
        });
      }

      if (typeof constraints?.pattern === "string") {
        const re = compilePattern(constraints.pattern);
        // An invalid regex is reported once against opentp.yaml (validateConfig)
        if (re && !re.test(key)) {
          errors.push({
            event: event.relativePath,
            path: "event.key",
            message: `Key does not match pattern ${JSON.stringify(constraints.pattern)}`,
            severity: "error",
          });
        }
      }

      if (constraints?.format !== undefined && !matchesFormat(constraints.format, key)) {
        errors.push({
          event: event.relativePath,
          path: "event.key",
          message: `Value is not a valid ${constraints.format}`,
          severity: "error",
        });
      }

      // Key generation is a tool setting (opentp.cli.yaml): without it there is no key-equality
      // check. Without an expected key and without a per-event reason, keygen itself is
      // misconfigured, which validateEvents reports once against opentp.cli.yaml.
      if (resolved.keygen) {
        if (typeof event.expectedKey !== "string") {
          if (event.keygenError) {
            errors.push({
              event: event.relativePath,
              path: "event.key",
              message: `Cannot generate the expected key: ${event.keygenError}`,
              severity: "error",
            });
          }
        } else if (key !== event.expectedKey) {
          errors.push({
            event: event.relativePath,
            path: "event.key",
            message: `Key mismatch: got '${key}', expected '${event.expectedKey}'`,
            severity: "error",
          });
        }
      }
    }
  }

  // 2. Taxonomy validation
  const taxonomyErrors = await validateTaxonomy(
    event,
    config.spec.events.taxonomy,
    dictionaries,
    ignore,
    resolved.checks,
  );
  errors.push(...taxonomyErrors);

  // 3. Payload validation
  const payloadErrors = await validatePayload(
    event,
    config,
    dictionaries,
    ignoreList,
    resolved.checks,
    baseFields,
  );
  errors.push(...payloadErrors);

  return errors;
}

/**
 * Validates taxonomy fields of an event
 */
async function validateTaxonomy(
  event: ResolvedEvent,
  taxonomyConfig: Record<string, TaxonomyField>,
  dictionaries: Map<string, (string | number | boolean)[]>,
  ignore: Set<string>,
  checks: CheckEnvironment,
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  function isEmpty(value: unknown): boolean {
    return (
      value === undefined || value === null || (typeof value === "string" && value.trim() === "")
    );
  }

  function parseTypedValue(raw: string, type: TaxonomyField["type"]): string | number | boolean {
    if (type === "string") return raw;

    if (type === "integer") {
      const num = Number(raw);
      if (!Number.isFinite(num) || !Number.isInteger(num)) return raw;
      return num;
    }

    if (type === "number") {
      const num = Number(raw);
      return Number.isFinite(num) ? num : raw;
    }

    const normalized = raw.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    return raw;
  }

  function validateType(
    value: unknown,
    expectedType: TaxonomyField["type"],
  ): { ok: boolean; message?: string } {
    if (expectedType === "string") {
      return typeof value === "string"
        ? { ok: true }
        : { ok: false, message: `Expected string, got ${typeof value}` };
    }

    if (expectedType === "integer") {
      if (typeof value !== "number") {
        return { ok: false, message: `Expected integer, got ${typeof value}` };
      }
      if (!Number.isFinite(value) || !Number.isInteger(value)) {
        return { ok: false, message: "Expected integer" };
      }
      return { ok: true };
    }

    if (expectedType === "number") {
      if (typeof value !== "number") {
        return { ok: false, message: `Expected number, got ${typeof value}` };
      }
      if (!Number.isFinite(value)) {
        return { ok: false, message: "Expected finite number" };
      }
      return { ok: true };
    }

    return typeof value === "boolean"
      ? { ok: true }
      : { ok: false, message: `Expected boolean, got ${typeof value}` };
  }

  function push(checkPath: string, messages: string[]): void {
    for (const message of messages) {
      errors.push({ event: event.relativePath, path: checkPath, message, severity: "error" });
    }
  }

  /** Constraints (string or number) and checks of one taxonomy field or fragment value */
  async function validateValue(
    value: string | number | boolean,
    fieldConfig: TaxonomyField,
    name: string,
    checkPath: string,
  ): Promise<void> {
    // JSON-Schema-like constraints (an invalid regex is reported once against opentp.yaml)
    if (fieldConfig.type === "string" && typeof value === "string") {
      push(checkPath, stringConstraintProblems(value, fieldConfig, { invalidPattern: "skip" }));
    } else if (
      (fieldConfig.type === "number" || fieldConfig.type === "integer") &&
      typeof value === "number"
    ) {
      push(checkPath, numberConstraintProblems(value, fieldConfig));
    }

    const fieldChecks = checksOf(fieldConfig);
    if (fieldChecks) {
      const ctx: RuleContext = { fieldName: name, fieldPath: checkPath, eventKey: event.key };
      const ruleErrors = await checks.run(value, fieldChecks, ctx);
      push(
        checkPath,
        ruleErrors.map((ruleError) => ruleError.error || "Validation failed"),
      );
    }
  }

  for (const [fieldName, fieldConfig] of Object.entries(taxonomyConfig)) {
    const checkPath = `taxonomy.${fieldName}`;
    if (ignore.has(checkPath)) continue;
    // Invalid definitions are reported once against opentp.yaml (validateConfig)
    if (!isYamlMapping(fieldConfig)) continue;

    const value = event.taxonomy[fieldName];

    // Required check
    if (fieldConfig.required && isEmpty(value)) {
      errors.push({
        event: event.relativePath,
        path: checkPath,
        message: `Required field '${fieldName}' is missing`,
        severity: "error",
      });
      continue;
    }

    if (value === undefined) continue;

    // Type validation
    const typeResult = validateType(value, fieldConfig.type);
    if (!typeResult.ok) {
      errors.push({
        event: event.relativePath,
        path: checkPath,
        message: typeResult.message ?? "Type mismatch",
        severity: "error",
      });
      continue;
    }

    const typedValue = value as string | number | boolean;

    // Enum check (inline values; an empty enum is reported once against opentp.yaml)
    if (
      Array.isArray(fieldConfig.enum) &&
      fieldConfig.enum.length > 0 &&
      !fieldConfig.enum.includes(typedValue)
    ) {
      errors.push({
        event: event.relativePath,
        path: checkPath,
        message: `Value '${value}' is not in allowed values for '${fieldName}'`,
        severity: "error",
      });
    }

    // Dict check (reference to dictionary file). An unknown dictionary is reported once against
    // opentp.yaml (validateTaxonomyDictionaries).
    if (fieldConfig.dict) {
      const allowedValues = getDictValues(fieldConfig.dict, dictionaries);
      if (allowedValues && !allowedValues.includes(typedValue)) {
        errors.push({
          event: event.relativePath,
          path: checkPath,
          message: `Value '${value}' is not in dictionary '${fieldConfig.dict}'`,
          severity: "error",
        });
      }
    }

    await validateValue(typedValue, fieldConfig, fieldName, checkPath);

    // Composite fragments check (template + fragments). An unusable template or fragments
    // definition is reported once against opentp.yaml (validateConfig).
    if (
      fieldConfig.template &&
      isYamlMapping(fieldConfig.fragments) &&
      getMatchTemplateProblems(fieldConfig.template).length === 0 &&
      typeof typedValue === "string"
    ) {
      const re = patternToRegex(fieldConfig.template);
      const match = typedValue.match(re);
      if (!match?.groups) {
        errors.push({
          event: event.relativePath,
          path: checkPath,
          message: `Value does not match template ${JSON.stringify(fieldConfig.template)}`,
          severity: "error",
        });
        continue;
      }

      for (const [fragName, fragConfig] of Object.entries(fieldConfig.fragments)) {
        const fragCheckPath = `taxonomy.${fragName}`;
        if (ignore.has(fragCheckPath)) continue;
        if (!isYamlMapping(fragConfig)) continue;

        const rawFrag = match.groups[fragName];

        if (fragConfig.required && isEmpty(rawFrag)) {
          errors.push({
            event: event.relativePath,
            path: fragCheckPath,
            message: `Required fragment '${fragName}' is missing`,
            severity: "error",
          });
          continue;
        }

        if (rawFrag === undefined) continue;

        const fragValue = parseTypedValue(rawFrag, fragConfig.type);

        const fragTypeResult = validateType(fragValue, fragConfig.type);
        if (!fragTypeResult.ok) {
          errors.push({
            event: event.relativePath,
            path: fragCheckPath,
            message: fragTypeResult.message ?? "Type mismatch",
            severity: "error",
          });
          continue;
        }

        const typedFragValue = fragValue as string | number | boolean;

        if (
          Array.isArray(fragConfig.enum) &&
          fragConfig.enum.length > 0 &&
          !fragConfig.enum.includes(typedFragValue)
        ) {
          errors.push({
            event: event.relativePath,
            path: fragCheckPath,
            message: `Value '${typedFragValue}' is not in allowed values for '${fragName}'`,
            severity: "error",
          });
        }

        // Unknown dictionaries are reported once against opentp.yaml
        if (fragConfig.dict) {
          const allowedValues = getDictValues(fragConfig.dict, dictionaries);
          if (allowedValues && !allowedValues.includes(typedFragValue)) {
            errors.push({
              event: event.relativePath,
              path: fragCheckPath,
              message: `Value '${typedFragValue}' is not in dictionary '${fragConfig.dict}'`,
              severity: "error",
            });
          }
        }

        await validateValue(typedFragValue, fragConfig, fragName, fragCheckPath);
      }
    }
  }

  return errors;
}

/** Why a policy is not satisfied by an event version, or null */
function policyNeed(
  policy: string,
  written: Field | undefined,
  restrictedAfterPolicy: boolean,
  fixedAfterPolicy: boolean,
  type: unknown,
): string | null {
  if (written === undefined) return "every event must list it";
  if (
    policy === "restricted" &&
    !restrictedAfterPolicy &&
    written.value === undefined &&
    written.enum === undefined &&
    written.dict === undefined
  ) {
    // enum and dict are not allowed on arrays: only a value restricts an array field
    return type === "array"
      ? "every event must restrict it with a value (enum and dict are not allowed on arrays)"
      : "every event must restrict it with value, enum or dict";
  }
  if (policy === "fixed" && !fixedAfterPolicy && written.value === undefined) {
    return "every event must set its value";
  }
  return null;
}

/** Whether the code-facing name of an effective field comes from the event layer */
function namedByEvent(entry: EffectiveField): boolean {
  return entry.event !== undefined && (entry.event.name !== undefined || !entry.base?.common);
}

/**
 * Validates the payload of an event per covered target id and version (2026-09 field semantics):
 * closed vocabulary, the event layer merged over the catalog and common fields (type conflicts,
 * fixed values, weakened `required`, narrowing), presence, values, enum members and examples
 * written in the event, checks, pii, policy and code-facing names.
 */
async function validatePayload(
  event: ResolvedEvent,
  config: OpenTPConfig,
  dictionaries: Map<string, (string | number | boolean)[]>,
  ignore: IgnoreList,
  checks: CheckEnvironment,
  baseFields: BaseFieldCache,
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];
  const lookup = dictionaryLookup(dictionaries);
  const piiConfig = piiConfigOf(config);

  const { payload: resolvedPayload, issues } = resolveEventPayload(event.payload, config, {
    dictionaryValues: lookup,
  });

  // Payload resolution problems (selectors, current, aliases, $ref): never ignorable
  for (const issue of issues) {
    errors.push({
      event: event.relativePath,
      path: issue.path,
      message: issue.message,
      severity: "error",
    });
  }

  function push(path: string, messages: string[]): void {
    for (const message of messages) {
      errors.push({ event: event.relativePath, path, message, severity: "error" });
    }
  }

  function pushProblems(path: string, problems: ValueProblem[]): void {
    for (const problem of problems) push(`${path}${problem.suffix}`, [problem.message]);
  }

  async function runChecks(
    value: unknown,
    fieldChecks: ChecksMap | null,
    fieldName: string,
    valuePath: string,
  ): Promise<void> {
    if (!fieldChecks) return;
    const context = { fieldName, eventKey: event.key };
    for (const result of await runValueChecks(checks, value, fieldChecks, context, valuePath)) {
      push(result.path, [result.message]);
    }
  }

  /**
   * The checks of what the event layer writes: its value, enum members, item enum members,
   * example and pii values, against the effective field
   */
  async function checkEventField(
    name: string,
    field: Field,
    written: Field,
    fieldPath: string,
    writesExample: boolean,
  ): Promise<void> {
    const fieldChecks = checksOf(field);
    const portable = fieldChecks ? checks.portableOnly(fieldChecks) : null;
    const items = isYamlMapping(field.items) ? (field.items as Field) : null;
    const itemChecks = items ? checksOf(items) : null;

    if (written.value !== undefined) {
      const valuePath = `${fieldPath}.value`;
      pushProblems(valuePath, valueProblems(field.value, field, { lookup }));
      await runChecks(field.value, fieldChecks, name, valuePath);
      if (Array.isArray(field.value)) await runChecks(field.value, itemChecks, name, valuePath);
    } else if (field.value !== undefined && isYamlMapping(written.checks)) {
      // Checks the event adds to an inherited fixed value
      await runChecks(field.value, written.checks, name, `${fieldPath}.value`);
    }

    // A top-level enum on an array is reported as such (typedKeywordProblems)
    if (Array.isArray(written.enum) && field.type !== "array") {
      for (const [index, member] of written.enum.entries()) {
        const memberPath = `${fieldPath}.enum[${index}]`;
        pushProblems(memberPath, valueProblems(member, field, { lookup }));
        await runChecks(member, portable, name, memberPath);
      }
    }

    if (items && isYamlMapping(written.items) && Array.isArray(written.items.enum)) {
      const itemPortable = itemChecks ? checks.portableOnly(itemChecks) : null;
      for (const [index, member] of written.items.enum.entries()) {
        const memberPath = `${fieldPath}.items.enum[${index}]`;
        pushProblems(memberPath, valueProblems(member, items, { lookup }));
        await runChecks(member, itemPortable, name, memberPath);
      }
    }

    // An example inherited through $ref is checked in the version that writes it
    if (written.example !== undefined && writesExample) {
      const examplePath = `${fieldPath}.example`;
      pushProblems(examplePath, exampleProblems(written.example, field, { lookup }));
      await runChecks(written.example, portable, name, examplePath);
      // Each item of an array example also gets the portable checks of `items`
      if (Array.isArray(written.example) && itemChecks) {
        await runChecks(written.example, checks.portableOnly(itemChecks), name, examplePath);
      }
    }

    if (piiConfig && isYamlMapping(written.pii) && isYamlMapping(field.pii)) {
      const keys = new Set(Object.keys(written.pii));
      pushProblems(fieldPath, piiProblems(field.pii, piiConfig, { required: true, keys, lookup }));
      // Checks apply to the pii values written in the event
      for (const key of keys) {
        const value = getOwn(field.pii, key);
        if (value === undefined) continue;
        await runChecks(
          value,
          piiKeyChecks(piiConfig, key),
          `${name}.pii.${key}`,
          `${fieldPath}.pii.${key}`,
        );
      }
    }
  }

  // Problems reported once per file where they are written (not per target and version)
  const reportedOnce = new Set<string>();
  const pushOnce = (path: string, message: string) => {
    const id = `${path}\u0000${message}`;
    if (reportedOnce.has(id)) return;
    reportedOnce.add(id);
    push(path, [message]);
  };

  for (const [targetId, targetPayload] of Object.entries(resolvedPayload.targets)) {
    const base = baseFields.forTarget(targetId);

    for (const [versionKey, version] of Object.entries(targetPayload.versions)) {
      const schemaPrefix =
        versionKey === UNVERSIONED_VERSION_KEY
          ? `payload.${targetId}.schema`
          : `payload.${targetId}.${versionKey}.schema`;
      const exempt = isDeprecatedVersion(version.meta);
      const fields = effectiveFields(version.schema, base, lookup);

      for (const [name, entry] of fields) {
        const written = entry.event;
        // A common field that the event does not list: its base problems are reported once
        if (written === undefined) continue;
        const fieldPath = `${schemaPrefix}.${name}`;

        // Closed vocabulary: never ignorable
        if (!entry.base) {
          push(fieldPath, [unknownFieldMessage(name, targetId, [...base.keys()])]);
          continue;
        }

        const ignored = ignore.fields.has(name);
        let weakened = false;
        for (const problem of entry.problems) {
          // Narrowing is a field-level check; type, fixed-value and required conflicts are not
          if (problem.rule === "narrowing" && ignored) continue;
          if (problem.rule === "required") weakened = true;
          push(problem.keyword ? `${fieldPath}.${problem.keyword}` : fieldPath, [problem.message]);
        }

        // Keywords that the effective type does not allow, where this version writes them (never
        // ignorable; one written through $ref is reported in the version that writes it)
        const own = version.ownSchema ? getOwn(version.ownSchema, name) : written;
        if (own !== undefined) {
          const ownPath = version.writtenPath ? `${version.writtenPath}.${name}` : fieldPath;
          for (const problem of typedKeywordProblems(name, own, entry.field)) {
            pushOnce(`${ownPath}${problem.suffix}`, problem.message);
          }
        }

        // Presence: a field with a value or a strict policy is always present (never ignorable)
        if (written.required === false && !weakened) {
          const reason = presenceReason(entry.field, !exempt);
          if (reason) push(fieldPath, [alwaysPresentMessage(name, reason)]);
        }

        if (!ignored) {
          await checkEventField(name, entry.field, written, fieldPath, own?.example !== undefined);
        }
      }

      // Policy (D4): catalog and common fields; versions marked meta.deprecated are exempt
      if (!exempt) {
        for (const [name, field] of base) {
          if (field.policy === undefined || ignore.fields.has(name)) continue;
          const written = Object.hasOwn(version.schema, name) ? version.schema[name] : undefined;
          const need = policyNeed(
            field.policy,
            written,
            field.restrictedAfterPolicy,
            field.fixedAfterPolicy,
            field.field.type,
          );
          if (need) {
            push(`${schemaPrefix}.${name}`, [
              `Field '${name}' has policy '${field.policy}': ${need}`,
            ]);
          }
        }
      }

      // Code-facing names are unique among the effective fields of this version
      const names = new Map<string, string>();
      for (const [name, entry] of fields) {
        if (!entry.base) continue;
        const code = codeName(name, entry.field);
        const first = names.get(code);
        if (first === undefined) {
          names.set(code, name);
          continue;
        }
        const firstEntry = fields.get(first) as EffectiveField;
        // Two common fields only: reported once against opentp.yaml
        if (!namedByEvent(entry) && !namedByEvent(firstEntry)) continue;
        const at = namedByEvent(entry) ? name : first;
        if (ignore.fields.has(at)) continue;
        push(`${schemaPrefix}.${at}`, [codeNameMessage(code, first, name)]);
      }
    }
  }

  return errors;
}

/**
 * Groups errors by event for pretty output
 */
export function groupErrorsByEvent(errors: ValidationError[]): Map<string, ValidationError[]> {
  const grouped = new Map<string, ValidationError[]>();

  for (const error of errors) {
    const existing = grouped.get(error.event) ?? [];
    existing.push(error);
    grouped.set(error.event, existing);
  }

  return grouped;
}

/** One `[<event>]` block: the header (after a blank line), then one line per problem */
function* blockLines(event: string, errors: readonly ValidationError[]): Generator<string> {
  yield `\n[${event}]`;
  for (const error of errors) {
    const prefix = error.severity === "error" ? "✗" : "⚠";
    // File-level problems (e.g. YAML syntax errors) have an empty path
    const location = error.path ? `${error.path}: ` : "";
    yield `  ${prefix} ${location}${error.message}`;
  }
}

/**
 * The lines of formatErrors, one at a time, so that a large report is printed without building
 * one string
 */
export function* errorLines(errors: ValidationError[]): Generator<string> {
  for (const [event, eventErrors] of groupErrorsByEvent(errors)) {
    yield* blockLines(event, eventErrors);
  }
}

/**
 * Formats errors (or warnings) for console output: `[<event>]` blocks with `  ✗ <path>: <message>`
 * lines (`⚠` for warnings)
 */
export function formatErrors(errors: ValidationError[]): string {
  return [...errorLines(errors)].join("\n");
}

/** Overlap warnings printed in text mode; `--json` lists all */
export const OVERLAP_TEXT_LIMIT = 20;

/**
 * The lines of formatWarnings, one at a time. One block per file: its other warnings, then its
 * overlap warnings. At most `overlapLimit` overlap warnings are printed, from the events with the
 * most attached overlap warnings first (a summary counts as the pairs it stands for; ties by path), then
 * one line says how many more there are. Files with other warnings come first, in their order;
 * files with only overlap warnings follow, in the overlap order.
 */
export function* warningLines(
  warnings: ValidationError[],
  overlapLimit: number = OVERLAP_TEXT_LIMIT,
): Generator<string> {
  const others = groupErrorsByEvent(warnings.filter((warning) => warning.rule !== "overlap"));
  const overlap = groupErrorsByEvent(warnings.filter((warning) => warning.rule === "overlap"));

  const weights = new Map<string, number>();
  for (const [event, list] of overlap) {
    let weight = 0;
    for (const warning of list) weight += overlapMessageWeight(warning.message);
    weights.set(event, weight);
  }
  const events = [...overlap.keys()].sort((a, b) => {
    const difference = (weights.get(b) ?? 0) - (weights.get(a) ?? 0);
    if (difference !== 0) return difference;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const shown = new Map<string, ValidationError[]>();
  let total = 0;
  let printed = 0;
  for (const event of events) {
    const list = overlap.get(event) ?? [];
    total += list.length;
    if (printed < overlapLimit) {
      const taken = list.slice(0, overlapLimit - printed);
      shown.set(event, taken);
      printed += taken.length;
    }
  }

  for (const [event, list] of others) {
    yield* blockLines(event, [...list, ...(shown.get(event) ?? [])]);
  }
  for (const [event, list] of shown) {
    if (!others.has(event)) yield* blockLines(event, list);
  }
  const hidden = total - printed;
  if (hidden > 0) {
    yield `… ${hidden} more overlap warnings (--json lists all; set checks.severity.overlap in opentp.cli.yaml)`;
  }
}

/** Formats warnings for text output (see warningLines) */
export function formatWarnings(
  warnings: ValidationError[],
  overlapLimit: number = OVERLAP_TEXT_LIMIT,
): string {
  return [...warningLines(warnings, overlapLimit)].join("\n");
}
