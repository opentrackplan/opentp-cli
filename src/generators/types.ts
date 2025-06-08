import type { OpenTPConfig, ResolvedEvent } from "../types";

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
