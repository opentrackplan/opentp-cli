import type { CliConfig } from "../cliconfig/schema";
import type { TrackerBinding } from "../cliconfig/tracker";
import type { OpenTPConfig, ResolvedEvent } from "../types";
import type { EffectivePayload } from "./effective";

export type {
  EffectivePayload,
  EffectiveTargetPayload,
  EffectiveVersion,
} from "./effective";

/**
 * Context passed to generators
 */
export interface GeneratorContext {
  /** Loaded config from opentp.yaml */
  config: OpenTPConfig;
  /** All resolved events */
  events: ResolvedEvent[];
  /** Loaded dictionaries */
  dictionaries: Map<string, (string | number | boolean)[]>;
  /** Generator-specific options from CLI */
  options: GeneratorOptions;
  /**
   * The tracker binding of opentp.cli.yaml resolved per target id: for every catalog and common
   * field, its path in the tracker payload and who sets it (`setBy`). null or absent without a
   * `tracker` section.
   */
  tracker?: TrackerBinding | null;
  /**
   * The opentp.cli.yaml settings in effect, read-only (in an application repository: merged with
   * the plan repository's tracker and checks settings). null or absent without the file.
   */
  cliConfig?: Readonly<CliConfig> | null;
  /**
   * The 2026-09 effective payload of an event: per covered target and payload version, the common
   * fields of the target plus the fields the version lists, merged over the catalog and the common
   * fields like validation does it. `event.payload` stays the raw payload as written.
   */
  effective(event: ResolvedEvent): EffectivePayload;
}

/**
 * Options passed to generators from CLI
 */
export interface GeneratorOptions {
  /** Output file or directory path */
  output?: string;
  /** Any additional generator-specific options */
  [key: string]: unknown;
}

/**
 * File to be written by generator
 */
export interface GeneratedFile {
  /** Relative path for the file */
  path: string;
  /** File content */
  content: string;
}

/**
 * Result returned by generator
 */
export interface GeneratorResult {
  /** Files to write (for multi-file output) */
  files?: GeneratedFile[];
  /** Content to output to stdout (for single output) */
  stdout?: string;
}

/**
 * Generator definition
 */
export interface GeneratorDefinition {
  /** Unique generator name */
  name: string;
  /** Generator description */
  description?: string;
  /** Generate output from context */
  generate(context: GeneratorContext): GeneratorResult | Promise<GeneratorResult>;
}
