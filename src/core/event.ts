import * as fs from "node:fs";
import * as path from "node:path";
import { createTransforms } from "../transforms";
import type { EventFile, KeygenConfig, OpenTPConfig, ResolvedEvent, TaxonomyField } from "../types";
import {
  applyPattern,
  extractTemplateVariables,
  filterByExtension,
  formatLoadError,
  getMatchTemplateProblems,
  isYamlMapping,
  loadYaml,
  patternToRegex,
  scanDirectory,
} from "../util";
import { getKeygenProblems } from "./config";
import { walkEventDocument } from "./document";

/**
 * A file that could not be loaded. `file` is the path relative to the events root, or
 * "opentp.yaml" / "opentp.cli.yaml" for a configuration problem found while loading (no event was
 * loaded for it).
 */
export interface EventLoadIssue {
  file: string;
  path: string;
  message: string;
}

export interface LoadEventsResult {
  events: ResolvedEvent[];
  issues: EventLoadIssue[];
}

interface Keygen {
  template: string;
  transforms: Record<string, (value: string) => string>;
}

/** What loading one event document needs besides the document: built once per plan load */
export interface EventLoadContext {
  config: OpenTPConfig;
  fileTemplate: string;
  /** null when keygen is not configured or not usable (no expected key is generated) */
  keygen: Keygen | null;
}

export interface LoadEventsOptions {
  /** `keygen` from opentp.cli.yaml (key generation is a tool setting, not part of the plan) */
  keygen?: KeygenConfig | null;
  /** Absolute paths that are never read as events (the plan root's tool files) */
  skipFiles?: ReadonlySet<string>;
}

/** The result of loading one event document (see loadEventDocument) */
export type EventDocumentResult =
  | { status: "loaded"; event: ResolvedEvent }
  /** The path does not match spec.paths.events.template: loadEvents skips such files silently */
  | { status: "unmatched" }
  | { status: "failed"; issue: EventLoadIssue };

/**
 * Prepares loading single event documents. A transform step factory that throws while the keygen
 * pipelines are built is pushed to `issues` (against opentp.cli.yaml); other keygen problems are
 * reported once by validateEvents, and they only mean that no expected key is generated.
 */
export function createEventLoadContext(
  config: OpenTPConfig,
  fileTemplate: string,
  keygen: KeygenConfig | null | undefined,
  issues: EventLoadIssue[] = [],
): EventLoadContext {
  return { config, fileTemplate, keygen: prepareKeygen(keygen, config, issues) };
}

/**
 * Loads all events from a directory.
 *
 * Files that do not match the path template are skipped. A matching file that cannot be read or
 * parsed, or that has no `event` or `event.taxonomy` mapping, is not loaded and produces an issue.
 * A keygen failure for one event does not drop it: `expectedKey` is null and `keygenError` says why.
 *
 * Config-level problems (an unusable path template, keygen problems) are reported once by
 * validateConfig, so this function does not report them again per file: with an unusable path
 * template no event is loaded, and with keygen problems no key is generated.
 */
export function loadEvents(
  eventsPath: string,
  fileTemplate: string,
  config: OpenTPConfig,
  options: LoadEventsOptions = {},
): LoadEventsResult {
  const events: ResolvedEvent[] = [];
  const issues: EventLoadIssue[] = [];

  if (getMatchTemplateProblems(fileTemplate).length > 0) {
    return { events, issues };
  }

  if (!fs.existsSync(eventsPath)) {
    issues.push({
      file: "opentp.yaml",
      path: "spec.paths.events.root",
      message: `Events directory not found: ${eventsPath}`,
    });
    return { events, issues };
  }

  const allFiles = scanDirectory(eventsPath);
  const yamlFiles = filterByExtension(allFiles, [".yaml", ".yml"]);
  const skipFiles = options.skipFiles ?? new Set<string>();

  const context = createEventLoadContext(config, fileTemplate, options.keygen, issues);

  for (const [relativePath, absolutePath] of yamlFiles) {
    if (skipFiles.has(path.resolve(absolutePath))) continue;
    const result = loadEventDocument(context, relativePath, absolutePath, () =>
      loadYaml<unknown>(absolutePath),
    );
    if (result.status === "loaded") events.push(result.event);
    else if (result.status === "failed") issues.push(result.issue);
  }

  return { events, issues };
}

/**
 * Loads one event document the way loadEvents loads a file: the taxonomy comes from the path
 * (`relativePath`, relative to the events root and matched against the path template) and from
 * `event.taxonomy`, and the expected key is generated. `readDocument` returns the parsed YAML; it is
 * called only when the path matches, and a throw becomes a load issue (YAML errors keep their line
 * and column). Requires a usable path template (see getMatchTemplateProblems).
 */
export function loadEventDocument(
  context: EventLoadContext,
  relativePath: string,
  absolutePath: string,
  readDocument: () => unknown,
): EventDocumentResult {
  const { config, fileTemplate, keygen } = context;

  // Extract variables from file path
  const pathVariables = extractTemplateVariables(relativePath, fileTemplate);
  if (!pathVariables) {
    return { status: "unmatched" };
  }

  const fail = (path: string, message: string): EventDocumentResult => ({
    status: "failed",
    issue: { file: relativePath, path, message },
  });

  let document: unknown;
  try {
    document = readDocument();
  } catch (error) {
    return fail("", formatLoadError(error));
  }

  if (!isYamlMapping(document)) {
    return fail("", "Expected a mapping with 'opentp' and 'event'");
  }
  if (document.event === undefined || document.event === null) {
    return fail("event", "Missing required field: event");
  }
  if (!isYamlMapping(document.event)) {
    return fail("event", "Invalid field: event must be a mapping");
  }
  if (document.event.taxonomy === undefined || document.event.taxonomy === null) {
    return fail("event.taxonomy", "Missing required field: event.taxonomy");
  }
  if (!isYamlMapping(document.event.taxonomy)) {
    return fail("event.taxonomy", "Invalid field: event.taxonomy must be a mapping");
  }

  const eventFile = document as unknown as EventFile;

  // One walk of the raw document: removed keywords, field definitions that are not mappings, and
  // every written check id and dictionary reference (checked once per file by validateEvents)
  const walk = walkEventDocument(document);

  // Extract taxonomy from path and file
  let taxonomy: Record<string, unknown>;
  try {
    taxonomy = extractTaxonomy(pathVariables, eventFile, config);
  } catch (error) {
    return fail("event.taxonomy", `Cannot read taxonomy: ${formatLoadError(error)}`);
  }

  // Generate expected key
  let expectedKey: string | null = null;
  let keygenError: string | undefined;
  if (keygen) {
    try {
      expectedKey = generateEventKey(taxonomy, keygen.template, keygen.transforms);
    } catch (error) {
      keygenError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    status: "loaded",
    event: {
      filePath: absolutePath,
      relativePath,
      opentp: eventFile.opentp,
      key: eventFile.event.key,
      expectedKey,
      keygenError,
      taxonomy,
      lifecycle: eventFile.event.lifecycle,
      aliases: eventFile.event.aliases,
      ignore: Array.isArray(eventFile.event.ignore) ? eventFile.event.ignore : [],
      payload: eventFile.event.payload,
      fileIssues: walk.issues,
      checkRefs: walk.checks,
      dictRefs: walk.dicts,
    },
  };
}

/**
 * Builds the keygen template and its named pipelines, or returns null when keygen is not
 * configured or not usable (see getKeygenProblems, reported once by validateEvents).
 */
function prepareKeygen(
  keygen: KeygenConfig | null | undefined,
  config: OpenTPConfig,
  issues: EventLoadIssue[],
): Keygen | null {
  if (!keygen || getKeygenProblems(keygen, config).length > 0) return null;

  try {
    return { template: keygen.template, transforms: createTransforms(keygen.transforms ?? {}) };
  } catch (error) {
    // A transform step factory (e.g. a plugin) threw while building a pipeline
    issues.push({
      file: "opentp.cli.yaml",
      path: "keygen.transforms",
      message: `Cannot build keygen pipelines: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }
}

/**
 * Extracts taxonomy from path variables and file data
 */
function extractTaxonomy(
  pathVariables: Record<string, string>,
  eventFile: EventFile,
  config: OpenTPConfig,
): Record<string, unknown> {
  const taxonomy: Record<string, unknown> = {};
  const taxonomyConfig = config.spec.events.taxonomy;

  // Process each taxonomy field from config
  for (const [fieldName, fieldConfig] of Object.entries(taxonomyConfig)) {
    // Invalid definitions are reported once by validateConfig
    if (!isYamlMapping(fieldConfig)) continue;

    // Field can come from path
    if (pathVariables[fieldName] !== undefined) {
      taxonomy[fieldName] = parseTypedValue(pathVariables[fieldName], fieldConfig.type);

      // If field is composite with template, parse into fragments
      if (
        fieldConfig.template &&
        fieldConfig.fragments &&
        typeof taxonomy[fieldName] === "string"
      ) {
        const fragments = extractFragments(
          taxonomy[fieldName] as string,
          fieldConfig.template,
          fieldConfig.fragments,
        );
        Object.assign(taxonomy, fragments);
      }
    }
    // Or from event file (e.g. trigger, team)
    else if (eventFile.event.taxonomy[fieldName] !== undefined) {
      taxonomy[fieldName] = eventFile.event.taxonomy[fieldName];

      // If field is composite with template, parse into fragments
      if (
        fieldConfig.template &&
        fieldConfig.fragments &&
        typeof taxonomy[fieldName] === "string"
      ) {
        const fragments = extractFragments(
          taxonomy[fieldName] as string,
          fieldConfig.template,
          fieldConfig.fragments,
        );
        Object.assign(taxonomy, fragments);
      }
    }
  }

  return taxonomy;
}

/**
 * Extracts fragments from a composite field
 * Example: 'Click - Button - Description' by pattern '{action} - {object} - {objectDescription}'
 */
function extractFragments(
  value: string,
  template: string,
  fragments: Record<string, TaxonomyField>,
): Record<string, string | number | boolean> {
  // An unusable composite template is reported once by validateConfig
  if (getMatchTemplateProblems(template).length > 0 || !isYamlMapping(fragments)) return {};

  const regex = patternToRegex(template);
  const match = value.match(regex);
  if (!match?.groups) return {};

  const out: Record<string, string | number | boolean> = {};
  for (const [fragName, fragValue] of Object.entries(match.groups)) {
    const fragConfig = fragments[fragName];
    if (!isYamlMapping(fragConfig)) continue;
    out[fragName] = parseTypedValue(fragValue, fragConfig.type);
  }

  return out;
}

/**
 * Generates event key from pattern and transforms
 */
function generateEventKey(
  taxonomy: Record<string, unknown>,
  template: string,
  transforms: Record<string, (value: string) => string>,
): string {
  const variables: Record<string, string> = {};
  for (const [key, value] of Object.entries(taxonomy)) {
    if (value === undefined || value === null) continue;
    variables[key] = String(value);
  }
  return applyPattern(template, variables, transforms);
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
