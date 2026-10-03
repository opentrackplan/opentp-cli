import { stringify } from "yaml";
import { buildExportData } from "../export";
import type { GeneratorContext, GeneratorDefinition, GeneratorResult } from "../types";

/**
 * YAML generator
 *
 * Exports the catalog, spec.targets, spec.checks, all events (raw payload and effective payload)
 * and dictionaries as YAML.
 *
 * Options:
 *   --output <path>  Output file path (default: stdout)
 */
export const yamlGenerator: GeneratorDefinition = {
  name: "yaml",
  description: "Export events and dictionaries as YAML",

  generate(context: GeneratorContext): GeneratorResult {
    const data = buildExportData(context);
    // Objects that appear twice (a raw field definition inside an effective payload) are written
    // twice instead of as YAML anchors and aliases
    const content = stringify(data, { aliasDuplicateObjects: false });

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
