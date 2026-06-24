import * as path from "node:path";
import { SPEC_VERSION } from "../meta";
import type { OpenTPConfig } from "../types";
import { fileExists, loadYaml } from "../util";

const CONFIG_FILENAMES = ["opentp.yaml", "opentp.yml"];

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

/** Traverse a nested object by dot-separated path and return the value */
function getNestedValue(obj: unknown, fieldPath: string): unknown {
  let cur: unknown = obj;
  for (const key of fieldPath.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Throw if the given dot-path resolves to a falsy value */
function requireField(obj: unknown, fieldPath: string): void {
  if (!getNestedValue(obj, fieldPath)) {
    throw new Error(`Missing required field: ${fieldPath}`);
  }
}

const VALID_THEMES = ["dark", "light", "auto"] as const;
const VALID_MODES = ["editor", "viewer"] as const;

/** Validate optional export section */
function validateExport(config: OpenTPConfig): void {
  const exp = config.spec.export;
  if (!exp) return;

  if (exp.generators !== undefined) {
    if (!Array.isArray(exp.generators)) {
      throw new Error("spec.export.generators must be an array");
    }
    for (let i = 0; i < exp.generators.length; i++) {
      const gen = exp.generators[i];
      if (typeof gen.name !== "string" || gen.name.length === 0) {
        throw new Error(`spec.export.generators[${i}].name must be a non-empty string`);
      }
      if (gen.target !== undefined && typeof gen.target !== "string") {
        throw new Error(`spec.export.generators[${i}].target must be a string`);
      }
      if (gen.standalone !== undefined && typeof gen.standalone !== "boolean") {
        throw new Error(`spec.export.generators[${i}].standalone must be a boolean`);
      }
    }
  }

  if (exp.bundle !== undefined && typeof exp.bundle !== "boolean") {
    throw new Error("spec.export.bundle must be a boolean");
  }
}

/** Validate optional ui section */
function validateUi(config: OpenTPConfig): void {
  const ui = config.spec.ui;
  if (!ui) return;

  if (ui.theme !== undefined && !(VALID_THEMES as readonly string[]).includes(ui.theme)) {
    throw new Error(`spec.ui.theme must be one of: ${VALID_THEMES.join(", ")}`);
  }

  if (ui.mode !== undefined && !(VALID_MODES as readonly string[]).includes(ui.mode)) {
    throw new Error(`spec.ui.mode must be one of: ${VALID_MODES.join(", ")}`);
  }

  if (ui.title !== undefined && typeof ui.title !== "string") {
    throw new Error("spec.ui.title must be a string");
  }
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

  requireField(config, "info");
  requireField(config, "info.title");
  requireField(config, "info.version");
  requireField(config, "spec");
  requireField(config, "spec.paths");
  requireField(config, "spec.paths.events");
  requireField(config, "spec.paths.events.root");
  requireField(config, "spec.paths.events.template");
  requireField(config, "spec.events");
  requireField(config, "spec.events.taxonomy");
  requireField(config, "spec.events.payload");
  requireField(config, "spec.events.payload.targets");
  requireField(config, "spec.events.payload.targets.all");
  requireField(config, "spec.events.payload.schema");

  // Optional sections
  validateExport(config);
  validateUi(config);

  return config;
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
