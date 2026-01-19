import type { Dict } from "../types";
import { filterByExtension, loadYaml, scanDirectory } from "../util";

export interface DictionaryIssue {
  file: string;
  path: string;
  message: string;
}

export interface LoadDictionariesResult {
  dictionaries: Map<string, (string | number | boolean)[]>;
  issues: DictionaryIssue[];
}

/**
 * Loads all dictionaries from a directory
 * Returns Map<dictPath, values>
 * Example: 'Taxonomy/Actions' -> ['Click', 'Open', ...]
 */
export function loadDictionaries(
  dictsPath: string,
  expectedOpentpVersion?: string,
): LoadDictionariesResult {
  const dictionaries = new Map<string, (string | number | boolean)[]>();
  const issues: DictionaryIssue[] = [];

  const allFiles = scanDirectory(dictsPath);
  const yamlFiles = filterByExtension(allFiles, [".yaml", ".yml"]);

  for (const [relativePath, absolutePath] of yamlFiles) {
    try {
      const dict = loadYaml<Dict>(absolutePath);

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
          message: `Unsupported OpenTrackPlan schema version '${dict.opentp}'. Expected '${expectedOpentpVersion}'.`,
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

      // Dictionary key is the path without extension
      // Example: 'Taxonomy/Actions.yaml' -> 'Taxonomy/Actions'
      const dictKey = relativePath.replace(/\.ya?ml$/i, "");
      dictionaries.set(dictKey, dict.dict.values);
    } catch (error) {
      console.warn(`Failed to load dictionary ${relativePath}:`, error);
    }
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
