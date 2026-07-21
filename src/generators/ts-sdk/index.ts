import { mapEvents } from "../sdk-common/mapper";
import type { GeneratorContext, GeneratorDefinition, GeneratorResult } from "../types";
import { buildTypescript } from "./builder";

export const tsSdkGenerator: GeneratorDefinition = {
  name: "ts-sdk",
  description: "Generate TypeScript SDK with typed event definitions",

  generate(context: GeneratorContext): GeneratorResult {
    const { config, events, dictionaries, options } = context;

    const targetName = (options.target as string) ?? config.spec.events.payload.targets.all?.[0];

    if (!targetName) {
      throw new Error(
        "ts-sdk generator requires a target. Use --target <name> or define targets.all in config.",
      );
    }

    const mapped = mapEvents(events, config, dictionaries, targetName);

    const content = buildTypescript(mapped, {
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
