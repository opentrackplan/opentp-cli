import * as path from "node:path";
import { SPEC_VERSION } from "../meta";
import { getStepProblem } from "../transforms";
import type { OpenTPConfig } from "../types";
import {
  fileExists,
  getMatchTemplateProblems,
  isYamlMapping,
  loadYaml,
  parsePattern,
} from "../util";

const CONFIG_FILENAMES = ["opentp.yaml", "opentp.yml"];

/**
 * A problem in opentp.yaml itself. Reported once (as a validation error with event "opentp.yaml"),
 * never once per event file.
 */
export interface ConfigIssue {
  path: string;
  message: string;
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

/**
 * Loads and validates opentp.yaml
 */
export function loadConfig(filePath: string): OpenTPConfig {
  const config = loadYaml<OpenTPConfig>(filePath);

  // Basic structure validation
  if (typeof config.opentp !== "string" || config.opentp.length === 0) {
    throw new Error("Missing required field: opentp");
  }

  // Spec version format: YYYY-MM (valid month)
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(config.opentp)) {
    throw new Error(
      `Invalid spec version '${config.opentp}'. Expected format YYYY-MM (e.g., 2026-01)`,
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

  if (!config.spec.events.payload.schema) {
    throw new Error("Missing required field: spec.events.payload.schema");
  }

  return config;
}

/**
 * Checks opentp.yaml for problems that loadConfig does not reject but that would otherwise be
 * reported once per event file, or never: unusable templates, invalid regexes, keygen problems and
 * inconsistent target ids. Does not throw.
 */
export function validateConfig(config: OpenTPConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

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
        }
      }
    }
  }

  issues.push(...getKeygenProblems(config));

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
    for (const target of all) allTargets.add(String(target));
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

  // spec.targets: per-target base schemas are keyed by target id
  const specTargets: unknown = config.spec.targets;
  if (isYamlMapping(specTargets)) {
    for (const targetId of Object.keys(specTargets)) {
      if (!allTargets.has(targetId)) {
        issues.push({
          path: `spec.targets.${targetId}`,
          message: `Unknown target '${targetId}'. Keys of spec.targets must be listed in spec.events.payload.targets.all.`,
        });
      }
    }
  }

  return issues;
}

/**
 * Checks `spec.events.x-opentp.keygen`: the template must parse, every variable must be a taxonomy
 * field or fragment, every pipeline it names must be defined, and every pipeline must be a list of
 * known, well-formed steps (built-in or loaded with --external-transforms, so load external
 * transforms before calling this). Key generation is skipped (with no per-event error) while any of
 * these problems exist.
 */
export function getKeygenProblems(config: OpenTPConfig): ConfigIssue[] {
  const keygen: unknown = config.spec.events["x-opentp"]?.keygen;
  if (keygen === undefined || keygen === null) return [];

  const basePath = "spec.events.x-opentp.keygen";
  if (!isYamlMapping(keygen)) {
    return [
      { path: basePath, message: "keygen must be a mapping with 'template' and 'transforms'" },
    ];
  }

  const issues: ConfigIssue[] = [];
  const pipelines = new Set<string>();
  const transforms = keygen.transforms;
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
  const template = keygen.template;
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
