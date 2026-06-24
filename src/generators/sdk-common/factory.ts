import type { GeneratorContext, GeneratorDefinition, GeneratorResult } from "../types";
import { mapEvents } from "./mapper";
import type { SdkBuilder } from "./types";

/**
 * Factory that eliminates boilerplate for SDK generators.
 * Each new language generator becomes ~10 lines of glue code.
 */
export function createSdkGenerator(
  name: string,
  description: string,
  builder: SdkBuilder,
): GeneratorDefinition {
  return {
    name,
    description,

    generate(context: GeneratorContext): GeneratorResult {
      const { config, events, dictionaries, options } = context;

      const targetName = (options.target as string) ?? config.spec.events.payload.targets.all?.[0];

      if (!targetName) {
        throw new Error(
          `${name} generator requires a target. Use --target <name> or define targets.all in config.`,
        );
      }

      const mapped = mapEvents(events, config, dictionaries, targetName);

      const content = builder.build(mapped, {
        planTitle: config.info.title,
        planVersion: config.info.version,
        targetName,
        generatedAt: new Date().toISOString(),
        standalone: options.standalone as boolean | undefined,
      });

      if (options.output) {
        return { files: [{ path: options.output as string, content }] };
      }
      return { stdout: content };
    },
  };
}
