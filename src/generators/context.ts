/**
 * The context the CLI (`opentp generate`) and the MCP server (`generate`) pass to generators.
 */

import type { CliConfig } from "../cliconfig/schema";
import type { TrackerBinding } from "../cliconfig/tracker";
import type { OpenTPConfig, ResolvedEvent } from "../types";
import { createEffectiveResolver } from "./effective";
import type { GeneratorContext, GeneratorOptions } from "./types";

export interface GeneratorContextInput {
  config: OpenTPConfig;
  events: ResolvedEvent[];
  dictionaries: Map<string, (string | number | boolean)[]>;
  options: GeneratorOptions;
  tracker: TrackerBinding | null;
  /** The opentp.cli.yaml settings in effect (null without the file) */
  cliConfig: CliConfig | null;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * The generator context: `cliConfig` is a frozen copy (generators cannot change the settings of a
 * later run), `effective(event)` the 2026-09 effective payload per target and version
 */
export function generatorContext(input: GeneratorContextInput): GeneratorContext {
  return {
    config: input.config,
    events: input.events,
    dictionaries: input.dictionaries,
    options: input.options,
    tracker: input.tracker,
    cliConfig: input.cliConfig === null ? null : deepFreeze(structuredClone(input.cliConfig)),
    effective: createEffectiveResolver(input.config, input.dictionaries),
  };
}
