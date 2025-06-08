import * as path from "node:path";
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
  if (!config.opentp) {
    throw new Error("Missing required field: opentp");
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

  if (!config.spec.events) {
    throw new Error("Missing required field: spec.events");
  }

  if (!config.spec.events.key?.pattern) {
    throw new Error("Missing required field: spec.events.key.pattern");
  }

  if (!config.spec.events.paths) {
    throw new Error("Missing required field: spec.events.paths");
  }

  if (!config.spec.events.taxonomy) {
    throw new Error("Missing required field: spec.events.taxonomy");
  }

  if (!config.spec.events.payload) {
    throw new Error("Missing required field: spec.events.payload");
  }

  if (!config.spec.events.payload.platforms) {
    throw new Error("Missing required field: spec.events.payload.platforms");
  }

  if (!config.spec.events.payload.platforms.all) {
    throw new Error("Missing required field: spec.events.payload.platforms.all");
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
  // Look for 'events' path in paths
  const eventsConfig = config.spec.events.paths.events;
  if (eventsConfig) {
    return resolvePath(rootPath, eventsConfig.root);
  }

  // Fallback to first found path
  const firstPath = Object.values(config.spec.events.paths)[0];
  if (firstPath) {
    return resolvePath(rootPath, firstPath.root);
  }

  return null;
}

/**
 * Gets dictionaries directory path from config
 */
export function getDictsPath(config: OpenTPConfig, rootPath: string): string | null {
  const dictsConfig = config.spec.events.paths.dictionaries;
  if (dictsConfig) {
    return resolvePath(rootPath, dictsConfig.root);
  }
  return null;
}

/**
 * Gets pattern for event files
 */
export function getEventsPattern(config: OpenTPConfig): string | null {
  const eventsConfig = config.spec.events.paths.events;
  if (eventsConfig) {
    return eventsConfig.pattern;
  }

  const firstPath = Object.values(config.spec.events.paths)[0];
  return firstPath?.pattern ?? null;
}
