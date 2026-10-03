/**
 * The MCP tools of `opentp mcp` as plain functions over a loaded plan.
 *
 * Every tool is read-only: nothing here writes a file. Agents that change the plan write event files
 * themselves, guided by suggest_event and checked by validate_event_draft / validate_plan.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { createEventLoadContext, type EventLoadIssue, loadEventDocument } from "../core/event";
import { resolveEffectivePayload, UNVERSIONED_VERSION_KEY } from "../core/payload";
import { configIssuesToErrors, loadIssuesToErrors } from "../core/validator";
import { getGenerator } from "../generators";
import type { Field, ResolvedEvent, ValidationError } from "../types";
import {
  extractTemplateVariables,
  getMatchTemplateProblems,
  isYamlMapping,
  parsePattern,
} from "../util";
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
}

function errorEntries(errors: ValidationError[]): ErrorEntry[] {
  return errors.map(({ path: errorPath, message }) => ({ path: errorPath, message }));
}

/** Problems of the plan itself that block a complete load (generate refuses on them, like the CLI) */
function loadProblems(plan: PlanSnapshot): ValidationError[] {
  return [
    ...configIssuesToErrors(plan.configIssues),
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

/**
 * Removes `webhook` checks that a draft defines itself: validating a draft must not send requests to
 * URLs (with `${ENV}` values) chosen by whoever wrote the draft. Checks from opentp.yaml still run.
 * Returns how many were removed.
 */
function removeDraftWebhooks(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + removeDraftWebhooks(item), 0);
  if (!isYamlMapping(value)) return 0;
  let removed = 0;
  for (const [key, child] of Object.entries(value)) {
    if (key === "checks" && isYamlMapping(child) && Object.hasOwn(child, "webhook")) {
      delete child.webhook;
      removed++;
    }
    removed += removeDraftWebhooks(child);
  }
  return removed;
}

// --- describe_plan -------------------------------------------------------------------------------

export function describePlan(plan: PlanSnapshot) {
  const { config } = plan;
  const problems = templateProblems(plan);
  const pathFields = new Set(problems.length === 0 ? templateVariables(plan.eventsTemplate) : []);
  const taxonomy: Record<string, unknown> = {};
  for (const [name, definition] of Object.entries(config.spec.events.taxonomy)) {
    taxonomy[name] = isYamlMapping(definition)
      ? { ...definition, fromPath: pathFields.has(name) }
      : definition;
  }
  const targetSchemas: Record<string, unknown> = {};
  for (const [id, target] of Object.entries(config.spec.targets ?? {})) {
    targetSchemas[id] = target?.schema ?? {};
  }

  return {
    title: config.info.title,
    version: config.info.version,
    description: config.info.description ?? null,
    opentp: config.opentp,
    eventsRoot: plan.eventsRoot,
    pathTemplate: plan.eventsTemplate,
    ...(problems.length > 0 ? { pathTemplateProblems: problems } : {}),
    dictionariesRoot: plan.dictsPath ? plan.projectPath(plan.dictsPath) : null,
    taxonomy,
    key: {
      constraints: config.spec.events.key ?? null,
      keygenTemplate: config.spec.events["x-opentp"]?.keygen?.template ?? null,
    },
    targets: config.spec.events.payload.targets,
    baseSchema: config.spec.events.payload.schema,
    targetSchemas,
    pii: config.spec.events.pii ?? null,
    counts: {
      events: plan.events.length,
      dictionaries: plan.dictionaries.size,
      loadProblems: loadProblems(plan).length,
    },
    howTo: [
      "Taxonomy fields with fromPath=true come from the event file path (pathTemplate); the others are set in event.taxonomy.",
      "Find events with search_events, then read one with get_event (effective payload per target).",
      "To add or change an event: call suggest_event for the file path, key and a skeleton, write the YAML file, then call validate_event_draft (before writing) or validate_plan (after).",
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
  const { targets, issues } = resolveEffectivePayload(event.payload, plan.config);

  let entries = Object.values(targets);
  if (args.target !== undefined) {
    entries = entries.filter((entry) => entry.target === args.target);
    if (entries.length === 0) {
      throw new ToolError(
        `Event '${event.key}' has no payload for target '${args.target}'. Targets: ${Object.keys(targets).join(", ") || "none"}`,
      );
    }
  }

  // Targets with the same version and effective schema are listed together (an implicit `all`
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
      schema,
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
  const context = createEventLoadContext(plan.config, plan.eventsTemplate, contextIssues);
  const result = loadEventDocument(
    context,
    relativePath,
    path.join(plan.eventsPath, relativePath),
    readDocument,
  );
  return { relativePath, result, keygenConfigured: context.keygen !== null };
}

/** Validates one loaded draft against the plan: event checks plus key uniqueness across the plan */
async function checkDraft(plan: PlanSnapshot, event: ResolvedEvent) {
  const all = await plan.validateEvents([event]);
  const errors = all.filter((error) => error.event === event.relativePath);
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
  return { errors: errorEntries(errors), planProblems };
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
  let webhooksSkipped = 0;
  const { relativePath, result } = loadDraft(plan, args.path, () => {
    const document = parseYaml(args.yaml);
    webhooksSkipped = removeDraftWebhooks(document);
    return document;
  });
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
    };
  }
  if (result.status === "failed") {
    return {
      valid: false,
      file,
      ...existing,
      errors: [{ path: result.issue.path, message: result.issue.message }],
    };
  }

  const event = result.event;
  const { errors, planProblems } = await checkDraft(plan, event);
  return {
    valid: errors.length === 0,
    file,
    key: event.key ?? null,
    expectedKey: event.expectedKey,
    taxonomy: event.taxonomy,
    ...existing,
    errors,
    ...(webhooksSkipped > 0
      ? {
          note: `${webhooksSkipped} webhook check(s) defined in the draft were not run (a draft must not trigger requests); checks from opentp.yaml ran`,
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
  const errors = await plan.validation();
  const requested = (args.files ?? []).map((file) => {
    const relativePath = plan.eventsRelativePath(file);
    checkRelativePath(relativePath);
    return relativePath;
  });

  let selected = errors;
  let files: Array<{ file: string; status: string; reason?: string; errorCount: number }> = [];
  if (requested.length > 0) {
    const wanted = new Set(requested);
    selected = errors.filter((error) => wanted.has(error.event));
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
    event: { key: "", taxonomy: fileTaxonomy, payload: { schema: {} } },
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
          "Key generation is not configured or not usable (spec.events.x-opentp.keygen): choose a key that follows spec.events.key";
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
  const requiredPayloadFields = Object.entries(config.spec.events.payload.schema ?? {})
    .filter(([, field]) => isYamlMapping(field) && field.required === true)
    .map(([name, field]) => ({
      name,
      type: field.type ?? null,
      needsValue: field.valueRequired === true,
      ...(field.title ? { title: field.title } : {}),
      ...(field.enum ? { enum: field.enum } : {}),
      ...(field.dict ? { dict: field.dict } : {}),
    }));

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

// --- generate ------------------------------------------------------------------------------------

export async function generate(
  plan: PlanSnapshot,
  args: { generator: "json" | "yaml"; keys?: string[] },
) {
  const problems = loadProblems(plan);
  if (problems.length > 0) {
    throw new ToolError(
      `The plan could not be loaded completely (${problems.length} problems), so it is not exported; run validate_plan`,
    );
  }

  let events = plan.events;
  if (args.keys && args.keys.length > 0) {
    const unknown = args.keys.filter((key) => !plan.byKey.has(key));
    if (unknown.length > 0) {
      throw new ToolError(`Unknown event keys: ${unknown.join(", ")}`);
    }
    events = args.keys.map((key) => plan.byKey.get(key) as ResolvedEvent);
  }

  const generator = getGenerator(args.generator);
  if (!generator) throw new ToolError(`Unknown generator '${args.generator}'`);
  const result = await generator.generate({
    config: plan.config,
    events,
    dictionaries: plan.dictionaries,
    options: {},
  });
  const output = result.stdout ?? "";
  const bytes = Buffer.byteLength(output, "utf8");
  if (bytes > MAX_RESPONSE_BYTES) {
    throw new ToolError(
      `The ${args.generator} export is ${Math.ceil(bytes / 1024)} KB, more than the ${MAX_RESPONSE_BYTES / 1024} KB limit for one response: pass keys to export only some events, or run 'opentp generate ${args.generator}' in a terminal`,
    );
  }
  return { generator: args.generator, eventCount: events.length, bytes, output };
}
