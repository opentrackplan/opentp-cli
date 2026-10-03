/**
 * Checks of `generate.run` entries in opentp.cli.yaml. `opentp generate` checks every entry before
 * it runs any (so that a bad entry never leaves half of the outputs refreshed); the MCP tool
 * `generate` checks the entry it runs. Problems are `generate.run[<i>].<key>: <message>` (printed
 * with the prefix `opentp.cli.yaml: `).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getEventFilterProblems } from "../core/select";
import { getGenerator, getGeneratorNames } from "../generators";
import type { OpenTPConfig } from "../types";
import { containedPathProblem } from "./paths";
import type { CliRunEntry } from "./schema";

export interface RunEntryCheckOptions {
  /** Check `output` (opentp generate writes it; the MCP tool never writes, so it skips this) */
  output?: boolean;
  /** Check that the generator exists (the MCP tool reports unknown generators itself) */
  generator?: boolean;
}

/**
 * The problems of one entry: an unknown generator; an `output` or `file` outside the directory of
 * opentp.cli.yaml (`dir`); a template entry without `file`; a `file` that does not exist; a target
 * or taxonomy field that the plan does not have.
 */
export function getRunEntryProblems(
  entry: CliRunEntry,
  index: number,
  dir: string,
  config: OpenTPConfig,
  options: RunEntryCheckOptions = {},
): string[] {
  const at = (key: string) => `generate.run[${index}].${key}`;
  const problems: string[] = [];
  if (options.generator !== false && !getGenerator(entry.generator)) {
    problems.push(
      `${at("generator")}: unknown generator '${entry.generator}' (available: ${getGeneratorNames().join(", ")})`,
    );
  }
  if (options.output !== false) {
    const outside = containedPathProblem(dir, entry.output);
    if (outside !== null) problems.push(`${at("output")}: ${outside}`);
  }
  if (entry.file !== undefined) {
    const outside = containedPathProblem(dir, entry.file);
    if (outside !== null) {
      problems.push(`${at("file")}: ${outside}`);
    } else {
      const file = path.resolve(dir, entry.file);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        problems.push(`${at("file")}: file not found: ${file}`);
      }
    }
  } else if (entry.generator === "template") {
    problems.push(`${at("file")}: the template generator needs a template file`);
  }
  for (const problem of getEventFilterProblems(entry, config)) {
    problems.push(`generate.run[${index}].${problem}`);
  }
  return problems;
}
