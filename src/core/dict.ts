import type { Dict } from "../types";
import { filterByExtension, loadYaml, scanDirectory } from "../util";

/**
 * Loads all dictionaries from a directory
 * Returns Map<dictPath, values>
 * Example: 'Taxonomy/Actions' -> ['Click', 'Open', ...]
 */
export function loadDictionaries(dictsPath: string): Map<string, (string | number | boolean)[]> {
  const result = new Map<string, (string | number | boolean)[]>();

  const allFiles = scanDirectory(dictsPath);
  const yamlFiles = filterByExtension(allFiles, [".yaml", ".yml"]);

  for (const [relativePath, absolutePath] of yamlFiles) {
    try {
      const dict = loadYaml<Dict>(absolutePath);

      if (!dict.dict?.values) {
        console.warn(`Invalid dictionary format: ${relativePath}`);
        continue;
      }

      // Dictionary key is the path without extension
      // Example: 'Taxonomy/Actions.yaml' -> 'Taxonomy/Actions'
      const dictKey = relativePath.replace(/\.ya?ml$/i, "");
      result.set(dictKey, dict.dict.values);
    } catch (error) {
      console.warn(`Failed to load dictionary ${relativePath}:`, error);
    }
  }

  return result;
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
