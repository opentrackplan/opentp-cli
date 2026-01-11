import { stringify } from "yaml";
import type { GeneratorContext, GeneratorDefinition, GeneratorResult } from "../types";

/**
 * Build export object from context
 */
function buildExportData(context: GeneratorContext) {
  const { config, events, dictionaries } = context;

  return {
    opentp: config.opentp,
    info: config.info,
    events: events.map((e) => ({
      key: e.key,
      taxonomy: e.taxonomy,
      lifecycle: e.lifecycle,
      payload: e.payload,
    })),
    dictionaries: Object.fromEntries(dictionaries),
  };
}

/**
 * YAML generator
 *
 * Exports all events and dictionaries as YAML.
 *
 * Options:
 *   --output <path>  Output file path (default: stdout)
 */
export const yamlGenerator: GeneratorDefinition = {
  name: "yaml",
  description: "Export events and dictionaries as YAML",

  generate(context: GeneratorContext): GeneratorResult {
    const data = buildExportData(context);
    const content = stringify(data);

    if (context.options.output) {
      return {
        files: [
          {
            path: context.options.output as string,
            content,
          },
        ],
      };
    }

    return { stdout: content };
  },
};
