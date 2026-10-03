/**
 * opentp.cli.yaml: the reference CLI's own settings next to opentp.yaml (D5 boundary: tool settings
 * may only add strictness or produce artifacts; the plan stays meaningful without them).
 *
 * Discovery: `--cli-config <path>` (relative to the current directory), else
 * `<root>/opentp.cli.yaml` or `<root>/opentp.cli.yml` (both: an error). The file is optional. No home
 * or parent directory lookup. Paths inside the file resolve against the file's directory.
 *
 * A file with `plan:` belongs to an application repository: it has no opentp.yaml of its own and
 * names the plan it uses (./application.ts).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { satisfies, validRange } from "semver";
import type * as z from "zod/v4";
import {
  type CheckBinding,
  CheckEnvironment,
  DEFAULT_SEVERITIES,
  type Severities,
  type ToolRuleId,
} from "../checks";
import { findConfigFile } from "../core/config";
import { MERGE_KEY_MESSAGE, mergeKeyPaths } from "../core/document";
import { VERSION } from "../meta";
import type { OpenTPConfig } from "../types";
import { formatLoadError, isYamlMapping, loadYaml } from "../util";
import type { ApplicationMode } from "./application";
import {
  type CliConfig,
  cliConfigSchema,
  MCP_TOOL_GROUPS,
  type McpToolGroup,
  webhookSchema,
} from "./schema";

export type { CliConfig, CliKeygen, CliRunEntry, McpToolGroup } from "./schema";
export { MCP_TOOL_GROUPS } from "./schema";

export const CLI_CONFIG_FILENAMES = ["opentp.cli.yaml", "opentp.cli.yml"] as const;

/** Label of problems in opentp.cli.yaml (whatever the file is called, like "opentp.yaml") */
export const CLI_CONFIG_LABEL = "opentp.cli.yaml";

/** Environment variable that allows the plugins named in opentp.cli.yaml (like --allow-plugins) */
export const ALLOW_PLUGINS_ENV = "OPENTP_ALLOW_PLUGINS";

/**
 * A problem with opentp.cli.yaml that stops every command before anything runs (exit 2). `lines`
 * are printed one per line.
 */
export class CliConfigError extends Error {
  constructor(readonly lines: string[]) {
    super(lines.join("\n"));
  }
}

export interface LoadedCliConfig {
  /** Absolute path of the file */
  path: string;
  /** Absolute directory of the file: relative paths in it resolve against this */
  dir: string;
  /**
   * The settings in effect. In application repository mode: the application file with the plan
   * repository's `tracker` and `checks.bindings`/`checks.severity` merged in, and without `keygen`
   */
  config: CliConfig;
  /** Set in application repository mode (`plan:`): where the plan is */
  application?: ApplicationMode;
}

/**
 * Finds opentp.cli.yaml: the explicit path (relative to `cwd`) or the file in the plan root.
 * @returns null when there is none (the file is optional)
 * @throws CliConfigError when the explicit file is missing or both .yaml and .yml exist
 */
export function findCliConfigFile(
  root: string,
  explicitPath?: string,
  cwd: string = process.cwd(),
): string | null {
  if (explicitPath !== undefined) {
    const resolved = path.resolve(cwd, explicitPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new CliConfigError([`--cli-config: file not found: ${resolved}`]);
    }
    return resolved;
  }
  const found = CLI_CONFIG_FILENAMES.map((name) => path.join(root, name)).filter((file) =>
    fs.existsSync(file),
  );
  if (found.length > 1) {
    throw new CliConfigError([
      `Both opentp.cli.yaml and opentp.cli.yml exist in ${path.resolve(root)}; keep one`,
    ]);
  }
  return found[0] ? path.resolve(found[0]) : null;
}

/** The files whose changes reload opentp.cli.yaml (for the MCP plan store) */
export function cliConfigCandidates(root: string, explicitPath?: string): string[] {
  if (explicitPath !== undefined) return [path.resolve(explicitPath)];
  return CLI_CONFIG_FILENAMES.map((name) => path.resolve(root, name));
}

function formatIssuePath(issuePath: ReadonlyArray<PropertyKey>): string {
  let out = "";
  for (const segment of issuePath) {
    if (typeof segment === "number") out += `[${segment}]`;
    else out += out === "" ? String(segment) : `.${String(segment)}`;
  }
  return out;
}

type Issue = z.core.$ZodIssue;

/**
 * The shape problems of one webhook configuration as `<path>: <message>` lines (the path inside
 * the configuration), as a webhook binding in opentp.cli.yaml would report them
 */
export function webhookShapeProblems(config: unknown): string[] {
  const result = webhookSchema.safeParse(config);
  if (result.success) return [];
  return result.error.issues.map(
    (issue) => `${formatIssuePath(issue.path) || "(root)"}: ${issue.message}`,
  );
}

/**
 * Turns zod issues into lines. A union (a check binding) reports the issues of the one branch the
 * input was clearly meant for, else its own message.
 */
function issueLines(
  issues: readonly Issue[],
  label: string,
  prefix: ReadonlyArray<PropertyKey> = [],
): string[] {
  const lines: string[] = [];
  for (const issue of issues) {
    const issuePath = [...prefix, ...issue.path];
    // A record key that is not allowed: report why (the issue itself only says "Invalid key")
    if (issue.code === "invalid_key" && issue.issues.length > 0) {
      const where = formatIssuePath(issuePath);
      for (const inner of issue.issues) lines.push(`${label}: ${where}: ${inner.message}`);
      continue;
    }
    if (issue.code === "invalid_union" && issue.errors.length > 0) {
      const candidates = issue.errors.filter(
        (branch) =>
          !branch.some((inner) => inner.code === "unrecognized_keys" && inner.path.length === 0),
      );
      if (candidates.length === 1) {
        lines.push(...issueLines(candidates[0], label, issuePath));
        continue;
      }
    }
    const where = formatIssuePath(issuePath);
    lines.push(`${label}: ${where === "" ? "(root)" : where}: ${issue.message}`);
  }
  return lines;
}

/**
 * Reads and shape-checks a file. `label` starts every problem line (default "opentp.cli.yaml").
 * @throws CliConfigError for a file that cannot be read or parsed, or that has the wrong shape
 */
export function readCliConfig(filePath: string, label: string = CLI_CONFIG_LABEL): CliConfig {
  let document: unknown;
  try {
    document = loadYaml<unknown>(filePath);
  } catch (error) {
    throw new CliConfigError([`${label}: ${formatLoadError(error)}`]);
  }
  if (!isYamlMapping(document)) {
    throw new CliConfigError([`${label}: expected a mapping with 'opentp'`]);
  }
  const mergeKeys = mergeKeyPaths(document);
  if (mergeKeys.length > 0) {
    throw new CliConfigError(mergeKeys.map((path) => `${label}: ${path}: ${MERGE_KEY_MESSAGE}`));
  }
  const result = cliConfigSchema.safeParse(document);
  if (!result.success) {
    throw new CliConfigError(issueLines(result.error.issues, label));
  }
  return result.data;
}

/**
 * Whether a file declares `plan:` (application repository mode). Read without the shape check.
 * @throws CliConfigError for a file that cannot be read or parsed, or that is not a mapping
 */
export function declaresPlan(filePath: string, label: string = CLI_CONFIG_LABEL): boolean {
  let document: unknown;
  try {
    document = loadYaml<unknown>(filePath);
  } catch (error) {
    throw new CliConfigError([`${label}: ${formatLoadError(error)}`]);
  }
  if (!isYamlMapping(document)) {
    throw new CliConfigError([`${label}: expected a mapping with 'opentp'`]);
  }
  return Object.hasOwn(document, "plan");
}

/**
 * The application repository file for `root`: opentp.cli.yaml (or --cli-config) when it declares
 * `plan:`, else null.
 *
 * Without an opentp.yaml in `root` the file can only be an application file, so a problem with
 * finding or reading it (both .yaml and .yml, a missing --cli-config file, a YAML error, not a
 * mapping) is thrown here: it is the real problem, not the missing opentp.yaml. Next to an
 * opentp.yaml such problems are reported later, when the file is loaded as the plan repository's
 * file (after the plan's version check).
 * @throws CliConfigError (only when `root` has no opentp.yaml)
 */
export function findApplicationFile(
  root: string,
  explicitPath?: string,
  cwd: string = process.cwd(),
): string | null {
  const hasPlan = findConfigFile(root) !== null;
  try {
    const filePath = findCliConfigFile(root, explicitPath, cwd);
    return filePath !== null && declaresPlan(filePath) ? filePath : null;
  } catch (error) {
    if (hasPlan && error instanceof CliConfigError) return null;
    throw error;
  }
}

/** The message for an opentp.yaml in the project root of an application repository */
export function planWithConfigMessage(): string {
  return `${CLI_CONFIG_LABEL}: plan: an application repository has no opentp.yaml of its own, but the project root has one (remove plan: in a plan repository, or opentp.yaml in an application repository)`;
}

export interface CliConfigCheckOptions {
  /** The plan's opentp; the header comparison is skipped when the plan is not loaded */
  planVersion?: string;
  /** The running CLI version (default: this CLI) */
  version?: string;
  /** The file is an application repository file (`plan:` is expected) */
  application?: boolean;
}

/** The problem of a `cli` range that is invalid or that the running CLI does not satisfy */
export function cliRangeProblem(
  range: string | undefined,
  version: string,
  label: string = CLI_CONFIG_LABEL,
): string | null {
  if (range === undefined) return null;
  if (validRange(range) === null) return `${label}: cli: '${range}' is not a valid version range`;
  if (satisfies(version, range, { includePrerelease: true })) return null;
  return `${label}: cli: this plan needs opentp ${range}, but this is opentp ${version} (install a matching version, e.g. with OPENTP_VERSION)`;
}

/**
 * Checks what does not depend on plugins: `opentp` equals the plan's, the running CLI satisfies
 * `cli`, and `plan:` only in an application repository file (`mcp.write: true` is a shape error).
 * @throws CliConfigError
 */
export function checkCliConfig(config: CliConfig, options: CliConfigCheckOptions = {}): void {
  const version = options.version ?? VERSION;
  const lines: string[] = [];
  if (options.planVersion !== undefined && config.opentp !== options.planVersion) {
    lines.push(
      `${CLI_CONFIG_LABEL}: opentp: '${config.opentp}' does not match the plan's opentp '${options.planVersion}' (opentp.yaml)`,
    );
  }
  const range = cliRangeProblem(config.cli, version);
  if (range !== null) lines.push(range);
  // A plan repository's file (next to opentp.yaml) must not name another plan
  if (config.plan !== undefined && !options.application) {
    lines.push(planWithConfigMessage());
  }
  if (lines.length > 0) throw new CliConfigError(lines);
}

export interface LoadCliConfigOptions extends CliConfigCheckOptions {
  /** --cli-config (relative to cwd) */
  explicitPath?: string;
  cwd?: string;
}

/**
 * Finds, reads and checks opentp.cli.yaml for the plan in `root`.
 * @returns null when there is no file
 * @throws CliConfigError
 */
export function loadCliConfig(
  root: string,
  options: LoadCliConfigOptions = {},
): LoadedCliConfig | null {
  const filePath = findCliConfigFile(root, options.explicitPath, options.cwd);
  if (filePath === null) return null;
  const config = readCliConfig(filePath);
  checkCliConfig(config, options);
  return { path: filePath, dir: path.dirname(filePath), config };
}

/** A path from opentp.cli.yaml, resolved against the file's directory */
export function resolveCliPath(cli: LoadedCliConfig, value: string): string {
  return path.resolve(cli.dir, value);
}

/**
 * Severity of each tool rule: `--fail-on` (error) > `checks.severity` > defaults (warning)
 */
export function getSeverities(
  cli: LoadedCliConfig | null | undefined,
  failOn: readonly ToolRuleId[] = [],
): Severities {
  const severities: Severities = { ...DEFAULT_SEVERITIES };
  for (const [rule, severity] of Object.entries(cli?.config.checks?.severity ?? {})) {
    if (severity !== undefined) severities[rule as ToolRuleId] = severity;
  }
  for (const rule of failOn) severities[rule] = "error";
  return severities;
}

/**
 * The check environment of a plan: `spec.checks` of opentp.yaml plus the bindings (in an
 * application repository, the ids of the plan repository's webhook bindings, which do not run)
 */
export function buildCheckEnvironment(
  config: OpenTPConfig,
  cli: LoadedCliConfig | null | undefined,
): CheckEnvironment {
  return new CheckEnvironment({
    specChecks: config.spec.checks,
    bindings: (cli?.config.checks?.bindings ?? {}) as Record<string, CheckBinding>,
    planWebhooks: cli?.application?.planWebhooks,
  });
}

export type PluginSection = "keygen" | "checks" | "generate";

/** Plugin directories named in opentp.cli.yaml, as written and resolved, for some sections */
export function cliPluginDirectories(
  cli: LoadedCliConfig | null | undefined,
  sections: readonly PluginSection[],
): Array<{ section: PluginSection; written: string; resolved: string }> {
  if (!cli) return [];
  const out: Array<{ section: PluginSection; written: string; resolved: string }> = [];
  for (const section of sections) {
    for (const dir of cli.config[section]?.plugins ?? []) {
      out.push({ section, written: dir, resolved: resolveCliPath(cli, dir) });
    }
  }
  return out;
}

/** Whether the plugins named in opentp.cli.yaml may load: --allow-plugins or OPENTP_ALLOW_PLUGINS=1 */
export function pluginsAllowed(flag: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  return flag || env[ALLOW_PLUGINS_ENV] === "1";
}

export function pluginsNotLoadedWarning(dirs: readonly string[]): string {
  return `opentp.cli.yaml names plugins (${dirs.join(", ")}); they were not loaded: pass --allow-plugins or set ${ALLOW_PLUGINS_ENV}=1`;
}

/** The MCP tool groups to serve (default: all) */
export function mcpToolGroups(cli: LoadedCliConfig | null | undefined): Set<McpToolGroup> {
  return new Set(cli?.config.mcp?.tools ?? MCP_TOOL_GROUPS);
}
