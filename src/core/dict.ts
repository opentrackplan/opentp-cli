import * as path from "node:path";
import type { Dict } from "../types";
import {
  filterByExtension,
  formatLoadError,
  isYamlMapping,
  loadYaml,
  scanDirectory,
} from "../util";
import { fileVersionMessage } from "./config";
import { walkDocument } from "./document";

export interface DictionaryIssue {
  file: string;
  path: string;
  message: string;
}

export interface LoadDictionariesResult {
  dictionaries: Map<string, (string | number | boolean)[]>;
  issues: DictionaryIssue[];
}

export interface LoadDictionariesOptions {
  /** Absolute paths that are never read as dictionaries (the plan root's tool files) */
  skipFiles?: ReadonlySet<string>;
  /**
   * Application repository mode: the plan is pinned by `plan:`, so a file on the previous version
   * asks for another plan ref instead of `opentp migrate`
   */
  pinnedPlan?: boolean;
}

/**
 * Loads all dictionaries from a directory
 * Returns Map<dictPath, values>
 * Example: 'Taxonomy/Actions' -> ['Click', 'Open', ...]
 *
 * `.yaml` and `.yml` are equivalent: a dictionary path resolves to either file, and both existing
 * is an issue (the `.yaml` file is used).
 */
export function loadDictionaries(
  dictsPath: string,
  expectedOpentpVersion?: string,
  options: LoadDictionariesOptions = {},
): LoadDictionariesResult {
  const dictionaries = new Map<string, (string | number | boolean)[]>();
  const issues: DictionaryIssue[] = [];
  const skipFiles = options.skipFiles ?? new Set<string>();

  const allFiles = scanDirectory(dictsPath);
  // Sorted, so that `<name>.yaml` is read before `<name>.yml` and the result does not depend on
  // the readdir order
  const yamlFiles = [...filterByExtension(allFiles, [".yaml", ".yml"])]
    .filter(([, absolutePath]) => !skipFiles.has(path.resolve(absolutePath)))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const filesByKey = new Map<string, string>();

  for (const [relativePath, absolutePath] of yamlFiles) {
    // Dictionary key is the path without extension
    // Example: 'Taxonomy/Actions.yaml' -> 'Taxonomy/Actions'
    const dictKey = relativePath.replace(/\.ya?ml$/i, "");
    const previous = filesByKey.get(dictKey);
    if (previous !== undefined) {
      issues.push({
        file: relativePath,
        path: "",
        message: `Both ${previous} and ${relativePath} exist; keep one (${previous} is used)`,
      });
      continue;
    }
    filesByKey.set(dictKey, relativePath);

    let document: unknown;
    try {
      document = loadYaml<unknown>(absolutePath);
    } catch (error) {
      // Unreadable file or YAML syntax error: the dictionary is not loaded
      issues.push({ file: relativePath, path: "", message: formatLoadError(error) });
      continue;
    }

    if (!isYamlMapping(document)) {
      issues.push({
        file: relativePath,
        path: "",
        message: "Expected a mapping with 'opentp' and 'dict'",
      });
      continue;
    }

    // Removed keywords (x-opentp): reported, the dictionary still loads
    for (const issue of walkDocument(document).issues) {
      issues.push({ file: relativePath, ...issue });
    }

    const dict = document as unknown as Dict;

    if (typeof dict.opentp !== "string" || dict.opentp.length === 0) {
      issues.push({
        file: relativePath,
        path: "opentp",
        message: "Missing required field: opentp",
      });
    } else if (expectedOpentpVersion && dict.opentp !== expectedOpentpVersion) {
      issues.push({
        file: relativePath,
        path: "opentp",
        message: fileVersionMessage(dict.opentp, expectedOpentpVersion, options.pinnedPlan),
      });
    }

    if (!dict.dict?.values) {
      issues.push({
        file: relativePath,
        path: "dict.values",
        message: "Missing required field: dict.values",
      });
      continue;
    }

    if (!Array.isArray(dict.dict.values)) {
      issues.push({
        file: relativePath,
        path: "dict.values",
        message: "dict.values must be an array",
      });
      continue;
    }

    // uniqueItems (schema): report duplicates as errors
    const seen = new Map<string, number>();
    const duplicates: Array<string | number | boolean> = [];
    for (const value of dict.dict.values) {
      const key = JSON.stringify(value);
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      if (count === 2) {
        duplicates.push(value);
      }
    }
    if (duplicates.length > 0) {
      issues.push({
        file: relativePath,
        path: "dict.values",
        message: `Duplicate values are not allowed: ${duplicates.map((v) => JSON.stringify(v)).join(", ")}`,
      });
    }

    dictionaries.set(dictKey, dict.dict.values);
  }

  return { dictionaries, issues };
}

/**
 * Gets dictionary values by path
 * @param dictPath - Path to dictionary (e.g., 'Taxonomy/Actions')
 * @param dictionaries - Loaded dictionaries map
 * @returns Array of values or null if not found
 */
export function getDictValues(
  dictPath: string,
  dictionaries: Map<string, (string | number | boolean)[]>,
): (string | number | boolean)[] | null {
  return dictionaries.get(dictPath) ?? null;
}
