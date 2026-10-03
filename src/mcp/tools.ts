/**
 * The MCP tools of `opentp mcp` as plain functions over a loaded plan.
 *
 * Every tool is read-only: nothing here writes a file. Agents that change the plan write event files
 * themselves, guided by suggest_event and checked by validate_event_draft / validate_plan.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { resolveCliPath } from "../cliconfig";
import { getRunEntryProblems } from "../cliconfig/run";
import { MCP_TOOL_GROUPS, type McpToolGroup } from "../cliconfig/schema";
import { getDictValues } from "../core/dict";
import { createEventLoadContext, type EventLoadIssue, loadEventDocument } from "../core/event";
import { targetIds } from "../core/fields";
import {
  type BaseField,
  type FieldLayer,
  fieldMap,
  mergeBaseLayers,
  resolveEffectivePayload,
  UNVERSIONED_VERSION_KEY,
} from "../core/payload";
import { filterEvents } from "../core/select";
import {
  cliConfigIssuesToErrors,
  configIssuesToErrors,
  errorsOnly,
  loadIssuesToErrors,
  warningsOnly,
} from "../core/validator";
import { type GeneratorOptions, getGenerator } from "../generators";
import { generatorContext } from "../generators/context";
import type { Field, ResolvedEvent, ValidationError } from "../types";
import {
  extractTemplateVariables,
  getMatchTemplateProblems,
  isYamlMapping,
  parsePattern,
  setOwn,
} from "../util";
import { parseYaml } from "../util/yaml";
import type { PlanSnapshot } from "./plan";

/** A problem with the tool call itself (unknown key, bad path): returned to the client as an error */
export class ToolError extends Error {}

/** Largest response of one tool call (UTF-8 bytes of the text sent to the client) */
export const MAX_RESPONSE_BYTES = 256 * 1024;

const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_ERROR_LIMIT = 100;
const MAX_DICTIONARY_VALUES = 5000;

interface ErrorEntry {
  path: string;
  message: string;
  /** The tool rule of a warning (`overlap`, `unknownCheck`) */
  rule?: string;
}

function errorEntries(errors: ValidationError[]): ErrorEntry[] {
  return errors.map(({ path: errorPath, message, rule }) => ({
    path: errorPath,
    message,
    ...(rule ? { rule } : {}),
  }));
}

/** Problems of the plan itself that block a complete load (generate refuses on them, like the CLI) */
function loadProblems(plan: PlanSnapshot): ValidationError[] {
  return [
    ...configIssuesToErrors(plan.configIssues),
    ...cliConfigIssuesToErrors(plan.cliIssues),
    ...loadIssuesToErrors(plan.dictIssues, plan.eventIssues),
  ];
}

/** Problems that make spec.paths.events.template unusable (no event can be loaded or placed) */
function templateProblems(plan: PlanSnapshot): string[] {
  return getMatchTemplateProblems(plan.eventsTemplate);
}

function requireUsableTemplate(plan: PlanSnapshot): void {
  const problems = templateProblems(plan);
  if (problems.length > 0) {
    throw new ToolError(
      `spec.paths.events.template in opentp.yaml is unusable (${problems.join("; ")}): fix it first (see validate_plan)`,
    );
  }
}

/** The path variables of a usable template (callers check templateProblems first) */
function templateVariables(template: string): string[] {
  return parsePattern(template)
    .filter((part) => part.type === "variable")
    .map((part) => part.value);
}

/** Rejects client paths that are absolute or try to leave the events root */
function checkRelativePath(relativePath: string): void {
  if (
    relativePath === "" ||
    path.isAbsolute(relativePath) ||
    /^[A-Za-z]:/.test(relativePath) ||
    relativePath.split("/").some((segment) => segment === "..")
  ) {
    throw new ToolError(
      `Invalid event file path '${relativePath}': use a path relative to the events root or the project root`,
    );
  }
}

/** A path relative to the events root, as a project-relative path for tool output */
function projectFile(plan: PlanSnapshot, relativePath: string): string {
  return plan.eventsRoot ? `${plan.eventsRoot}/${relativePath}` : relativePath;
}

/** What opentp does with a file under the events root: loaded, failed to load, skipped, or absent */
function fileStatus(plan: PlanSnapshot, relativePath: string) {
  if (plan.events.some((event) => event.relativePath === relativePath)) {
    return { status: "loaded" as const };
  }
  const issue = plan.eventIssues.find((candidate) => candidate.file === relativePath);
  if (issue) return { status: "load-error" as const, reason: issue.message };
  if (!fs.existsSync(path.join(plan.eventsPath, relativePath))) {
    return { status: "not-found" as const };
  }
  if (!/\.ya?ml$/i.test(relativePath)) {
    return { status: "not-loaded" as const, reason: "not a .yaml or .yml file" };
  }
  return {
    status: "not-loaded" as const,
    reason: `does not match spec.paths.events.template '${plan.eventsTemplate}', so opentp skips it`,
  };
}

// --- describe_plan -------------------------------------------------------------------------------

/**
 * The common fields of each target (spec.targets.all and spec.targets.<T>, merged over the catalog):
 * part of every event on that target, with their policy
 */
function commonFieldsByTarget(plan: PlanSnapshot): Record<string, Record<string, Field>> {
  const out: Record<string, Record<string, Field>> = {};
  for (const target of targetIds(plan.config)) {
    const fields: Record<string, Field> = {};
    for (const [name, base] of mergeBaseLayers(plan.config, target).fields) {
      // The merged definition, policy included
      if (base.common) setOwn(fields, name, base.field);
    }
    out[target] = fields;
  }
  return out;
}

/**
 * The plan's structure for describe_plan (and the plan summary resource). `groups` are the tool
 * groups the server serves: `howTo` names only their tools.
 */
export function describePlan(
  plan: PlanSnapshot,
  groups: ReadonlySet<McpToolGroup> = new Set(MCP_TOOL_GROUPS),
) {
  const { config } = plan;
  const problems = templateProblems(plan);
  const pathFields = new Set(problems.length === 0 ? templateVariables(plan.eventsTemplate) : []);
  const taxonomy: Record<string, unknown> = {};
  for (const [name, definition] of Object.entries(config.spec.events.taxonomy)) {
    taxonomy[name] = isYamlMapping(definition)
      ? { ...definition, fromPath: pathFields.has(name) }
      : definition;
  }
  const targetSettings: Record<string, unknown> = {};
  for (const [id, target] of Object.entries(config.spec.targets ?? {})) {
    if (!isYamlMapping(target)) continue;
    const { schema: _schema, ...settings } = target;
    if (Object.keys(settings).length > 0) targetSettings[id] = settings;
  }

  return {
    title: config.info.title,
    version: config.info.version,
    description: config.info.description ?? null,
    opentp: config.opentp,
    // Application repository mode: the plan that opentp.cli.yaml pins (plan:)
    ...(plan.pinnedPlan !== null ? { pinnedPlan: plan.pinnedPlan } : {}),
    eventsRoot: plan.eventsRoot,
    pathTemplate: plan.eventsTemplate,
    ...(problems.length > 0 ? { pathTemplateProblems: problems } : {}),
    dictionariesRoot: plan.dictsPath ? plan.projectPath(plan.dictsPath) : null,
    taxonomy,
    key: {
      constraints: config.spec.events.key ?? null,
      // Key generation is a tool setting: keygen in opentp.cli.yaml
      keygen: plan.keygen !== null,
      keygenTemplate: plan.keygen?.template ?? null,
    },
    targets: config.spec.events.payload.targets,
    // The fields events may use (listing a field here does not add it to events)
    catalog: fieldMap(config.spec.events.payload.schema),
    // Per target id: the fields that are part of every event on it, merged over the catalog
    commonFields: commonFieldsByTarget(plan),
    // spec.targets settings other than the common fields (title, description, x-*)
    ...(Object.keys(targetSettings).length > 0 ? { targetSettings } : {}),
    checks: config.spec.checks ?? {},
    // Where each field travels in the tracker payload, per target (tracker in opentp.cli.yaml)
    tracker: plan.tracker,
    pii: config.spec.events.pii ?? null,
    counts: {
      events: plan.events.length,
      dictionaries: plan.dictionaries.size,
      loadProblems: loadProblems(plan).length,
    },
    howTo: [
      "Taxonomy fields with fromPath=true come from the event file path (pathTemplate); the others are set in event.taxonomy.",
      "An event payload may use the catalog fields and the common fields of each target it covers; common fields are part of every event on their target. A policy says what every event must write: specified (list the field), restricted (an enum, a dict or a value; an array field only a value), fixed (a value).",
      // describe_plan is in the describe group, with get_event and suggest_event
      groups.has("search")
        ? "Find events with search_events, then read one with get_event (effective payload per target)."
        : "Read an event by its key with get_event (effective payload per target).",
      groups.has("validate")
        ? "To add or change an event: call suggest_event for the file path, key and a skeleton, write the YAML file, then call validate_event_draft (before writing) or validate_plan (after)."
        : "To add an event: call suggest_event for the file path, key and a skeleton, and write the YAML file.",
    ],
  };
}

// --- search_events -------------------------------------------------------------------------------

export function searchEvents(plan: PlanSnapshot, args: { query: string; limit?: number }) {
  const limit = args.limit ?? DEFAULT_SEARCH_LIMIT;
  const hits = plan.search.search(args.query, limit).map(({ index, score }) => ({
    event: plan.events[index],
    score: Math.round(score * 1000) / 1000,
    exactKey: false,
  }));

  // A query that is a whole key (or an old key from aliases) puts that event first
  const exact = findEventOrNull(plan, args.query.trim());
  const results = exact
    ? [
        { event: exact.event, score: hits[0]?.score ?? 0, exactKey: true },
        ...hits.filter((hit) => hit.event !== exact.event),
      ].slice(0, limit)
    : hits;

  return {
    query: args.query,
    eventCount: plan.events.length,
    results: results.map(({ event, score, exactKey }) => ({
      key: event.key,
      file: plan.projectPath(event.filePath),
      score,
      ...(exactKey ? { exactKeyMatch: true } : {}),
      status: event.lifecycle?.status ?? null,
      taxonomy: event.taxonomy,
    })),
  };
}

// --- get_event -----------------------------------------------------------------------------------

function findEventOrNull(
  plan: PlanSnapshot,
  key: string,
): { event: ResolvedEvent; alias?: string } | null {
  const event = plan.byKey.get(key);
  if (event) return { event };
  // `aliases` is not schema-checked by the CLI: tolerate any shape
  const byAlias = plan.events.find(
    (candidate) =>
      Array.isArray(candidate.aliases) &&
      candidate.aliases.some((alias) => isYamlMapping(alias) && alias.key === key),
  );
  return byAlias ? { event: byAlias, alias: key } : null;
}

function findEvent(plan: PlanSnapshot, key: string): { event: ResolvedEvent; alias?: string } {
  const found = findEventOrNull(plan, key);
  if (!found) {
    throw new ToolError(`No event with key '${key}'. Use search_events to find the key.`);
  }
  return found;
}

export function getEvent(
  plan: PlanSnapshot,
  args: { key: string; target?: string; version?: string },
) {
  const { event, alias } = findEvent(plan, args.key);
  if (args.version === UNVERSIONED_VERSION_KEY) {
    throw new ToolError(`Event '${event.key}' has no payload version '${args.version}'`);
  }
  const { targets, issues } = resolveEffectivePayload(event.payload, plan.config, (dict) =>
    getDictValues(dict, plan.dictionaries),
  );

  let entries = Object.values(targets);
  if (args.target !== undefined) {
    entries = entries.filter((entry) => entry.target === args.target);
    if (entries.length === 0) {
      throw new ToolError(
        `Event '${event.key}' has no payload for target '${args.target}'. Targets: ${Object.keys(targets).join(", ") || "none"}`,
      );
    }
  }

  // Targets with the same version and effective fields are listed together (an implicit `all`
  // payload would otherwise repeat one schema per target)
  const groups = new Map<
    string,
    {
      targets: string[];
      version: string | null;
      current: string | null;
      versions: string[];
      aliases: Record<string, string>;
      schema: Record<string, Field>;
      layers: Record<string, FieldLayer[]>;
    }
  >();
  const withoutVersion: string[] = [];
  for (const entry of entries) {
    const wanted = args.version ?? entry.current;
    const versionKey = Object.hasOwn(entry.versions, wanted)
      ? wanted
      : Object.hasOwn(entry.aliases, wanted)
        ? entry.aliases[wanted]
        : undefined;
    const schema =
      versionKey !== undefined && Object.hasOwn(entry.versions, versionKey)
        ? entry.versions[versionKey]
        : undefined;
    if (versionKey === undefined || schema === undefined) {
      withoutVersion.push(entry.target);
      continue;
    }
    const shown = {
      version: versionKey === UNVERSIONED_VERSION_KEY ? null : versionKey,
      current: entry.current === UNVERSIONED_VERSION_KEY ? null : entry.current,
      versions: Object.keys(entry.versions).filter((key) => key !== UNVERSIONED_VERSION_KEY),
      aliases: entry.aliases,
      // 2026-09 effective fields: the common fields of the target plus the fields the version lists,
      // each merged over the catalog and common fields; `layers` says where each one comes from
      schema,
      layers: entry.layers[versionKey] ?? {},
    };
    const id = JSON.stringify(shown);
    const group = groups.get(id);
    if (group) group.targets.push(entry.target);
    else groups.set(id, { targets: [entry.target], ...shown });
  }
  if (args.version !== undefined && groups.size === 0) {
    throw new ToolError(`Event '${event.key}' has no payload version '${args.version}'`);
  }

  return {
    key: event.key,
    ...(alias !== undefined ? { matchedAlias: alias } : {}),
    file: plan.projectPath(event.filePath),
    taxonomy: event.taxonomy,
    lifecycle: event.lifecycle ?? null,
    aliases: event.aliases ?? [],
    payload: [...groups.values()],
    ...(withoutVersion.length > 0 ? { targetsWithoutThisVersion: withoutVersion } : {}),
    ...(issues.length > 0 ? { payloadIssues: issues } : {}),
  };
}

// --- dictionaries --------------------------------------------------------------------------------

export function listDictionaries(plan: PlanSnapshot) {
  return {
    dictionaries: [...plan.dictionaries]
      .map(([name, values]) => ({ name, count: values.length }))
      .sort((a, b) => (a.name < b.name ? -1 : 1)),
  };
}

export function getDictionary(plan: PlanSnapshot, args: { name: string }) {
  const values = plan.dictionaries.get(args.name);
  if (!values) {
    const names = [...plan.dictionaries.keys()].sort();
    throw new ToolError(
      `No dictionary '${args.name}'. Dictionaries: ${names.slice(0, 50).join(", ") || "none"}`,
    );
  }
  return {
    name: args.name,
    count: values.length,
    values: values.slice(0, MAX_DICTIONARY_VALUES),
    ...(values.length > MAX_DICTIONARY_VALUES ? { truncated: true } : {}),
  };
}

// --- validate_event_draft ------------------------------------------------------------------------

/** Loads a document as if it were the event file at `file` (relative to the events or project root) */
function loadDraft(plan: PlanSnapshot, file: string, readDocument: () => unknown) {
  requireUsableTemplate(plan);
  const relativePath = plan.eventsRelativePath(file);
  checkRelativePath(relativePath);
  const contextIssues: EventLoadIssue[] = [];
  const context = createEventLoadContext(
    plan.config,
    plan.eventsTemplate,
    plan.keygen,
    contextIssues,
  );
  const result = loadEventDocument(
    context,
    relativePath,
    path.join(plan.eventsPath, relativePath),
    readDocument,
  );
  return { relativePath, result, keygenConfigured: context.keygen !== null };
}

/**
 * Validates one loaded draft against the plan: event checks plus key uniqueness across the plan,
 * and with `overlap` the overlap with the plan's events (tool rule `overlap`, with its severity).
 * Webhook bindings are not run for drafts (their ids are returned in skippedWebhooks).
 */
async function checkDraft(plan: PlanSnapshot, event: ResolvedEvent, overlap = false) {
  const validation = await plan.validateDrafts([event]);
  const results = overlap
    ? [...validation.results, ...plan.draftOverlaps(event)]
    : validation.results;
  const { skippedWebhooks } = validation;
  const all = errorsOnly(results);
  const errors = all.filter((error) => error.event === event.relativePath);
  const warnings = warningsOnly(results).filter((warning) => warning.event === event.relativePath);
  const planProblems = all.length - errors.length;
  const duplicate = plan.events.find(
    (other) => other.key === event.key && other.relativePath !== event.relativePath,
  );
  if (duplicate && typeof event.key === "string" && event.key !== "") {
    errors.push({
      event: event.relativePath,
      path: "event.key",
      message: `Duplicate event key: also used by ${plan.projectPath(duplicate.filePath)}`,
      severity: "error",
    });
  }
  return {
    errors: errorEntries(errors),
    warnings: errorEntries(warnings),
    planProblems,
    skippedWebhooks,
  };
}

/** How a draft relates to the file at its path: none, a loaded event, or a file opentp cannot load */
function existingFileInfo(plan: PlanSnapshot, relativePath: string) {
  const status = fileStatus(plan, relativePath);
  if (status.status === "not-found") return { replacesExistingFile: false };
  return {
    replacesExistingFile: true,
    ...(status.status !== "loaded" ? { existingFileProblem: status.reason } : {}),
  };
}

export async function validateEventDraft(plan: PlanSnapshot, args: { path: string; yaml: string }) {
  const { relativePath, result } = loadDraft(plan, args.path, () => parseYaml(args.yaml));
  const file = projectFile(plan, relativePath);
  const existing = existingFileInfo(plan, relativePath);

  if (result.status === "unmatched") {
    return {
      valid: false,
      file,
      ...existing,
      errors: [
        {
          path: "",
          message: `The file path does not match spec.paths.events.template '${plan.eventsTemplate}' (relative to ${plan.eventsRoot || "the project root"}), so opentp would not load it`,
        },
      ],
      warnings: [] as ErrorEntry[],
    };
  }
  if (result.status === "failed") {
    return {
      valid: false,
      file,
      ...existing,
      errors: [{ path: result.issue.path, message: result.issue.message }],
      warnings: [] as ErrorEntry[],
    };
  }

  const event = result.event;
  const { errors, warnings, planProblems, skippedWebhooks } = await checkDraft(plan, event, true);
  return {
    valid: errors.length === 0,
    file,
    key: event.key ?? null,
    expectedKey: event.expectedKey,
    taxonomy: event.taxonomy,
    ...existing,
    errors,
    warnings,
    ...(skippedWebhooks.length > 0
      ? {
          note: skippedWebhooks
            .map((id) => `webhook binding '${id}' was not run for a draft`)
            .join("; "),
        }
      : {}),
    ...(planProblems > 0
      ? {
          planProblems,
          planProblemsNote:
            "opentp.yaml or dictionaries have problems that are not specific to this event: run validate_plan",
        }
      : {}),
  };
}

// --- validate_plan -------------------------------------------------------------------------------

export async function validatePlan(plan: PlanSnapshot, args: { files?: string[]; limit?: number }) {
  const limit = args.limit ?? DEFAULT_ERROR_LIMIT;
  const results = await plan.validation();
  const errors = errorsOnly(results);
  const allWarnings = warningsOnly(results);
  const requested = (args.files ?? []).map((file) => {
    const relativePath = plan.eventsRelativePath(file);
    checkRelativePath(relativePath);
    return relativePath;
  });

  let selected = errors;
  let warnings = allWarnings;
  let files: Array<{ file: string; status: string; reason?: string; errorCount: number }> = [];
  if (requested.length > 0) {
    const wanted = new Set(requested);
    selected = errors.filter((error) => wanted.has(error.event));
    warnings = allWarnings.filter((warning) => wanted.has(warning.event));
    files = [...wanted].map((relativePath) => ({
      file: projectFile(plan, relativePath),
      ...fileStatus(plan, relativePath),
      errorCount: errors.filter((error) => error.event === relativePath).length,
    }));
  }

  return {
    valid: errors.length === 0,
    eventCount: plan.events.length,
    errorCount: errors.length,
    ...(requested.length > 0
      ? {
          // true only when every requested file is loaded by opentp and has no errors
          filesValid: files.every((entry) => entry.status === "loaded" && entry.errorCount === 0),
          files,
        }
      : {}),
    errors: selected
      .slice(0, limit)
      .map(({ event, path: errorPath, message }) => ({ file: event, path: errorPath, message })),
    ...(selected.length > limit ? { truncated: true } : {}),
    warningCount: warnings.length,
    warnings: warnings.slice(0, limit).map(({ event, path: warningPath, message, rule }) => ({
      file: event,
      path: warningPath,
      message,
      ...(rule ? { rule } : {}),
    })),
    ...(warnings.length > limit ? { warningsTruncated: true } : {}),
  };
}

// --- suggest_event -------------------------------------------------------------------------------

type TaxonomyInput = Record<string, string | number | boolean>;

export async function suggestEvent(plan: PlanSnapshot, args: { taxonomy: TaxonomyInput }) {
  requireUsableTemplate(plan);
  const { config } = plan;
  const taxonomyConfig = config.spec.events.taxonomy;
  const input = args.taxonomy;
  const parts = parsePattern(plan.eventsTemplate);
  const pathFields = templateVariables(plan.eventsTemplate);
  const problems: string[] = [];

  const fragmentOwners = new Map<string, string>();
  for (const [name, definition] of Object.entries(taxonomyConfig)) {
    if (isYamlMapping(definition) && isYamlMapping(definition.fragments)) {
      for (const fragment of Object.keys(definition.fragments)) fragmentOwners.set(fragment, name);
    }
  }
  for (const name of Object.keys(input)) {
    if (Object.hasOwn(taxonomyConfig, name)) continue;
    const owner = fragmentOwners.get(name);
    problems.push(
      owner
        ? `'${name}' is a fragment of '${owner}': set '${owner}' instead (template '${taxonomyConfig[owner]?.template}')`
        : `'${name}' is not a taxonomy field in opentp.yaml`,
    );
  }

  const isMissing = (name: string): boolean =>
    input[name] === undefined || String(input[name]).trim() === "";
  const missing = new Set(pathFields.filter(isMissing));
  for (const [name, definition] of Object.entries(taxonomyConfig)) {
    if (isYamlMapping(definition) && definition.required === true && isMissing(name)) {
      missing.add(name);
    }
  }

  let relativePath: string | null = null;
  if (pathFields.every((name) => !isMissing(name))) {
    const badSegment = pathFields.find((name) => /[/\\]|^\.\.?$/.test(String(input[name])));
    if (badSegment) {
      problems.push(
        `'${badSegment}' is part of the file path, so its value cannot contain '/' or '\\' or be '.' or '..'`,
      );
    } else {
      const candidate = parts
        .map((part) => (part.type === "literal" ? part.value : String(input[part.value])))
        .join("");
      // The template must read the path back to the same values: placeholders that share a
      // segment are ambiguous when a value contains the literal between them
      const readBack = extractTemplateVariables(candidate, plan.eventsTemplate);
      const shifted = pathFields.find((name) => readBack?.[name] !== String(input[name]));
      if (shifted !== undefined) {
        problems.push(
          `The file path '${candidate}' would be read back with ${shifted} = '${readBack?.[shifted] ?? "(no match)"}' instead of '${input[shifted]}': template '${plan.eventsTemplate}' is ambiguous for these values`,
        );
      } else {
        relativePath = candidate;
      }
    }
  }

  const fileTaxonomy: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(input)) {
    if (Object.hasOwn(taxonomyConfig, name) && !pathFields.includes(name)) {
      fileTaxonomy[name] = value;
    }
  }
  const document = {
    opentp: config.opentp,
    event: { key: "", taxonomy: fileTaxonomy, payload: skeletonPayload(plan) },
  };

  let key: string | null = null;
  let keyNote: string | undefined;
  let skeletonErrors: ErrorEntry[] = [];
  if (relativePath !== null) {
    const { result, keygenConfigured } = loadDraft(plan, relativePath, () => document);
    if (result.status === "loaded") {
      key = result.event.expectedKey;
      if (!keygenConfigured) {
        keyNote =
          "Key generation is not configured or not usable (keygen in opentp.cli.yaml): choose a key that follows spec.events.key";
      } else if (result.event.keygenError) {
        keyNote = `The key could not be generated: ${result.event.keygenError}`;
      }
      document.event.key = key ?? "TODO";
      result.event.key = document.event.key;
      skeletonErrors = (await checkDraft(plan, result.event)).errors;
    } else if (result.status === "failed") {
      problems.push(result.issue.message);
    }
  }
  if (document.event.key === "") document.event.key = "TODO";

  const existing = relativePath !== null ? fileStatus(plan, relativePath) : undefined;
  const keyOwner = key !== null ? plan.byKey.get(key) : undefined;
  const requiredPayloadFields = payloadFieldRequirements(plan);

  return {
    file: relativePath === null ? null : projectFile(plan, relativePath),
    key,
    ...(keyNote ? { keyNote } : {}),
    missingTaxonomy: [...missing],
    problems,
    existingFile:
      relativePath !== null && existing && existing.status !== "not-found"
        ? projectFile(plan, relativePath)
        : null,
    ...(existing && existing.status !== "loaded" && existing.status !== "not-found"
      ? { existingFileProblem: existing.reason }
      : {}),
    keyUsedBy: keyOwner ? plan.projectPath(keyOwner.filePath) : null,
    requiredPayloadFields,
    skeleton: stringifyYaml(document),
    skeletonErrors,
    next: "Fill in the payload (and any missing taxonomy), write the file, then call validate_event_draft or validate_plan.",
  };
}

/** What the skeleton writes for a field that the event still has to fill in */
export const SKELETON_PLACEHOLDER = "<...>";

/**
 * What an event must write for a field with a policy on one target: `{}` for specified (or when a
 * base layer after the policy already narrows or fixes it), `enum: [<...>]` for restricted,
 * `value: <...>` for fixed (the base value when a base layer already wrote one, since a fixed value
 * cannot change). An array field gets `value: [<...>]` for both: a top-level `enum` or `dict` is
 * not allowed on an array, so a fixed value is the only way to restrict it.
 */
function skeletonField(base: BaseField): Record<string, unknown> {
  const needsValue = base.policy === "fixed" && !base.fixedAfterPolicy;
  const needsRestriction = base.policy === "restricted" && !base.restrictedAfterPolicy;
  if (!needsValue && !needsRestriction) return {};
  if (base.field.value !== undefined) return { value: base.field.value };
  if (base.field.type === "array") return { value: [SKELETON_PLACEHOLDER] };
  return needsValue ? { value: SKELETON_PLACEHOLDER } : { enum: [SKELETON_PLACEHOLDER] };
}

/**
 * The payload of the suggest_event skeleton: every field with a policy (catalog and common fields).
 * One implicit payload when every listed field can be written the same way on every target (a
 * field usable there, and a placeholder only where the base layers do not restrict it already);
 * otherwise one payload per target id with that target's fields.
 */
function skeletonPayload(plan: PlanSnapshot): Record<string, unknown> {
  const targets = targetIds(plan.config);
  const bases = new Map(targets.map((target) => [target, mergeBaseLayers(plan.config, target)]));
  const perTarget = new Map<string, Record<string, Record<string, unknown>>>();
  for (const target of targets) {
    const schema: Record<string, Record<string, unknown>> = {};
    for (const [name, base] of bases.get(target)?.fields ?? []) {
      if (base.policy !== undefined) setOwn(schema, name, skeletonField(base));
    }
    perTarget.set(target, schema);
  }

  const shared: Record<string, Record<string, unknown>> = {};
  const names = [...new Set([...perTarget.values()].flatMap((schema) => Object.keys(schema)))];
  const sameText = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const sharable = names.every((name) => {
    const written = targets
      .map((target) => perTarget.get(target)?.[name])
      .filter((entry): entry is Record<string, unknown> => entry !== undefined);
    const entry = written[0] ?? {};
    if (!written.every((other) => sameText(other, entry))) return false;
    const usable = targets.every((target) => {
      if (perTarget.get(target)?.[name] !== undefined) return true;
      const base = bases.get(target)?.fields.get(name);
      if (base === undefined) return false;
      const { field } = base;
      const restricted =
        field.value !== undefined || field.enum !== undefined || field.dict !== undefined;
      return Object.keys(entry).length === 0 || !restricted;
    });
    if (usable) setOwn(shared, name, entry);
    return usable;
  });
  if (sharable) return { schema: shared };
  return Object.fromEntries(targets.map((target) => [target, { schema: perTarget.get(target) }]));
}

/**
 * Catalog and common fields that events must write (a `policy`) or that are required common fields,
 * with the targets they apply to
 */
function payloadFieldRequirements(plan: PlanSnapshot) {
  const fields = new Map<
    string,
    {
      name: string;
      type: string | null;
      targets: string[];
      policy?: string;
      required?: true;
      title?: string;
      enum?: unknown[];
      dict?: string;
    }
  >();
  for (const target of targetIds(plan.config)) {
    for (const [name, base] of mergeBaseLayers(plan.config, target).fields) {
      const required = base.common && base.field.required === true;
      if (base.policy === undefined && !required) continue;
      const known = fields.get(name);
      if (known) {
        known.targets.push(target);
        continue;
      }
      const { field } = base;
      fields.set(name, {
        name,
        type: field.type ?? null,
        targets: [target],
        ...(base.policy ? { policy: base.policy } : {}),
        ...(required ? { required: true as const } : {}),
        ...(field.title ? { title: field.title } : {}),
        ...(Array.isArray(field.enum) ? { enum: field.enum } : {}),
        ...(typeof field.dict === "string" ? { dict: field.dict } : {}),
      });
    }
  }
  return [...fields.values()];
}

// --- generate ------------------------------------------------------------------------------------

export interface GenerateArgs {
  /** A built-in export generator */
  generator?: "json" | "yaml";
  /** Index of a generate.run entry of opentp.cli.yaml: its generator, target, events and file */
  run?: number;
  /** Only these event keys */
  keys?: string[];
}

/**
 * The generator, options and events of a generate.run entry (its output is never written; its
 * template file must be inside the directory of opentp.cli.yaml)
 */
function runEntry(plan: PlanSnapshot, index: number) {
  const entries = plan.cli?.config.generate?.run ?? [];
  const entry = entries[index];
  if (entry === undefined || plan.cli === null) {
    throw new ToolError(
      entries.length === 0
        ? "opentp.cli.yaml has no generate.run entries: pass generator instead"
        : `No generate.run entry ${index}: opentp.cli.yaml has ${entries.length} (0 to ${entries.length - 1})`,
    );
  }
  const problems = getRunEntryProblems(entry, index, plan.cli.dir, plan.config, {
    output: false,
    generator: false,
  });
  if (problems.length > 0) {
    throw new ToolError(`opentp.cli.yaml: ${problems.join("; ")}`);
  }
  const options: GeneratorOptions = {
    ...(entry.file !== undefined ? { file: resolveCliPath(plan.cli, entry.file) } : {}),
    ...(entry.pretty !== undefined ? { pretty: entry.pretty } : {}),
  };
  return { entry, options, events: filterEvents(plan.events, plan.config, entry) };
}

export async function generate(plan: PlanSnapshot, args: GenerateArgs) {
  const problems = loadProblems(plan);
  if (problems.length > 0) {
    throw new ToolError(
      `The plan could not be loaded completely (${problems.length} problems), so it is not exported; run validate_plan`,
    );
  }

  let name: string;
  let options: GeneratorOptions = {};
  let events = plan.events;
  let entryOutput: string | undefined;
  if (args.run !== undefined) {
    const selected = runEntry(plan, args.run);
    if (args.generator !== undefined && args.generator !== selected.entry.generator) {
      throw new ToolError(
        `generate.run[${args.run}] uses the ${selected.entry.generator} generator, not ${args.generator}: pass only run`,
      );
    }
    name = selected.entry.generator;
    options = selected.options;
    events = selected.events;
    entryOutput = selected.entry.output;
  } else if (args.generator !== undefined) {
    name = args.generator;
  } else {
    throw new ToolError(
      "Pass generator (json or yaml) or run (the index of a generate.run entry in opentp.cli.yaml)",
    );
  }

  if (args.keys && args.keys.length > 0) {
    const unknown = args.keys.filter((key) => !plan.byKey.has(key));
    if (unknown.length > 0) {
      throw new ToolError(`Unknown event keys: ${unknown.join(", ")}`);
    }
    const selected = new Set(events);
    const outside = args.keys.filter((key) => !selected.has(plan.byKey.get(key) as ResolvedEvent));
    if (outside.length > 0) {
      throw new ToolError(
        `Not selected by generate.run[${args.run}] (target, events): ${outside.join(", ")}`,
      );
    }
    events = args.keys.map((key) => plan.byKey.get(key) as ResolvedEvent);
  }

  const generator = getGenerator(name);
  if (!generator) {
    throw new ToolError(
      `Unknown generator '${name}'${args.run !== undefined ? " (opentp mcp does not load generate.plugins)" : ""}`,
    );
  }
  let result: Awaited<ReturnType<typeof generator.generate>>;
  try {
    // No output option: generators return the text, and nothing is written
    result = await generator.generate(
      generatorContext({
        config: plan.config,
        events,
        dictionaries: plan.dictionaries,
        options,
        tracker: plan.tracker,
        cliConfig: plan.cli?.config ?? null,
      }),
    );
  } catch (error) {
    throw new ToolError(
      `The ${name} generator failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (result.stdout === undefined && (result.files?.length ?? 0) > 0) {
    throw new ToolError(
      `The ${name} generator writes files instead of returning text, and opentp mcp never writes files: run 'opentp generate' in a terminal`,
    );
  }
  const output = result.stdout ?? "";
  const bytes = Buffer.byteLength(output, "utf8");
  if (bytes > MAX_RESPONSE_BYTES) {
    throw new ToolError(
      `The ${name} export is ${Math.ceil(bytes / 1024)} KB, more than the ${MAX_RESPONSE_BYTES / 1024} KB limit for one response: pass keys to export only some events, or run 'opentp generate${args.run === undefined ? ` ${name}` : ""}' in a terminal`,
    );
  }
  return {
    generator: name,
    ...(args.run !== undefined
      ? {
          run: args.run,
          entryOutput,
          note: "Returned as text, not written: run 'opentp generate' to write the output file",
        }
      : {}),
    eventCount: events.length,
    bytes,
    output,
  };
}
