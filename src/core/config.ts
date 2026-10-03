import * as path from "node:path";
import {
  CHECK_ID_PATTERN,
  invalidCheckIdMessage,
  RESERVED_WEBHOOK_MESSAGE,
  WEBHOOK_CHECK_ID,
} from "../checks";
import { SPEC_VERSION, VERSION } from "../meta";
import { getStepProblem } from "../transforms";
import type { KeygenConfig, OpenTPConfig } from "../types";
import {
  fileExists,
  getMatchTemplateProblems,
  isYamlMapping,
  loadYaml,
  parsePattern,
} from "../util";
import { PORTABLE_CHECK_KEYWORDS } from "./constraints";
import { walkConfigDocument } from "./document";
import { analyzeBaseLayers } from "./fields";

const CONFIG_FILENAMES = ["opentp.yaml", "opentp.yml"];

/** The version a 2026-09 plan is migrated from with `opentp migrate` */
export const PREVIOUS_SPEC_VERSION = "2026-01";

/** Appended to the version error of an event or dictionary file that still says 2026-01 */
export const MIGRATE_FILE_HINT = ' Run "opentp migrate" to upgrade it.';

/**
 * Appended instead in an application repository: migrate edits the plan repository and refuses to
 * run there, so the application pins another plan ref
 */
export const PINNED_FILE_HINT = ` Pin a plan ref whose files are all on ${SPEC_VERSION}.`;

/**
 * A problem in opentp.yaml itself. Reported once (as a validation error with event "opentp.yaml"),
 * never once per event file.
 */
export interface ConfigIssue {
  path: string;
  message: string;
  /**
   * The file label of the problem when it is not the file that the list belongs to: in an
   * application repository, `opentp.cli.yaml of the plan '<plan>'` for a tracker problem at a key
   * that only the plan repository's opentp.cli.yaml has
   */
  file?: string;
}

/**
 * Finds opentp.yaml file in a directory
 */
export function findConfigFile(rootPath: string): string | null {
  for (const filename of CONFIG_FILENAMES) {
    const filePath = path.join(rootPath, filename);
    if (fileExists(filePath)) {
      return filePath;
    }
  }
  return null;
}

/** The message for a plan on the previous spec version (exit 2, before anything else) */
export function previousVersionMessage(): string {
  return `This plan uses OpenTrackPlan ${PREVIOUS_SPEC_VERSION}; opentp ${VERSION} reads ${SPEC_VERSION}. Run "opentp migrate" to upgrade it (or keep opentp 0.9.1: OPENTP_VERSION=0.9.1).`;
}

/**
 * The message for a plan on the previous spec version that an application repository pins
 * (`plan:` as written): the application cannot migrate it, it pins another ref
 */
export function pinnedPreviousVersionMessage(plan: string): string {
  return `The pinned plan ${plan} uses OpenTrackPlan ${PREVIOUS_SPEC_VERSION}; opentp ${VERSION} reads ${SPEC_VERSION}. Pin a plan ref that is on ${SPEC_VERSION} (or keep opentp 0.9.1: OPENTP_VERSION=0.9.1).`;
}

export interface LoadConfigOptions {
  /** Application repository mode: `plan:` as written (changes the 2026-01 guidance) */
  pinnedPlan?: string;
}

/**
 * The version error of an event or dictionary file whose own `opentp` differs from the plan's
 * (with a hint when it is the previous version: migrate, or in an application repository
 * (`pinnedPlan`) another plan ref)
 */
export function fileVersionMessage(
  fileVersion: string,
  planVersion: string,
  pinnedPlan = false,
): string {
  const message = `Unsupported OpenTrackPlan schema version '${fileVersion}'. Expected '${planVersion}'.`;
  if (fileVersion !== PREVIOUS_SPEC_VERSION || planVersion !== SPEC_VERSION) return message;
  return `${message}${pinnedPlan ? PINNED_FILE_HINT : MIGRATE_FILE_HINT}`;
}

/**
 * Loads and validates opentp.yaml. The version is checked first.
 * @throws Error for a configuration that cannot be used at all (exit 2)
 */
export function loadConfig(filePath: string, options: LoadConfigOptions = {}): OpenTPConfig {
  const directory = path.dirname(filePath);
  if (CONFIG_FILENAMES.every((name) => fileExists(path.join(directory, name)))) {
    throw new Error(`Both opentp.yaml and opentp.yml exist in ${directory}; keep one`);
  }

  const document = loadYaml<unknown>(filePath);
  if (!isYamlMapping(document)) {
    throw new Error("Expected a mapping with 'opentp', 'info' and 'spec'");
  }
  const config = document as unknown as OpenTPConfig;

  // Basic structure validation
  if (typeof config.opentp !== "string" || config.opentp.length === 0) {
    throw new Error("Missing required field: opentp");
  }

  if (config.opentp === PREVIOUS_SPEC_VERSION && SPEC_VERSION !== PREVIOUS_SPEC_VERSION) {
    throw new Error(
      options.pinnedPlan === undefined
        ? previousVersionMessage()
        : pinnedPreviousVersionMessage(options.pinnedPlan),
    );
  }

  // Spec version format: YYYY-MM (valid month)
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(config.opentp)) {
    throw new Error(
      `Invalid spec version '${config.opentp}'. Expected format YYYY-MM (e.g., ${SPEC_VERSION})`,
    );
  }

  // CLI compatibility check
  if (config.opentp !== SPEC_VERSION) {
    throw new Error(
      `Unsupported OpenTrackPlan schema version '${config.opentp}'. This CLI supports '${SPEC_VERSION}'.`,
    );
  }

  if (!config.info) {
    throw new Error("Missing required field: info");
  }

  if (!config.info.title) {
    throw new Error("Missing required field: info.title");
  }

  if (!config.info.version) {
    throw new Error("Missing required field: info.version");
  }

  if (!config.spec) {
    throw new Error("Missing required field: spec");
  }

  if (!config.spec.paths) {
    throw new Error("Missing required field: spec.paths");
  }

  if (!config.spec.paths.events) {
    throw new Error("Missing required field: spec.paths.events");
  }

  if (!config.spec.paths.events.root) {
    throw new Error("Missing required field: spec.paths.events.root");
  }

  if (!config.spec.paths.events.template) {
    throw new Error("Missing required field: spec.paths.events.template");
  }

  if (!config.spec.events) {
    throw new Error("Missing required field: spec.events");
  }

  if (!config.spec.events.taxonomy) {
    throw new Error("Missing required field: spec.events.taxonomy");
  }

  if (!config.spec.events.payload) {
    throw new Error("Missing required field: spec.events.payload");
  }

  if (!config.spec.events.payload.targets) {
    throw new Error("Missing required field: spec.events.payload.targets");
  }

  if (!config.spec.events.payload.targets.all) {
    throw new Error("Missing required field: spec.events.payload.targets.all");
  }

  return config;
}

/**
 * Checks opentp.yaml for problems that loadConfig does not reject but that would otherwise be
 * reported once per event file, or never: removed keywords, field definitions that are not
 * mappings, unusable templates, invalid regexes, inconsistent target ids, broken portable checks,
 * and the problems of the base layers (catalog, spec.targets.all, spec.targets.<T>) that do not
 * need dictionaries (validateEvents reports the others). Does not throw.
 */
export function validateConfig(config: OpenTPConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  // Removed keywords (x-opentp, valueRequired), payload field definitions that are not mappings,
  // empty enums, conflicting value/enum/dict and invalid field regexes, where they are written
  const walk = walkConfigDocument(config);
  issues.push(...walk.issues);

  // Check ids written on fields, items, taxonomy and pii settings (spec.checks ids: below)
  for (const ref of walk.checks) {
    if (!CHECK_ID_PATTERN.test(ref.id)) {
      issues.push({ path: `${ref.path}.${ref.id}`, message: invalidCheckIdMessage(ref.id) });
    }
  }

  // Path template: every event file is matched against it
  for (const problem of getMatchTemplateProblems(config.spec.paths.events.template)) {
    issues.push({ path: "spec.paths.events.template", message: problem });
  }

  checkRegex(config.spec.events.key?.pattern, "spec.events.key.pattern", issues);

  // Taxonomy field definitions, composite templates and regexes
  const taxonomy: unknown = config.spec.events.taxonomy;
  if (!isYamlMapping(taxonomy)) {
    issues.push({ path: "spec.events.taxonomy", message: "Expected a mapping of taxonomy fields" });
  } else {
    for (const [name, field] of Object.entries(taxonomy)) {
      const fieldPath = `spec.events.taxonomy.${name}`;
      if (!isYamlMapping(field)) {
        issues.push({ path: fieldPath, message: "Field definition must be a mapping" });
        continue;
      }

      checkRegex(field.pattern, `${fieldPath}.pattern`, issues);
      checkEnumAndDict(field, fieldPath, issues);

      if (field.template !== undefined) {
        for (const problem of getMatchTemplateProblems(field.template)) {
          issues.push({ path: `${fieldPath}.template`, message: problem });
        }
      }

      if (field.fragments !== undefined && field.fragments !== null) {
        if (!isYamlMapping(field.fragments)) {
          issues.push({
            path: `${fieldPath}.fragments`,
            message: "Expected a mapping of fragment definitions",
          });
          continue;
        }
        for (const [fragName, fragment] of Object.entries(field.fragments)) {
          const fragPath = `${fieldPath}.fragments.${fragName}`;
          if (!isYamlMapping(fragment)) {
            issues.push({ path: fragPath, message: "Field definition must be a mapping" });
            continue;
          }
          checkRegex(fragment.pattern, `${fragPath}.pattern`, issues);
          checkEnumAndDict(fragment, fragPath, issues);
        }
      }
    }
  }

  // Payload targets: groups may only contain ids from targets.all
  const targets: Record<string, unknown> = config.spec.events.payload.targets;
  const all = targets.all;
  const allTargets = new Set<string>();
  if (!Array.isArray(all) || all.length === 0 || all.some((t) => typeof t !== "string")) {
    issues.push({
      path: "spec.events.payload.targets.all",
      message: "targets.all must be a non-empty list of target ids",
    });
  }
  if (Array.isArray(all)) {
    all.forEach((target, index) => {
      const itemPath = `spec.events.payload.targets.all[${index}]`;
      if (target === "") {
        issues.push({ path: itemPath, message: "A target id must not be empty" });
      } else if (allTargets.has(String(target))) {
        issues.push({ path: itemPath, message: `Duplicate target id '${String(target)}'` });
      }
      allTargets.add(String(target));
    });
  }

  for (const [group, members] of Object.entries(targets)) {
    if (group === "all") continue;
    const groupPath = `spec.events.payload.targets.${group}`;
    if (!Array.isArray(members)) {
      issues.push({ path: groupPath, message: "Target group must be a list of target ids" });
      continue;
    }
    for (const member of members) {
      if (!allTargets.has(member)) {
        issues.push({
          path: groupPath,
          message: `Unknown target '${member}' in group '${group}'. Group members must be listed in spec.events.payload.targets.all.`,
        });
      }
    }
  }

  // spec.targets: common fields of every target (`all`) and of one target (its id)
  const specTargets: unknown = config.spec.targets;
  if (isYamlMapping(specTargets)) {
    for (const targetId of Object.keys(specTargets)) {
      if (targetId !== "all" && !allTargets.has(targetId)) {
        issues.push({
          path: `spec.targets.${targetId}`,
          message: `Unknown target '${targetId}'. Keys of spec.targets must be 'all' or listed in spec.events.payload.targets.all.`,
        });
      }
    }
  }

  issues.push(...getPortableCheckProblems(config.spec.checks));

  const pii: unknown = config.spec.events.pii;
  if (isYamlMapping(pii)) {
    for (const name of ["kind", "masker"]) {
      const reserved = pii[name];
      if (isYamlMapping(reserved)) {
        checkRegex(reserved.pattern, `spec.events.pii.${name}.pattern`, issues);
        checkEnumAndDict(reserved, `spec.events.pii.${name}`, issues);
      }
    }
    if (isYamlMapping(pii.schema)) {
      for (const [name, meta] of Object.entries(pii.schema)) {
        if (isYamlMapping(meta)) checkEnumAndDict(meta, `spec.events.pii.schema.${name}`, issues);
      }
    }
  }

  // Catalog and common fields: conflicts between the layers, types, values, enum members, examples
  for (const issue of analyzeBaseLayers(config)) {
    if (!issue.dictionary) issues.push({ path: issue.path, message: issue.message });
  }

  return issues;
}

/**
 * `enum` and `dict` together on a taxonomy field, fragment or pii setting (payload fields are
 * checked by the document walk, with `value`)
 */
function checkEnumAndDict(
  definition: Record<string, unknown>,
  path: string,
  issues: ConfigIssue[],
): void {
  if (definition.enum !== undefined && definition.dict !== undefined) {
    issues.push({ path, message: "enum and dict cannot be used together" });
  }
}

/** `spec.checks`: ids, at least one portable keyword per check, valid regexes */
function getPortableCheckProblems(checks: unknown): ConfigIssue[] {
  if (checks === undefined || checks === null) return [];
  if (!isYamlMapping(checks)) {
    return [
      { path: "spec.checks", message: "Expected a mapping of check ids to check definitions" },
    ];
  }
  const issues: ConfigIssue[] = [];
  for (const [id, definition] of Object.entries(checks)) {
    const checkPath = `spec.checks.${id}`;
    if (id === WEBHOOK_CHECK_ID) {
      issues.push({ path: checkPath, message: RESERVED_WEBHOOK_MESSAGE });
      continue;
    }
    if (!CHECK_ID_PATTERN.test(id)) {
      issues.push({ path: checkPath, message: invalidCheckIdMessage(id) });
    }
    if (!isYamlMapping(definition)) {
      issues.push({ path: checkPath, message: "A portable check must be a mapping of keywords" });
      continue;
    }
    if (!PORTABLE_CHECK_KEYWORDS.some((keyword) => definition[keyword] !== undefined)) {
      issues.push({
        path: checkPath,
        message: `A portable check needs at least one of: ${PORTABLE_CHECK_KEYWORDS.join(", ")}`,
      });
    }
    checkRegex(definition.pattern, `${checkPath}.pattern`, issues);
  }
  return issues;
}

/**
 * Checks `keygen` (opentp.cli.yaml): the template must parse, every variable must be a taxonomy
 * field or fragment, every pipeline it names must be defined, and every pipeline must be a list of
 * known, well-formed steps (built-in or loaded as plugins, so load transform plugins before calling
 * this). Paths are relative to opentp.cli.yaml (`keygen.template`,
 * `keygen.transforms.<pipeline>[<i>]`). Key generation is skipped (with no per-event error) while
 * any of these problems exist.
 */
export function getKeygenProblems(
  keygen: KeygenConfig | null | undefined,
  config: OpenTPConfig,
): ConfigIssue[] {
  if (keygen === undefined || keygen === null) return [];

  const basePath = "keygen";
  if (!isYamlMapping(keygen)) {
    return [
      { path: basePath, message: "keygen must be a mapping with 'template' and 'transforms'" },
    ];
  }

  const issues: ConfigIssue[] = [];
  const pipelines = new Set<string>();
  const transforms: unknown = keygen.transforms;
  if (transforms !== undefined && transforms !== null) {
    if (!isYamlMapping(transforms)) {
      issues.push({
        path: `${basePath}.transforms`,
        message: "Expected a mapping of pipeline names to lists of steps",
      });
    } else {
      for (const [name, steps] of Object.entries(transforms)) {
        pipelines.add(name);
        if (!Array.isArray(steps)) {
          issues.push({
            path: `${basePath}.transforms.${name}`,
            message: `Keygen pipeline '${name}' must be a list of steps`,
          });
          continue;
        }
        // Unknown or malformed steps are configuration errors, never a silent identity step
        steps.forEach((step: unknown, index: number) => {
          const problem = getStepProblem(step);
          if (problem) {
            issues.push({ path: `${basePath}.transforms.${name}[${index}]`, message: problem });
          }
        });
      }
    }
  }

  const templatePath = `${basePath}.template`;
  const template: unknown = keygen.template;
  if (typeof template !== "string" || template.length === 0) {
    issues.push({ path: templatePath, message: `Missing required field: ${templatePath}` });
    return issues;
  }

  let parts: ReturnType<typeof parsePattern>;
  try {
    parts = parsePattern(template);
  } catch (error) {
    issues.push({
      path: templatePath,
      message: error instanceof Error ? error.message : String(error),
    });
    return issues;
  }

  // Keygen variables come from the extracted taxonomy: declared fields and their fragments
  const variables = new Set<string>();
  const taxonomy: unknown = config.spec.events.taxonomy;
  if (isYamlMapping(taxonomy)) {
    for (const [name, field] of Object.entries(taxonomy)) {
      variables.add(name);
      if (isYamlMapping(field) && isYamlMapping(field.fragments)) {
        for (const fragName of Object.keys(field.fragments)) variables.add(fragName);
      }
    }
  }

  const messages = new Set<string>();
  for (const part of parts) {
    if (part.type !== "variable") continue;
    if (!variables.has(part.value)) {
      messages.add(
        `Unknown variable '{${part.value}}': keygen variables must be taxonomy fields or fragments declared in spec.events.taxonomy`,
      );
    }
    for (const pipeline of part.transforms ?? []) {
      if (!pipelines.has(pipeline)) {
        messages.add(`Unknown keygen pipeline '${pipeline}'. Define it in ${basePath}.transforms.`);
      }
    }
  }
  for (const message of messages) issues.push({ path: templatePath, message });

  return issues;
}

function checkRegex(pattern: unknown, issuePath: string, issues: ConfigIssue[]): void {
  if (typeof pattern !== "string") return;
  try {
    new RegExp(pattern, "u");
  } catch (error) {
    issues.push({ path: issuePath, message: `Invalid regex: ${String(error)}` });
  }
}

/**
 * Returns absolute path for a relative path from config
 * Paths in config start with / relative to project root
 */
export function resolvePath(rootPath: string, configPath: string): string {
  // Remove leading / if present
  const cleanPath = configPath.startsWith("/") ? configPath.slice(1) : configPath;
  return path.join(rootPath, cleanPath);
}

/**
 * Gets events directory path from config
 */
export function getEventsPath(config: OpenTPConfig, rootPath: string): string | null {
  const eventsConfig = config.spec.paths.events;
  return resolvePath(rootPath, eventsConfig.root);
}

/**
 * Gets dictionaries directory path from config
 */
export function getDictsPath(config: OpenTPConfig, rootPath: string): string | null {
  const dictsConfig = config.spec.paths.dictionaries;
  if (dictsConfig) {
    return resolvePath(rootPath, dictsConfig.root);
  }
  return null;
}

/**
 * Gets template for event files
 */
export function getEventsTemplate(config: OpenTPConfig): string | null {
  return config.spec.paths.events.template;
}

/**
 * Tool files at the plan root that are never read as events or dictionaries, even when an events
 * or dictionaries root is the plan root
 */
export const ROOT_TOOL_FILES = ["opentp.yaml", "opentp.yml", "opentp.cli.yaml", "opentp.cli.yml"];

/** Absolute paths of ROOT_TOOL_FILES in a plan root (for the event and dictionary scans) */
export function rootToolFiles(rootPath: string): Set<string> {
  return new Set(ROOT_TOOL_FILES.map((name) => path.resolve(rootPath, name)));
}
