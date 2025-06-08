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
 * JSON generator
 *
 * Exports all events and dictionaries as JSON.
 *
 * Options:
 *   --output <path>  Output file path (default: stdout)
 *   --pretty         Pretty print with indentation (default: true)
 */
export const jsonGenerator: GeneratorDefinition = {
  name: "json",
  description: "Export events and dictionaries as JSON",

  generate(context: GeneratorContext): GeneratorResult {
    const data = buildExportData(context);
    const pretty = context.options.pretty !== false;
    const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);

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
