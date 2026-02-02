import { createTransforms } from "../transforms";
import type { EventFile, OpenTPConfig, ResolvedEvent, TaxonomyField } from "../types";
import {
  applyPattern,
  extractTemplateVariables,
  filterByExtension,
  loadYaml,
  parsePattern,
  patternToRegex,
  scanDirectory,
} from "../util";

/**
 * Loads all events from a directory
 */
export function loadEvents(
  eventsPath: string,
  fileTemplate: string,
  config: OpenTPConfig,
): ResolvedEvent[] {
  const result: ResolvedEvent[] = [];

  const allFiles = scanDirectory(eventsPath);
  const yamlFiles = filterByExtension(allFiles, [".yaml", ".yml"]);

  const keygen = config.spec.events["x-opentp"]?.keygen;
  const keygenTransforms = createTransforms(keygen?.transforms ?? {});

  for (const [relativePath, absolutePath] of yamlFiles) {
    try {
      // Extract variables from file path
      const pathVariables = extractTemplateVariables(relativePath, fileTemplate);
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
      const expectedKey =
        keygen && typeof keygen.template === "string"
          ? generateEventKey(taxonomy, keygen.template, keygenTransforms)
          : null;

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
  const parts = parsePattern(template);
  for (const part of parts) {
    if (part.type === "variable" && part.transforms && part.transforms.length > 0) {
      throw new Error(`Transforms are not allowed in composite templates: ${template}`);
    }
  }

  const regex = patternToRegex(template);
  const match = value.match(regex);
  if (!match?.groups) return {};

  const out: Record<string, string | number | boolean> = {};
  for (const [fragName, fragValue] of Object.entries(match.groups)) {
    const fragConfig = fragments[fragName];
    if (!fragConfig) continue;
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
