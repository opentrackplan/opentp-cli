#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { type ParseArgsConfig, parseArgs } from "node:util";
import {
  getBindingProblems,
  isToolRuleId,
  type Severities,
  TOOL_RULES,
  type ToolRuleId,
} from "./checks";
import {
  buildCheckEnvironment,
  CliConfigError,
  type CliRunEntry,
  cliPluginDirectories,
  findApplicationFile,
  getSeverities,
  type LoadedCliConfig,
  loadCliConfig,
  mcpToolGroups,
  type PluginSection,
  pluginsAllowed,
  pluginsNotLoadedWarning,
  resolveCliPath,
} from "./cliconfig";
import {
  completeApplication,
  keygenIgnoredWarning,
  type OpenedApplication,
  openApplication,
  planPluginsWarning,
} from "./cliconfig/application";
import { type GitPlanSource, redactCredentials } from "./cliconfig/plan-source";
import { getRunEntryProblems } from "./cliconfig/run";
import { getTrackerProblems, resolveTracker } from "./cliconfig/tracker";
import {
  findConfigFile,
  getDictsPath,
  getEventsPath,
  getEventsTemplate,
  getKeygenProblems,
  loadConfig,
  rootToolFiles,
  validateConfig,
} from "./core/config";
import type { DictionaryIssue } from "./core/dict";
import { loadDictionaries } from "./core/dict";
import { loadEvents } from "./core/event";
import { setEventKey } from "./core/fix";
import { filterEvents } from "./core/select";
import {
  cliConfigIssuesToErrors,
  configIssuesToErrors,
  errorLines,
  errorsOnly,
  formatErrors,
  loadIssuesToErrors,
  validateEvents,
  warningLines,
  warningsOnly,
} from "./core/validator";
import type { GeneratorOptions } from "./generators";
import { getGenerator, getGeneratorNames, loadExternalGenerators } from "./generators";
import { generatorContext } from "./generators/context";
import { PlanStore } from "./mcp/plan";
import { reserveStdoutForProtocol, serveMcpStdio } from "./mcp/server";
import { SPEC_SCHEMAS_URL, SPEC_VERSION, VERSION } from "./meta";
import { runMigrateCommand } from "./migrate/command";
import { loadExternalRules } from "./rules";
import { loadExternalTransforms } from "./transforms";
import type { OpenTPConfig } from "./types";
import { getLogLevelEnvProblem, logger, setLogLevel } from "./util/logger";
import { jsonLines, printLines } from "./util/output";

/**
 * Exit codes: 0 success; 1 validation errors, a plan that cannot be loaded completely, or a failed
 * generator; 2 usage or configuration errors (unknown command or option, opentp.yaml or
 * opentp.cli.yaml missing or invalid, a plan: that cannot be found or fetched, fix or migrate in an
 * application repository).
 */
export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

const COMMANDS = ["validate", "fix", "generate", "mcp", "migrate", "help", "version"] as const;
type Command = (typeof COMMANDS)[number];

export interface CliOptions {
  root: string;
  command: Command;
  fix: boolean;
  verbose: boolean;
  json: boolean;
  externalRules: string[];
  externalTransforms: string[];
  externalGenerators: string[];
  /** --cli-config: opentp.cli.yaml to use instead of the one in the plan root (relative to cwd) */
  cliConfig?: string;
  /** --allow-plugins: load the plugins named in opentp.cli.yaml */
  allowPlugins: boolean;
  /** --fail-on: tool rules reported as errors */
  failOn: ToolRuleId[];
  /** migrate --check: write nothing, exit 1 when a file would change */
  check: boolean;
  /** migrate --dry-run: write nothing */
  dryRun: boolean;
  // Generate command options
  generatorName?: string;
  generatorOptions: GeneratorOptions;
}

/** A command-line problem: printed with the short usage on stderr, exit code 2 */
export class UsageError extends Error {}

const OPTIONS = {
  root: { type: "string", short: "r" },
  verbose: { type: "boolean", short: "v" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "V" },
  "cli-config": { type: "string" },
  fix: { type: "boolean", short: "f" },
  json: { type: "boolean" },
  "allow-plugins": { type: "boolean" },
  "fail-on": { type: "string", multiple: true },
  "external-rules": { type: "string", multiple: true },
  "external-transforms": { type: "string", multiple: true },
  "external-generators": { type: "string", multiple: true },
  output: { type: "string", short: "o" },
  file: { type: "string" },
  pretty: { type: "boolean" },
  "no-pretty": { type: "boolean" },
  check: { type: "boolean" },
  "dry-run": { type: "boolean" },
} satisfies ParseArgsConfig["options"];

type OptionName = keyof typeof OPTIONS;

/** Options accepted by every command */
const GLOBAL_OPTIONS: readonly OptionName[] = ["root", "verbose", "help", "version", "cli-config"];

/** Command-specific options; any other option is a usage error for that command */
const COMMAND_OPTIONS: Record<
  "validate" | "fix" | "generate" | "mcp" | "migrate",
  readonly OptionName[]
> = {
  validate: ["fix", "json", "allow-plugins", "fail-on", "external-rules", "external-transforms"],
  fix: ["fix", "json", "allow-plugins", "fail-on", "external-rules", "external-transforms"],
  generate: [
    "output",
    "file",
    "pretty",
    "no-pretty",
    "allow-plugins",
    "external-generators",
    // Keygen pipelines are checked when the plan is loaded, so custom steps must be loadable here
    "external-transforms",
  ],
  mcp: ["allow-plugins", "fail-on", "external-rules", "external-transforms"],
  migrate: ["check", "dry-run", "json"],
};

/** Generate options that only make sense with a generator name */
const NAMED_GENERATE_OPTIONS: readonly OptionName[] = ["output", "file", "pretty", "no-pretty"];

function tokenize(args: string[]) {
  return parseArgs({ args, options: OPTIONS, allowPositionals: true, strict: true, tokens: true });
}

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

/**
 * Parses command-line arguments (without the node and script paths) with node:util parseArgs.
 *
 * The first positional argument is the command (default: validate); options may appear anywhere,
 * so `generate -o out.json json` names the json generator.
 * @throws UsageError for an unknown command or option, a missing or empty option value, an option
 * the command does not accept, or a missing or unexpected positional argument
 */
export function parseCliArgs(args: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  let parsed: ReturnType<typeof tokenize>;
  try {
    parsed = tokenize(args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Keep "Unknown option '--x'" and drop Node's hint about positionals that start with '-'
    const unknownOption = (err as NodeJS.ErrnoException).code === "ERR_PARSE_ARGS_UNKNOWN_OPTION";
    throw new UsageError(unknownOption ? message.split(". ")[0] : message);
  }

  const [commandArg, ...rest] = parsed.positionals;
  if (commandArg !== undefined && !isCommand(commandArg)) {
    throw new UsageError(`Unknown command '${commandArg}'`);
  }

  const options: CliOptions = {
    root: env.OPENTP_ROOT || process.cwd(),
    command: commandArg ?? "validate",
    fix: false,
    verbose: false,
    json: false,
    externalRules: [],
    externalTransforms: [],
    externalGenerators: [],
    allowPlugins: false,
    failOn: [],
    check: false,
    dryRun: false,
    generatorOptions: {},
  };

  // The help and version commands take no arguments. The --help and --version flags win over the
  // command, its options and its arguments (still after unknown commands and options).
  const helpOrVersionFlag = parsed.values.help || parsed.values.version;
  if (
    !helpOrVersionFlag &&
    (commandArg === "help" || commandArg === "version") &&
    rest.length > 0
  ) {
    throw new UsageError(`Unexpected argument '${rest[0]}'`);
  }

  if (parsed.values.help || options.command === "help") {
    options.command = "help";
    return options;
  }
  if (parsed.values.version || options.command === "version") {
    options.command = "version";
    return options;
  }

  const command = options.command as "validate" | "fix" | "generate" | "mcp" | "migrate";
  const accepted = new Set<string>([...GLOBAL_OPTIONS, ...COMMAND_OPTIONS[command]]);
  const generateNamedOnly: string[] = [];

  // Tokens keep the command-line order, so the last of --pretty / --no-pretty wins
  for (const token of parsed.tokens) {
    if (token.kind !== "option") continue;
    const name = token.name as OptionName;
    if (!accepted.has(name)) {
      throw new UsageError(`Option '${token.rawName}' cannot be used with '${command}'`);
    }
    if (OPTIONS[name].type === "string" && !token.value) {
      throw new UsageError(`Option '${token.rawName}' needs a non-empty value`);
    }
    if (NAMED_GENERATE_OPTIONS.includes(name)) generateNamedOnly.push(token.rawName);

    const value = token.value ?? "";
    switch (name) {
      case "root":
        options.root = value;
        break;
      case "verbose":
        options.verbose = true;
        break;
      case "cli-config":
        options.cliConfig = value;
        break;
      case "fix":
        options.fix = true;
        break;
      case "json":
        options.json = true;
        break;
      case "allow-plugins":
        options.allowPlugins = true;
        break;
      case "fail-on":
        for (const id of value.split(",").map((part) => part.trim())) {
          if (!isToolRuleId(id)) {
            throw new UsageError(
              `Unknown --fail-on id '${id}'. Expected one of: ${TOOL_RULES.join(", ")}`,
            );
          }
          if (!options.failOn.includes(id)) options.failOn.push(id);
        }
        break;
      case "external-rules":
        options.externalRules.push(value);
        break;
      case "external-transforms":
        options.externalTransforms.push(value);
        break;
      case "external-generators":
        options.externalGenerators.push(value);
        break;
      case "output":
        options.generatorOptions.output = value;
        break;
      case "file":
        options.generatorOptions.file = value;
        break;
      case "pretty":
        options.generatorOptions.pretty = true;
        break;
      case "no-pretty":
        options.generatorOptions.pretty = false;
        break;
      case "check":
        options.check = true;
        break;
      case "dry-run":
        options.dryRun = true;
        break;
    }
  }

  if (command === "fix") {
    options.fix = true;
  }

  if (command === "generate") {
    if (rest.length > 0) {
      options.generatorName = rest[0];
      rest.shift();
    } else if (generateNamedOnly.length > 0) {
      // Without a name, generate.run entries in opentp.cli.yaml set output, file and pretty
      throw new UsageError(
        `Option '${generateNamedOnly[0]}' needs a generator name: opentp generate <name> (generate.run entries in opentp.cli.yaml set their own)`,
      );
    }
  }
  if (rest.length > 0) {
    throw new UsageError(`Unexpected argument '${rest[0]}'`);
  }

  return options;
}

const USAGE =
  "Usage: opentp [validate | fix | generate [<name>] | mcp | migrate | help | version] [options]";

function printUsageError(message: string): void {
  console.error(`✗ ${message}`);
  console.error(USAGE);
  console.error("Run 'opentp --help' for the list of commands and options.");
}

function printHelp(): void {
  console.log(`
OpenTrackPlan CLI v${VERSION} (spec ${SPEC_VERSION})

${USAGE}

Commands:
  validate               Validate the tracking plan (default)
  fix                    Rewrite event keys from keygen in opentp.cli.yaml, then validate
                         (plan repositories only)
  generate <name>        Export the tracking plan with a generator (no validation)
  generate               Run the generate.run entries of opentp.cli.yaml
  mcp                    Serve the tracking plan to AI agents over MCP (stdio, read-only tools)
  migrate                Upgrade a 2026-01 tracking plan to 2026-09 (rewrites only what changes;
                         plan repositories only)
  help                   Show this help message
  version                Show version

Generators:
  json                   Export events as JSON
  yaml                   Export events as YAML
  template               Render events using a template file

Options (all commands):
  -r, --root <path>                Project root (default: $OPENTP_ROOT, else the current directory)
  --cli-config <path>              opentp.cli.yaml to use (default: opentp.cli.yaml or
                                   opentp.cli.yml in the project root, if present)
  -v, --verbose                    Debug logs
  -h, --help                       Show this help message
  -V, --version                    Show version

Options (validate, fix):
  -f, --fix                        Same as the 'fix' command
  --json                           Print the result as one JSON document on stdout
  --fail-on <id>[,<id>...]         Report these tool rules as errors: overlap, unknownCheck
                                   (repeatable; default severity: warning)
  --allow-plugins                  Load the plugins named in opentp.cli.yaml
  --external-rules <dir>           Load custom checks from <dir> (repeatable)
  --external-transforms <dir>      Load custom transform steps from <dir> (repeatable)

Options (generate):
  -o, --output <path>              Output file, relative to --root (default: stdout)
  --file <path>                    Template file, relative to the current directory (template)
  --pretty / --no-pretty           Pretty-print JSON (default: --pretty)
  --allow-plugins                  Load the plugins named in opentp.cli.yaml
  --external-generators <dir>      Load custom generators from <dir> (repeatable)
  --external-transforms <dir>      Load custom transform steps used by keygen (repeatable)
  (-o, --file and --pretty need a generator name; generate.run entries set their own,
  inside the directory of opentp.cli.yaml)

Options (mcp):
  --fail-on <id>[,<id>...]         Report these tool rules as errors (see validate)
  --allow-plugins                  Load the plugins named in opentp.cli.yaml
  --external-rules <dir>           Load custom checks used by the validation tools (repeatable)
  --external-transforms <dir>      Load custom transform steps used by keygen (repeatable)

Options (migrate):
  --check                          Write nothing; exit 1 when a file would change
  --dry-run                        Write nothing; show what would change
  --json                           Print the result as one JSON document on stdout

Plugin directories given with --external-* are resolved against the current directory and always
load. Plugins named in opentp.cli.yaml (keygen.plugins, checks.plugins, generate.plugins) resolve
against that file's directory and load only with --allow-plugins or OPENTP_ALLOW_PLUGINS=1.
Logs go to stderr; stdout carries only the command output (the validation report, the --json
document, generator output, or the MCP protocol for 'mcp').

Application repositories: an opentp.cli.yaml with plan: and no opentp.yaml next to it uses the
plan that plan: names: a directory (relative to opentp.cli.yaml) or a git URL with a tag or commit
SHA (git+ssh://, git+https:// or git+file://, e.g. git+ssh://git@example.com/acme/plan.git#v1.0.0).
A git plan is cloned once into the cache and never refreshed (delete it to fetch again). validate,
generate and mcp work there (no key checks; the plan repository's tracker, rule bindings and
check severity are merged in, its plugins and webhook bindings never run); fix and migrate run in
the plan repository.

Environment:
  OPENTP_ROOT            Default for --root
  OPENTP_LOG_LEVEL       trace, debug, info (default), warn, error or fatal
  OPENTP_ALLOW_PLUGINS   1: same as --allow-plugins
  OPENTP_WEBHOOK_ENV     Variables that webhook bindings may use in \${VAR} (comma-separated;
                         unset: none)
  OPENTP_CACHE_DIR       Cache of git plans (default: ~/.cache/opentp or $XDG_CACHE_HOME/opentp,
                         ~/Library/Caches/opentp on macOS, %LOCALAPPDATA%\\opentp\\Cache on Windows)

Exit codes:
  0  Success (warnings do not change the exit code)
  1  Validation errors, a plan that cannot be loaded completely, or a failed generator;
     migrate: --check found files to migrate, or the plan cannot be migrated (nothing written)
  2  Usage or configuration error (unknown command or option, opentp.yaml or opentp.cli.yaml
     missing or invalid, a plan: that cannot be found or fetched, fix or migrate in an
     application repository)

Examples:
  opentp validate
  opentp validate --root ./my-project
  opentp validate --json > report.json
  opentp validate --fail-on unknownCheck
  opentp fix
  opentp generate
  opentp generate json
  opentp generate json --output ./events.json
  opentp generate yaml -o ./events.yaml
  opentp generate template --file ./template.hbs -o ./EVENTS.md
  opentp mcp --root ./my-plan
  opentp migrate --dry-run
`);
}

function printVersion(): void {
  console.log(`opentp v${VERSION} (spec ${SPEC_VERSION})`);
  console.log(`Schemas: ${SPEC_SCHEMAS_URL}`);
}

/**
 * Loads opentp.yaml from the plan root. Returns the exit code instead when it is missing or cannot
 * be loaded (a configuration error). `pinnedPlan`: `plan:` of an application repository.
 */
function loadProjectConfig(root: string, pinnedPlan?: string): OpenTPConfig | number {
  const configPath = findConfigFile(root);
  if (!configPath) {
    logger.error({ root }, "opentp.yaml not found");
    return EXIT_USAGE;
  }

  logger.debug({ configPath }, "Loading config");
  try {
    const config = loadConfig(configPath, { pinnedPlan });
    logger.debug({ title: config.info.title, version: config.info.version }, "Config loaded");
    return config;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ file: configPath }, message);
    return EXIT_USAGE;
  }
}

function printCliConfigError(error: CliConfigError): void {
  for (const line of error.lines) logger.error(line);
}

/**
 * Loads opentp.cli.yaml (optional) for a loaded plan. Returns the exit code instead for a problem
 * that stops every command (exit 2).
 */
function loadProjectCliConfig(
  options: CliOptions,
  planVersion: string | undefined,
): LoadedCliConfig | null | number {
  try {
    const cli = loadCliConfig(options.root, { explicitPath: options.cliConfig, planVersion });
    if (cli) logger.debug({ file: cli.path }, "Loaded opentp.cli.yaml");
    return cli;
  } catch (error) {
    if (error instanceof CliConfigError) {
      printCliConfigError(error);
      return EXIT_USAGE;
    }
    throw error;
  }
}

interface Project {
  config: OpenTPConfig;
  cli: LoadedCliConfig | null;
  severities: Severities;
  /**
   * The directory of opentp.yaml: --root, or in application repository mode the plan that
   * opentp.cli.yaml names (outputs still resolve against --root and opentp.cli.yaml)
   */
  planRoot: string;
}

/** Logs that a git plan is being cloned into the cache (the first run with a new ref) */
function logPlanFetch(source: GitPlanSource, dir: string): void {
  logger.info(
    { ref: source.ref, cache: dir },
    `Fetching the plan ${redactCredentials(source.url)}`,
  );
}

/**
 * Application repository mode, first step: the application file and the plan's location (a git
 * plan is cloned into the cache). Returns the exit code instead for a configuration error.
 */
function openApplicationProject(options: CliOptions, file: string): OpenedApplication | number {
  try {
    const opened = openApplication(file, options.root, { onFetch: logPlanFetch });
    logger.debug({ plan: opened.plan, root: opened.planRoot }, "Application repository");
    return opened;
  } catch (error) {
    if (error instanceof CliConfigError) {
      printCliConfigError(error);
      return EXIT_USAGE;
    }
    throw error;
  }
}

/**
 * Application repository mode, second step (after the plan's opentp.yaml is loaded): the headers,
 * the plan repository's opentp.cli.yaml and the merged settings. Warns once about an ignored keygen.
 */
function completeApplicationProject(
  opened: OpenedApplication,
  planVersion: string | undefined,
): LoadedCliConfig | number {
  try {
    const cli = completeApplication(opened, { planVersion });
    if (cli.application?.keygenIgnored) logger.warn(keygenIgnoredWarning());
    const planWarning = cli.application ? planPluginsWarning(cli.application) : "";
    if (planWarning !== "") logger.warn(planWarning);
    return cli;
  } catch (error) {
    if (error instanceof CliConfigError) {
      printCliConfigError(error);
      return EXIT_USAGE;
    }
    throw error;
  }
}

/**
 * The application repository file (opentp.cli.yaml with plan:), null in a plan repository, or the
 * exit code for an opentp.cli.yaml that cannot be found or read in a root without opentp.yaml
 */
function findApplication(root: string, cliConfig: string | undefined): string | null | number {
  try {
    return findApplicationFile(root, cliConfig);
  } catch (error) {
    if (error instanceof CliConfigError) {
      printCliConfigError(error);
      return EXIT_USAGE;
    }
    throw error;
  }
}

/**
 * opentp.yaml (version first), then opentp.cli.yaml; the exit code for a configuration error. In
 * application repository mode (opentp.cli.yaml with plan:) the plan comes from plan:.
 */
function loadProject(options: CliOptions): Project | number {
  const applicationFile = findApplication(options.root, options.cliConfig);
  if (typeof applicationFile === "number") return applicationFile;
  if (applicationFile !== null) {
    const opened = openApplicationProject(options, applicationFile);
    if (typeof opened === "number") return opened;
    const config = loadProjectConfig(opened.planRoot, opened.plan);
    if (typeof config === "number") return config;
    const cli = completeApplicationProject(opened, config.opentp);
    if (typeof cli === "number") return cli;
    return {
      config,
      cli,
      severities: getSeverities(cli, options.failOn),
      planRoot: opened.planRoot,
    };
  }
  const config = loadProjectConfig(options.root);
  if (typeof config === "number") return config;
  const cli = loadProjectCliConfig(options, config.opentp);
  if (typeof cli === "number") return cli;
  return {
    config,
    cli,
    severities: getSeverities(cli, options.failOn),
    planRoot: options.root,
  };
}

/**
 * A command that edits the plan refuses to run in an application repository (exit 2; also for an
 * opentp.cli.yaml that cannot be read in a root without opentp.yaml); `migrate` checks this itself
 */
function refusesApplicationRepository(options: CliOptions, command: string): boolean {
  const applicationFile = findApplication(options.root, options.cliConfig);
  if (applicationFile === null) return false;
  if (typeof applicationFile === "number") return true;
  logger.error(`${command} edits the plan repository; run it there (opentp.cli.yaml has plan:)`);
  return true;
}

/**
 * Loads external transform steps. They must be registered before the plan is loaded: keygen
 * pipelines are checked against the registered steps.
 */
async function loadTransformPlugins(dirs: string[]): Promise<boolean> {
  for (const dir of dirs) {
    try {
      logger.debug({ path: dir }, "Loading external transforms");
      await loadExternalTransforms(dir);
    } catch (err) {
      logger.error({ path: dir, err }, "Failed to load external transforms");
      return false;
    }
  }
  return true;
}

interface PluginRequest {
  transforms?: boolean;
  rules?: boolean;
  generators?: boolean;
}

/**
 * Loads the plugins a command uses: --external-* directories (explicit consent, always) and the
 * directories named in opentp.cli.yaml (only with --allow-plugins or OPENTP_ALLOW_PLUGINS=1; else one
 * warning and the run continues without them). Returns false for a failure that exits 2, and
 * whether checks.plugins were left out.
 */
async function loadPlugins(
  cli: LoadedCliConfig | null,
  options: CliOptions,
  request: PluginRequest,
): Promise<{ ok: boolean; checksPluginsSkipped: boolean }> {
  const sections: PluginSection[] = [];
  if (request.transforms) sections.push("keygen");
  if (request.rules) sections.push("checks");
  if (request.generators) sections.push("generate");
  const named = cliPluginDirectories(cli, sections);
  const allowed = pluginsAllowed(options.allowPlugins);
  if (named.length > 0 && !allowed) {
    logger.warn(pluginsNotLoadedWarning(named.map((dir) => dir.written)));
  }
  const fromFile = allowed ? named : [];
  for (const dir of fromFile) {
    if (!fs.existsSync(dir.resolved) || !fs.statSync(dir.resolved).isDirectory()) {
      logger.error(`opentp.cli.yaml: ${dir.section}.plugins: directory not found: ${dir.resolved}`);
      return { ok: false, checksPluginsSkipped: false };
    }
  }
  const dirsOf = (section: PluginSection) =>
    fromFile.filter((dir) => dir.section === section).map((dir) => dir.resolved);
  const checksPluginsSkipped = !allowed && named.some((dir) => dir.section === "checks");

  if (request.transforms) {
    if (!(await loadTransformPlugins([...options.externalTransforms, ...dirsOf("keygen")]))) {
      return { ok: false, checksPluginsSkipped };
    }
  }
  if (request.rules) {
    for (const dir of [...options.externalRules, ...dirsOf("checks")]) {
      try {
        logger.debug({ path: dir }, "Loading external rules");
        await loadExternalRules(dir);
      } catch (err) {
        logger.error({ path: dir, err }, "Failed to load external rules");
        return { ok: false, checksPluginsSkipped };
      }
    }
  }
  if (request.generators) {
    for (const dir of [...options.externalGenerators, ...dirsOf("generate")]) {
      try {
        logger.debug({ path: dir }, "Loading external generators");
        await loadExternalGenerators(dir);
      } catch (err) {
        logger.error({ path: dir, err }, "Failed to load external generators");
        return { ok: false, checksPluginsSkipped };
      }
    }
  }
  return { ok: true, checksPluginsSkipped };
}

/**
 * Binding problems stop every command (exit 2): reserved or colliding ids, rule bindings to unknown
 * rules (unless the rule may come from plugins that were not loaded, including the plugins of a
 * plan repository, which never run in an application repository). Returns true when there are
 * none.
 */
function checkBindings(
  project: Pick<Project, "config" | "cli">,
  rulePluginsMissing: boolean,
): boolean {
  const planPlugins = (project.cli?.application?.planPlugins.length ?? 0) > 0;
  const problems = getBindingProblems(
    project.cli?.config.checks?.bindings ?? {},
    project.config.spec.checks,
    { pluginsSkipped: rulePluginsMissing || planPlugins },
  );
  for (const problem of problems) logger.error(`opentp.cli.yaml: ${problem}`);
  return problems.length === 0;
}

async function runValidate(options: CliOptions): Promise<number> {
  const { verbose, json, fix } = options;

  // Set log level based on verbose flag
  if (verbose) {
    setLogLevel("debug");
  }

  // fix rewrites event files: never in an application repository (before its plan is fetched)
  if (fix && refusesApplicationRepository(options, "fix")) {
    return EXIT_USAGE;
  }

  // 1. opentp.yaml and opentp.cli.yaml
  const project = loadProject(options);
  if (typeof project === "number") {
    return project;
  }
  const { config, cli, severities } = project;
  // The directory of opentp.yaml (in an application repository: the plan it names)
  const root = project.planRoot;
  const keygen = cli?.config.keygen ?? null;

  if (fix && !keygen) {
    logger.error(
      "fix needs keygen in opentp.cli.yaml (key generation is a tool setting: add a keygen section with template and transforms)",
    );
    return EXIT_USAGE;
  }

  // 2. Plugins: transform steps before events are loaded (keygen), rules before the bindings check
  const plugins = await loadPlugins(cli, options, { transforms: true, rules: true });
  if (!plugins.ok) {
    return EXIT_USAGE;
  }
  if (!checkBindings(project, plugins.checksPluginsSkipped)) {
    return EXIT_USAGE;
  }

  const skipFiles = rootToolFiles(root);

  // 3. Load dictionaries
  const dictsPath = getDictsPath(config, root);
  let dictionaries = new Map<string, (string | number | boolean)[]>();
  let dictIssues: DictionaryIssue[] = [];

  if (dictsPath) {
    logger.debug({ path: dictsPath }, "Loading dictionaries");
    const result = loadDictionaries(dictsPath, config.opentp, {
      skipFiles,
      pinnedPlan: cli?.application !== undefined,
    });
    dictionaries = result.dictionaries;
    dictIssues = result.issues;
    logger.debug({ count: dictionaries.size, issues: dictIssues.length }, "Dictionaries loaded");
  }

  // 4. Load events
  const eventsPath = getEventsPath(config, root);
  const eventsTemplate = getEventsTemplate(config);

  if (!eventsPath || !eventsTemplate) {
    logger.error("Events path not configured in opentp.yaml");
    return EXIT_USAGE;
  }

  logger.debug({ path: eventsPath, template: eventsTemplate }, "Loading events");
  // Files that fail to load are not in `events`; their issues become validation errors below
  const { events, issues: eventIssues } = loadEvents(eventsPath, eventsTemplate, config, {
    keygen,
    skipFiles,
  });
  logger.debug({ count: events.length, issues: eventIssues.length }, "Events loaded");

  // 5. If fix mode - fix keys
  if (fix && keygen) {
    if (validateConfig(config).length > 0) {
      // Never rewrite keys from a broken configuration; validation below reports the problems
      logger.error("Event keys were not fixed: opentp.yaml has configuration errors");
    } else if (getKeygenProblems(keygen, config).length > 0) {
      logger.error("Event keys were not fixed: keygen in opentp.cli.yaml has problems");
    } else if (getTrackerProblems(cli?.config.tracker, config).length > 0) {
      logger.error("Event keys were not fixed: tracker in opentp.cli.yaml has problems");
    } else {
      let fixed = 0;
      for (const event of events) {
        if (typeof event.expectedKey !== "string") {
          logger.error(
            { file: event.relativePath, reason: event.keygenError },
            "Expected key could not be generated (check keygen.template and keygen.transforms in opentp.cli.yaml)",
          );
          continue;
        }

        if (event.key !== event.expectedKey) {
          try {
            // Only the key's text changes; the rest of the file stays byte for byte
            const edit = setEventKey(fs.readFileSync(event.filePath, "utf-8"), event.expectedKey);
            if (!edit.ok) {
              logger.warn(
                { file: event.relativePath, reason: edit.reason },
                "Event key was not fixed: event.key cannot be changed alone in this file (edit it by hand)",
              );
              continue;
            }
            fs.writeFileSync(event.filePath, edit.text, "utf-8");
            event.key = event.expectedKey;
            fixed++;
            logger.info({ file: event.relativePath }, "Fixed event key");
          } catch (error) {
            logger.error({ file: event.relativePath, error }, "Failed to fix event");
          }
        }
      }
      if (fixed > 0) {
        logger.info({ count: fixed }, "Events fixed");
      }
    }
  }

  // 6. Validate (also reports opentp.yaml and opentp.cli.yaml problems once)
  logger.debug("Starting validation");
  const results = [
    ...loadIssuesToErrors(dictIssues, eventIssues),
    ...(await validateEvents(events, config, dictionaries, {
      keygen,
      tracker: cli?.config.tracker,
      trackerOrigin: cli?.application?.trackerOrigin,
      checks: buildCheckEnvironment(config, cli),
      severities,
      // Keys are checked in the plan repository, not in an application repository
      keyChecks: !cli?.application,
      pinnedPlan: cli?.application !== undefined,
    })),
  ];
  const errors = errorsOnly(results);
  const warnings = warningsOnly(results);

  // 7. Output result: the report or the JSON document on stdout, the summary (a log line) on stderr.
  // Both are written a chunk at a time: a large plan can have a very large number of results.
  if (json) {
    printLines(
      jsonLines({
        success: errors.length === 0,
        events: events.length,
        errors,
        warnings,
      }),
    );
  } else {
    if (errors.length > 0) printLines(errorLines(errors));
    if (warnings.length > 0) printLines(warningLines(warnings));
    // count= stays the last field of the summary line
    if (errors.length === 0) {
      logger.info(
        warnings.length > 0
          ? { warnings: warnings.length, count: events.length }
          : { count: events.length },
        "✓ All events are valid",
      );
    } else {
      logger.error(
        { errorCount: errors.length, warningCount: warnings.length, eventCount: events.length },
        "Validation failed",
      );
    }
  }

  return errors.length === 0 ? EXIT_OK : EXIT_FAILURE;
}

/** One generator run: from the command line (`generate <name>`) or a generate.run entry */
interface GenerateRun {
  generator: string;
  options: GeneratorOptions;
  entry?: CliRunEntry;
  label: string;
}

async function runGenerate(options: CliOptions): Promise<number> {
  const { root, verbose, generatorOptions } = options;

  if (verbose) {
    setLogLevel("debug");
  }

  // Load opentp.yaml (required for generation) and opentp.cli.yaml
  const project = loadProject(options);
  if (typeof project === "number") {
    return project;
  }
  const { config, cli, planRoot } = project;
  const keygen = cli?.config.keygen ?? null;

  // What to run: the named generator, or the generate.run entries of opentp.cli.yaml
  let runs: GenerateRun[];
  if (options.generatorName !== undefined) {
    runs = [
      { generator: options.generatorName, options: generatorOptions, label: options.generatorName },
    ];
  } else {
    const entries = cli?.config.generate?.run ?? [];
    if (!cli || entries.length === 0) {
      logger.error(
        "generate needs a generator name or generate.run entries in opentp.cli.yaml (e.g. opentp generate json)",
      );
      return EXIT_USAGE;
    }
    runs = entries.map((entry, index) => ({
      generator: entry.generator,
      entry,
      label: `generate.run[${index}]`,
      options: {
        output: resolveCliPath(cli, entry.output),
        ...(entry.file !== undefined ? { file: resolveCliPath(cli, entry.file) } : {}),
        ...(entry.pretty !== undefined ? { pretty: entry.pretty } : {}),
      },
    }));
  }

  // Generators and keygen steps (unknown keygen steps make generate refuse below)
  const plugins = await loadPlugins(cli, options, { transforms: true, generators: true });
  if (!plugins.ok) {
    return EXIT_USAGE;
  }
  // generate loads no check plugins, so bindings to plugin rules are not reported here
  if (!checkBindings(project, true)) {
    return EXIT_USAGE;
  }

  // Every entry is checked before any runs (generators, paths inside the directory of
  // opentp.cli.yaml, template files, filters), and every problem is reported
  if (options.generatorName !== undefined) {
    if (!getGenerator(options.generatorName)) {
      logger.error(
        { name: options.generatorName },
        `Unknown generator. Available: ${getGeneratorNames().join(", ")}`,
      );
      return EXIT_USAGE;
    }
  } else if (cli) {
    const problems = (cli.config.generate?.run ?? []).flatMap((entry, index) =>
      getRunEntryProblems(entry, index, cli.dir, config),
    );
    for (const problem of problems) logger.error(`opentp.cli.yaml: ${problem}`);
    if (problems.length > 0) return EXIT_USAGE;
  }

  // Load data (from the plan; outputs go to --root)
  const skipFiles = rootToolFiles(planRoot);
  const dictsPath = getDictsPath(config, planRoot);
  const dictResult = dictsPath
    ? loadDictionaries(dictsPath, config.opentp, {
        skipFiles,
        pinnedPlan: cli?.application !== undefined,
      })
    : { dictionaries: new Map<string, (string | number | boolean)[]>(), issues: [] };
  const dictionaries = dictResult.dictionaries;
  const eventsPath = getEventsPath(config, planRoot);
  const eventsTemplate = getEventsTemplate(config);

  if (!eventsPath || !eventsTemplate) {
    logger.error("Events path not configured");
    return EXIT_USAGE;
  }

  const { events, issues: eventIssues } = loadEvents(eventsPath, eventsTemplate, config, {
    keygen,
    skipFiles,
  });
  // Generators get the events sorted by file path: readdir order differs between platforms
  events.sort((a, b) =>
    a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0,
  );
  logger.debug({ count: events.length, issues: eventIssues.length }, "Events loaded");

  // Generate does not validate events, but refuses to export a plan that could not be loaded
  // completely: opentp.yaml configuration errors, keygen problems in opentp.cli.yaml, dictionary
  // issues, or event files that failed to load. The problems go to stderr so that stdout stays
  // clean.
  // The tracker binding: generators get it resolved per target; its problems also stop generate
  const tracker = resolveTracker(cli?.config.tracker, config, cli?.application?.trackerOrigin);
  const loadErrors = [
    ...configIssuesToErrors(validateConfig(config)),
    ...cliConfigIssuesToErrors(getKeygenProblems(keygen, config)),
    ...cliConfigIssuesToErrors(tracker?.problems ?? []),
    ...loadIssuesToErrors(dictResult.issues, eventIssues),
  ];
  if (loadErrors.length > 0) {
    console.error(formatErrors(loadErrors));
    logger.error(
      { errorCount: loadErrors.length, eventCount: events.length },
      "Generation aborted: the tracking plan could not be loaded (run 'opentp validate')",
    );
    return EXIT_FAILURE;
  }

  for (const run of runs) {
    const generator = getGenerator(run.generator);
    if (!generator) return EXIT_USAGE;
    const selected = run.entry ? filterEvents(events, config, run.entry) : events;
    logger.debug({ generator: run.generator, events: selected.length }, "Running generator");

    try {
      const result = await generator.generate(
        generatorContext({
          config,
          events: selected,
          dictionaries,
          options: run.options,
          tracker: tracker?.binding ?? null,
          cliConfig: cli?.config ?? null,
        }),
      );

      // Handle output: stdout gets the generator output verbatim (the same bytes as an --output file)
      if (result.stdout) {
        process.stdout.write(result.stdout);
      }

      if (result.files) {
        for (const file of result.files) {
          const filePath = path.isAbsolute(file.path) ? file.path : path.resolve(root, file.path);

          // Ensure directory exists
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          fs.writeFileSync(filePath, file.content, "utf-8");
          logger.info({ file: filePath }, "Generated");
        }
      }
    } catch (err) {
      logger.error(
        { error: (err as Error).message, ...(run.entry ? { entry: run.label } : {}) },
        "Generator failed",
      );
      return EXIT_FAILURE;
    }
  }

  return EXIT_OK;
}

/**
 * Serves the plan over MCP on stdin/stdout until the client closes stdin. opentp.yaml must exist and
 * opentp.cli.yaml must be usable (exit 2 otherwise); a plan that cannot be loaded (for example a
 * 2026-01 plan) does not stop the server: every tool reports the problem, and later changes are
 * picked up per request.
 */
async function runMcp(options: CliOptions): Promise<number> {
  const { verbose, externalRules, externalTransforms } = options;
  const root = path.resolve(options.root);

  if (verbose) {
    setLogLevel("debug");
  }

  // Application repository mode: the plan comes from plan: in opentp.cli.yaml (a git plan is
  // fetched into the cache now, so that the first tool call does not wait for it)
  const applicationFile = findApplication(root, options.cliConfig);
  if (typeof applicationFile === "number") {
    return applicationFile;
  }
  const opened =
    applicationFile === null ? null : openApplicationProject({ ...options, root }, applicationFile);
  if (typeof opened === "number") {
    return opened;
  }

  const configPath = findConfigFile(opened?.planRoot ?? root);
  if (!configPath) {
    logger.error({ root }, "opentp.yaml not found");
    return EXIT_USAGE;
  }
  let config: OpenTPConfig | null = null;
  try {
    config = loadConfig(configPath, { pinnedPlan: opened?.plan });
  } catch {
    // Reported by every tool (PlanStore)
  }

  // opentp.cli.yaml problems stop the server before it starts; the plan's opentp is compared only
  // when the plan loads (otherwise the tools report the plan's problem first)
  const cli = opened
    ? completeApplicationProject(opened, config?.opentp)
    : loadProjectCliConfig({ ...options, root }, config?.opentp);
  if (typeof cli === "number") {
    return cli;
  }

  // From here on stdout belongs to the protocol: plugins are imported and the plan is loaded next,
  // and anything they print must not reach it
  reserveStdoutForProtocol();

  const plugins = await loadPlugins(
    cli,
    { ...options, externalRules, externalTransforms },
    {
      transforms: true,
      rules: true,
    },
  );
  if (!plugins.ok) {
    return EXIT_USAGE;
  }
  if (config && !checkBindings({ config, cli }, plugins.checksPluginsSkipped)) {
    return EXIT_USAGE;
  }

  // The mcp section is read once, at start; the other sections reload with the plan
  const store = new PlanStore(root, {
    cliConfigPath: options.cliConfig === undefined ? undefined : path.resolve(options.cliConfig),
    failOn: options.failOn,
    checksPluginsSkipped: plugins.checksPluginsSkipped,
    // A new plan ref in opentp.cli.yaml while the server runs is fetched on the next request
    fetch: { onFetch: logPlanFetch },
  });
  try {
    const plan = await store.current();
    logger.debug({ events: plan.events.length }, "Plan loaded");
  } catch (error) {
    logger.warn(
      `The plan cannot be loaded; every tool reports it until it is fixed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  await serveMcpStdio(store, { tools: mcpToolGroups(cli) });
  return EXIT_OK;
}

/**
 * Checks that every --external-* directory exists (resolved against the current directory).
 * @throws UsageError for a missing directory
 */
function checkPluginDirectories(options: CliOptions): void {
  const flags: Array<[string, string[]]> = [
    ["--external-rules", options.externalRules],
    ["--external-transforms", options.externalTransforms],
    ["--external-generators", options.externalGenerators],
  ];
  for (const [flag, dirs] of flags) {
    for (const dir of dirs) {
      const resolved = path.resolve(dir);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        throw new UsageError(`${flag}: directory not found: ${resolved}`);
      }
    }
  }
}

/**
 * Runs the CLI and returns the exit code (see EXIT_OK, EXIT_FAILURE, EXIT_USAGE). Never calls
 * process.exit, so that buffered stdout (e.g. a large export written to a pipe) is never cut off.
 */
export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  let options: CliOptions;
  try {
    options = parseCliArgs(args);
    if (options.command !== "help" && options.command !== "version") {
      const logLevelProblem = getLogLevelEnvProblem();
      if (logLevelProblem) throw new UsageError(logLevelProblem);
      checkPluginDirectories(options);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      printUsageError(err.message);
      return EXIT_USAGE;
    }
    throw err;
  }

  switch (options.command) {
    case "help":
      printHelp();
      return EXIT_OK;

    case "version":
      printVersion();
      return EXIT_OK;

    case "validate":
    case "fix":
      return runValidate(options);

    case "generate":
      return runGenerate(options);

    case "mcp":
      return runMcp(options);

    case "migrate":
      return runMigrateCommand({
        root: options.root,
        cliConfig: options.cliConfig,
        check: options.check,
        dryRun: options.dryRun,
        json: options.json,
        verbose: options.verbose,
      });
  }
}

// Run the CLI only when this module (or the bundle that contains it) is the program's entry point:
// - the Node bundle (CommonJS: `node dist/index.cjs`, or the bin after `npm link`): `require.main` is
//   this module;
// - a Bun binary compiled from this file (an ES module): Bun leaves both `require.main` and `module`
//   undefined, so they are equal (the release workflow runs every binary to catch a Bun change);
// - imported, it does not run: under vitest `module` is an object while `require.main` is undefined,
//   and for `require("opentp")` `require.main` is the host's module.
// Do not match on process.argv[1]: the path of the host or the vitest worker may contain anything.
if (require.main === module) {
  // The reader of a pipe went away (e.g. `opentp generate json | head`): stop quietly
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(process.exitCode ?? EXIT_OK);
    throw error;
  });

  // Set the exit code on the global process and let Node exit once stdout and stderr are flushed;
  // process.exit() would truncate output that is still buffered for a pipe.
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error) => {
      logger.fatal({ error }, "Fatal error");
      process.exitCode = EXIT_FAILURE;
    },
  );
}
