import { createTransforms } from "../transforms";
import type { EventFile, OpenTPConfig, ResolvedEvent, TaxonomyField } from "../types";
import {
  applyPattern,
  extractVariables,
  filterByExtension,
  getPatternVariables,
  loadYaml,
  scanDirectory,
} from "../util";

/**
 * Loads all events from a directory
 */
export function loadEvents(
  eventsPath: string,
  filePattern: string,
  config: OpenTPConfig,
): ResolvedEvent[] {
  const result: ResolvedEvent[] = [];

  const allFiles = scanDirectory(eventsPath);
  const yamlFiles = filterByExtension(allFiles, [".yaml", ".yml"]);

  // Create transforms from config (built-in steps + optional external steps)
  const transforms = createTransforms(config.spec.transforms ?? {});

  for (const [relativePath, absolutePath] of yamlFiles) {
    try {
      // Extract variables from file path
      const pathVariables = extractVariables(relativePath, filePattern);
      if (!pathVariables) {
        // File doesn't match pattern - skip
        continue;
      }

      // Load file contents
      const eventFile = loadYaml<EventFile>(absolutePath);
      if (!eventFile.event) {
        console.warn(`Invalid event file (missing 'event'): ${relativePath}`);
        continue;
      }

      // Extract taxonomy from path and file
      const taxonomy = extractTaxonomy(pathVariables, eventFile, config);

      // Generate expected key
      const expectedKey = generateEventKey(taxonomy, config, transforms);

      const resolved: ResolvedEvent = {
        filePath: absolutePath,
        relativePath,
        opentp: eventFile.opentp,
        key: eventFile.event.key,
        expectedKey,
        taxonomy,
        lifecycle: eventFile.event.lifecycle,
        aliases: eventFile.event.aliases,
        ignore: eventFile.event.ignore ?? [],
        payload: eventFile.event.payload,
      };

      result.push(resolved);
    } catch (error) {
      console.warn(`Failed to load event ${relativePath}:`, error);
    }
  }

  return result;
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
    // Field can come from path
    if (pathVariables[fieldName] !== undefined) {
      taxonomy[fieldName] = parseTypedValue(pathVariables[fieldName], fieldConfig.type);

      // If field is composite with pattern, parse into fragments
      if (fieldConfig.pattern && fieldConfig.fragments && typeof taxonomy[fieldName] === "string") {
        const fragments = extractFragments(
          taxonomy[fieldName] as string,
          fieldConfig.pattern,
          fieldConfig.fragments,
        );
        Object.assign(taxonomy, fragments);
      }
    }
    // Or from event file (e.g. trigger, team)
    else if (eventFile.event.taxonomy[fieldName] !== undefined) {
      taxonomy[fieldName] = eventFile.event.taxonomy[fieldName];

      // If field is composite with pattern, parse into fragments
      if (fieldConfig.pattern && fieldConfig.fragments && typeof taxonomy[fieldName] === "string") {
        const fragments = extractFragments(
          taxonomy[fieldName] as string,
          fieldConfig.pattern,
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
  pattern: string,
  _fragments: Record<string, TaxonomyField>,
): Record<string, string> {
  const result: Record<string, string> = {};

  // Simple parsing: split by separators from pattern
  // Pattern: '{action} - {object} - {objectDescription}'
  const variableNames = getPatternVariables(pattern);

  // Extract separators from pattern
  // Between {action} and {object} is ' - '
  const separatorMatch = pattern.match(/\}\s*([^{]+)\s*\{/);
  const separator = separatorMatch ? separatorMatch[1].trim() : " - ";

  const parts = value.split(separator).map((p) => p.trim());

  for (let i = 0; i < variableNames.length && i < parts.length; i++) {
    result[variableNames[i]] = parts[i];
  }

  return result;
}

/**
 * Generates event key from pattern and transforms
 */
function generateEventKey(
  taxonomy: Record<string, unknown>,
  config: OpenTPConfig,
  transforms: Record<string, (value: string) => string>,
): string {
  const keyPattern = config.spec.events.key.pattern;
  const variables: Record<string, string> = {};
  for (const [key, value] of Object.entries(taxonomy)) {
    if (value === undefined || value === null) continue;
    variables[key] = String(value);
  }
  return applyPattern(keyPattern, variables, transforms);
}

function parseTypedValue(raw: string, type: TaxonomyField["type"]): string | number | boolean {
  if (type === "string") return raw;

  if (type === "number") {
    const num = Number(raw);
    return Number.isFinite(num) ? num : raw;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return raw;
}
