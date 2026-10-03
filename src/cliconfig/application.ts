/**
 * Application repository mode: an opentp.cli.yaml with `plan:` belongs to a repository that uses a
 * tracking plan (to generate code, to search it over MCP) but does not hold it. It has no
 * opentp.yaml of its own; `plan:` names the plan (a local path or a pinned git ref, see
 * ./plan-source.ts).
 *
 * Settings: from the plan repository's own opentp.cli.yaml only `tracker` (deep-merged, the
 * application wins), its rule bindings in `checks.bindings` and `checks.severity` (merged by id, the
 * application wins) are taken. `keygen`, `checks.plugins`, `generate`, `mcp` and `plan` come only
 * from the application file, and nothing from the plan repository is executed or written: its
 * plugins never load, and its webhook bindings never run (their URL and headers are another
 * repository's choice, and the application's OPENTP_WEBHOOK_ENV would expand its secrets in them;
 * the check ids count as unknown checks, listed in one warning). Key checks do not run here, so
 * `keygen` in an application file is ignored (with one warning). The plan repository's file must
 * have the plan's `opentp`, and the running CLI must satisfy the `cli` range of both files.
 *
 * Loading takes two steps, because the plan's opentp.yaml is checked in between (its version
 * first): openApplication (the application file, the plan's location; a git plan is cloned into the
 * cache here) and completeApplication (the headers, the plan repository's file, the merge).
 */

import * as path from "node:path";
import { findConfigFile } from "../core/config";
import { VERSION } from "../meta";
import {
  CLI_CONFIG_LABEL,
  CliConfigError,
  checkCliConfig,
  cliRangeProblem,
  findCliConfigFile,
  type LoadedCliConfig,
  planWithConfigMessage,
  readCliConfig,
} from "./index";
import {
  type FetchPlanOptions,
  type PlanSource,
  PlanSourceError,
  parsePlanSource,
  planDirectory,
  planLabel,
  redactCredentials,
} from "./plan-source";
import type { CliConfig } from "./schema";
import { mergeTrackerSections, type TrackerOrigin } from "./tracker";

/** Where the plan of an application repository is (LoadedCliConfig.application) */
export interface ApplicationMode {
  /** `plan:` as written in the application file, with credentials hidden (for messages) */
  plan: string;
  source: PlanSource;
  /** Absolute directory of the plan: a local directory or a clone in the cache */
  planRoot: string;
  /** The plan's opentp.yaml (or opentp.yml) */
  configPath: string;
  /** The plan repository's own opentp.cli.yaml, if it has one */
  planCliPath: string | null;
  /** The application file has `keygen`: ignored, because key checks do not run here */
  keygenIgnored: boolean;
  /**
   * Plugin directories that the plan repository's file names (keygen, checks, generate): they
   * never load here, so its rule bindings to plugin rules count as unknown checks
   */
  planPlugins: string[];
  /**
   * Ids of the plan repository's webhook bindings that the application file does not bind itself:
   * they never run here, and the check ids count as unknown checks
   */
  planWebhooks: string[];
  /**
   * Set when the plan repository's file has a tracker section: tracker problems at keys that only it
   * has are labelled `opentp.cli.yaml of the plan '<plan>'`
   */
  trackerOrigin?: TrackerOrigin;
}

/** The first step: the application file read and checked, and the plan located */
export interface OpenedApplication {
  /** Absolute path of the application file */
  path: string;
  /** Its directory: `plan:` and every other path in it resolve against this */
  dir: string;
  /** The application file as written */
  config: CliConfig;
  /** `plan:` as written, with credentials hidden (for messages and logs) */
  plan: string;
  source: PlanSource;
  planRoot: string;
  configPath: string;
}

export interface OpenApplicationOptions extends FetchPlanOptions {
  /** The running CLI version (default: this CLI) */
  version?: string;
}

/** Label of problems in the plan repository's own opentp.cli.yaml */
export function planCliLabel(plan: string): string {
  return `opentp.cli.yaml of the plan '${plan}'`;
}

/** The warning for `keygen` in an application file (printed once per run) */
export function keygenIgnoredWarning(): string {
  return `${CLI_CONFIG_LABEL}: keygen is ignored in an application repository (plan:): event keys are checked and fixed in the plan repository`;
}

/**
 * The warning for plugins and webhook bindings of the plan repository's file (printed once per
 * run; empty when it has neither)
 */
export function planPluginsWarning(application: ApplicationMode): string {
  const named: string[] = [];
  const kinds: string[] = [];
  if (application.planPlugins.length > 0) {
    named.push(`plugins (${application.planPlugins.join(", ")})`);
    kinds.push("plugins");
  }
  if (application.planWebhooks.length > 0) {
    named.push(`webhook bindings (${application.planWebhooks.join(", ")})`);
    kinds.push("webhook bindings");
  }
  if (named.length === 0) return "";
  const bound = application.planWebhooks.length > 0 ? "them" : "their rules";
  return `${planCliLabel(application.plan)} names ${named.join(" and ")}; ${kinds.join(" and ")} of the plan repository never run in an application repository (checks bound to ${bound} count as unknown checks)`;
}

function planSourceLines(error: PlanSourceError): string[] {
  return [
    `${CLI_CONFIG_LABEL}: plan: ${error.message}`,
    ...error.details.map((line) => `  ${line}`),
  ];
}

/**
 * Reads an application repository file and locates its plan: refuses an opentp.yaml in `root`,
 * checks `cli` and `mcp.write`, and resolves `plan:` (cloning a git plan into the cache when it is
 * not there yet).
 * @throws CliConfigError (exit 2)
 */
export function openApplication(
  filePath: string,
  root: string,
  options: OpenApplicationOptions = {},
): OpenedApplication {
  const config = readCliConfig(filePath);
  if (config.plan === undefined) {
    throw new CliConfigError([`${CLI_CONFIG_LABEL}: plan: missing (not an application file)`]);
  }
  const written = config.plan;
  const plan = redactCredentials(written);
  const lines: string[] = [];
  if (findConfigFile(root) !== null) lines.push(planWithConfigMessage());
  try {
    checkCliConfig(config, { version: options.version, application: true });
  } catch (error) {
    if (!(error instanceof CliConfigError)) throw error;
    lines.push(...error.lines);
  }
  if (lines.length > 0) throw new CliConfigError(lines);

  const absolute = path.resolve(filePath);
  const dir = path.dirname(absolute);
  let source: PlanSource;
  let planRoot: string;
  try {
    source = parsePlanSource(written, dir);
    planRoot = planDirectory(source, options);
  } catch (error) {
    if (error instanceof PlanSourceError) throw new CliConfigError(planSourceLines(error));
    throw error;
  }
  const configPath = findConfigFile(planRoot);
  if (configPath === null) {
    const where = source.kind === "git" ? ` (${planLabel(source)})` : "";
    throw new CliConfigError([`${CLI_CONFIG_LABEL}: plan: no opentp.yaml in ${planRoot}${where}`]);
  }
  return { path: absolute, dir, config, plan, source, planRoot, configPath };
}

/** Two maps merged by key; the later one wins (undefined when both are absent) */
function mergeById<T>(
  base: Record<string, T> | undefined,
  app: Record<string, T> | undefined,
): Record<string, T> | undefined {
  if (base === undefined && app === undefined) return undefined;
  // fromEntries defines own properties, so a key such as `__proto__` stays a plain key
  return Object.fromEntries([...Object.entries(base ?? {}), ...Object.entries(app ?? {})]);
}

type Bindings = NonNullable<NonNullable<CliConfig["checks"]>["bindings"]>;

/** The rule bindings of a bindings map (webhook bindings left out) */
function ruleBindings(bindings: Bindings | undefined): Bindings | undefined {
  if (bindings === undefined) return undefined;
  return Object.fromEntries(Object.entries(bindings).filter(([, binding]) => "rule" in binding));
}

/**
 * Ids of the plan repository's webhook bindings that the application does not bind itself: they
 * are not run in an application repository
 */
export function planWebhookIds(app: CliConfig, planCli: CliConfig | null): string[] {
  const appBindings = app.checks?.bindings ?? {};
  return Object.entries(planCli?.checks?.bindings ?? {})
    .filter(([id, binding]) => "webhook" in binding && !Object.hasOwn(appBindings, id))
    .map(([id]) => id);
}

/**
 * The settings in effect in an application repository: the application file, with the plan
 * repository's `tracker` (deep-merged, the application wins), its rule bindings in
 * `checks.bindings` and `checks.severity` (by id, the application wins), and without `keygen`.
 * Webhook bindings of the plan repository are never taken.
 */
export function mergeApplicationConfig(app: CliConfig, planCli: CliConfig | null): CliConfig {
  const { keygen: _keygen, tracker: appTracker, checks: appChecks, ...rest } = app;
  const merged = { ...rest } as CliConfig;
  const tracker = mergeTrackerSections(planCli?.tracker, appTracker);
  if (tracker !== undefined) merged.tracker = tracker;
  const bindings = mergeById(ruleBindings(planCli?.checks?.bindings), appChecks?.bindings);
  const severity = mergeById(planCli?.checks?.severity, appChecks?.severity);
  const checks: NonNullable<CliConfig["checks"]> = {
    ...(appChecks?.plugins !== undefined ? { plugins: appChecks.plugins } : {}),
    ...(bindings !== undefined ? { bindings } : {}),
    ...(severity !== undefined ? { severity } : {}),
  };
  if (Object.keys(checks).length > 0) merged.checks = checks;
  return merged;
}

export interface CompleteApplicationOptions {
  /** The plan's opentp; the header comparisons are skipped when the plan is not loaded */
  planVersion?: string;
  /** The running CLI version (default: this CLI) */
  version?: string;
}

/**
 * The second step, after the plan's opentp.yaml is loaded: the application file's `opentp` must
 * equal the plan's; the plan repository's own opentp.cli.yaml (if any) is read, must have the
 * plan's `opentp`, and the running CLI must satisfy its `cli`; then the settings are merged.
 * @throws CliConfigError (exit 2)
 */
export function completeApplication(
  opened: OpenedApplication,
  options: CompleteApplicationOptions = {},
): LoadedCliConfig {
  const version = options.version ?? VERSION;
  const { planVersion } = options;
  const lines: string[] = [];
  if (planVersion !== undefined && opened.config.opentp !== planVersion) {
    lines.push(
      `${CLI_CONFIG_LABEL}: opentp: '${opened.config.opentp}' does not match the plan's opentp '${planVersion}' (the pinned plan ${opened.plan})`,
    );
  }

  const label = planCliLabel(opened.plan);
  let planCliPath: string | null = null;
  let planCli: CliConfig | null = null;
  try {
    planCliPath = findCliConfigFile(opened.planRoot);
    if (planCliPath !== null) planCli = readCliConfig(planCliPath, label);
  } catch (error) {
    if (!(error instanceof CliConfigError)) throw error;
    lines.push(...error.lines.map((line) => (line.startsWith(label) ? line : `${label}: ${line}`)));
  }
  if (planCli !== null) {
    if (planVersion !== undefined && planCli.opentp !== planVersion) {
      lines.push(
        `${label}: opentp: '${planCli.opentp}' does not match the plan's opentp '${planVersion}' (opentp.yaml)`,
      );
    }
    const range = cliRangeProblem(planCli.cli, version, label);
    if (range !== null) lines.push(range);
  }
  if (lines.length > 0) throw new CliConfigError(lines);

  return {
    path: opened.path,
    dir: opened.dir,
    config: mergeApplicationConfig(opened.config, planCli),
    application: {
      plan: opened.plan,
      source: opened.source,
      planRoot: opened.planRoot,
      configPath: opened.configPath,
      planCliPath,
      keygenIgnored: opened.config.keygen !== undefined,
      planPlugins: [
        ...(planCli?.keygen?.plugins ?? []),
        ...(planCli?.checks?.plugins ?? []),
        ...(planCli?.generate?.plugins ?? []),
      ],
      planWebhooks: planWebhookIds(opened.config, planCli),
      ...(planCli?.tracker !== undefined
        ? { trackerOrigin: { app: opened.config.tracker, planLabel: label } }
        : {}),
    },
  };
}
