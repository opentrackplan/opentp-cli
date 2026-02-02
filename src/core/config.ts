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
