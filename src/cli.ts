#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { type ParseArgsConfig, parseArgs } from "node:util";
import {
  findConfigFile,
  getDictsPath,
  getEventsPath,
  getEventsTemplate,
  loadConfig,
  validateConfig,
} from "./core/config";
import type { DictionaryIssue } from "./core/dict";
import { loadDictionaries } from "./core/dict";
import { loadEvents } from "./core/event";
import {
  configIssuesToErrors,
  formatErrors,
  loadIssuesToErrors,
  validateEvents,
} from "./core/validator";
import type { GeneratorOptions } from "./generators";
import { getGenerator, getGeneratorNames, loadExternalGenerators } from "./generators";
import { PlanStore } from "./mcp/plan";
import { reserveStdoutForProtocol, serveMcpStdio } from "./mcp/server";
import { SPEC_SCHEMAS_URL, SPEC_VERSION, VERSION } from "./meta";
import { loadExternalTransforms } from "./transforms";
import type { EventFile, OpenTPConfig } from "./types";
import { loadYaml, saveYaml } from "./util/files";
import { getLogLevelEnvProblem, logger, setLogLevel } from "./util/logger";

/**
 * Exit codes: 0 success; 1 validation errors, a plan that cannot be loaded completely, or a failed
 * generator; 2 usage or configuration errors (unknown command or option, opentp.yaml missing or
 * invalid).
 */
export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

const COMMANDS = ["validate", "fix", "generate", "mcp", "help", "version"] as const;
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
  fix: { type: "boolean", short: "f" },
  json: { type: "boolean" },
  "external-rules": { type: "string", multiple: true },
  "external-transforms": { type: "string", multiple: true },
  "external-generators": { type: "string", multiple: true },
  output: { type: "string", short: "o" },
  file: { type: "string" },
  pretty: { type: "boolean" },
  "no-pretty": { type: "boolean" },
} satisfies ParseArgsConfig["options"];

type OptionName = keyof typeof OPTIONS;

/** Options accepted by every command */
const GLOBAL_OPTIONS: readonly OptionName[] = ["root", "verbose", "help", "version"];

/** Command-specific options; any other option is a usage error for that command */
const COMMAND_OPTIONS: Record<"validate" | "fix" | "generate" | "mcp", readonly OptionName[]> = {
  validate: ["fix", "json", "external-rules", "external-transforms"],
  fix: ["fix", "json", "external-rules", "external-transforms"],
  generate: [
    "output",
    "file",
    "pretty",
    "no-pretty",
    "external-generators",
    // Keygen pipelines are checked when the plan is loaded, so custom steps must be loadable here
    "external-transforms",
  ],
  mcp: ["external-rules", "external-transforms"],
};

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

  const command = options.command as "validate" | "fix" | "generate" | "mcp";
  const accepted = new Set<string>([...GLOBAL_OPTIONS, ...COMMAND_OPTIONS[command]]);

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

    const value = token.value ?? "";
    switch (name) {
      case "root":
        options.root = value;
        break;
      case "verbose":
        options.verbose = true;
        break;
      case "fix":
        options.fix = true;
        break;
      case "json":
        options.json = true;
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
    }
  }

  if (command === "fix") {
    options.fix = true;
  }

  if (command === "generate") {
    if (rest.length === 0) {
      throw new UsageError(
        "Missing generator name: opentp generate <name> (e.g. json, yaml, template)",
      );
    }
    options.generatorName = rest[0];
    rest.shift();
  }
  if (rest.length > 0) {
    throw new UsageError(`Unexpected argument '${rest[0]}'`);
  }

  return options;
}

const USAGE = "Usage: opentp [validate | fix | generate <name> | mcp | help | version] [options]";

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
  fix                    Rewrite event keys from spec.events.x-opentp.keygen, then validate
  generate <name>        Export the tracking plan with a generator (no validation)
  mcp                    Serve the tracking plan to AI agents over MCP (stdio, read-only tools)
  help                   Show this help message
  version                Show version

Generators:
  json                   Export events as JSON
  yaml                   Export events as YAML
  template               Render events using a template file

Options (all commands):
  -r, --root <path>                Project root (default: $OPENTP_ROOT, else the current directory)
  -v, --verbose                    Debug logs
  -h, --help                       Show this help message
  -V, --version                    Show version

Options (validate, fix):
  -f, --fix                        Same as the 'fix' command
  --json                           Print the result as one JSON document on stdout
  --external-rules <dir>           Load custom checks from <dir> (repeatable)
  --external-transforms <dir>      Load custom transform steps from <dir> (repeatable)

Options (generate):
  -o, --output <path>              Output file, relative to --root (default: stdout)
  --file <path>                    Template file, relative to the current directory (template)
  --pretty / --no-pretty           Pretty-print JSON (default: --pretty)
  --external-generators <dir>      Load custom generators from <dir> (repeatable)
  --external-transforms <dir>      Load custom transform steps used by keygen (repeatable)

Options (mcp):
  --external-rules <dir>           Load custom checks used by the validation tools (repeatable)
  --external-transforms <dir>      Load custom transform steps used by keygen (repeatable)

Plugin directories are resolved against the current directory. Logs go to stderr; stdout carries
only the command output (the validation report, the --json document, generator output, or the MCP
protocol for 'mcp').

Environment:
  OPENTP_ROOT            Default for --root
  OPENTP_LOG_LEVEL       trace, debug, info (default), warn, error or fatal
  OPENTP_WEBHOOK_ENV     Variables that webhook checks may use in \${VAR} (comma-separated)

Exit codes:
  0  Success
  1  Validation errors, a plan that cannot be loaded completely, or a failed generator
  2  Usage or configuration error (unknown command or option, opentp.yaml missing or invalid)

Examples:
  opentp validate
  opentp validate --root ./my-project
  opentp validate --json > report.json
  opentp fix
  opentp generate json
  opentp generate json --output ./events.json
  opentp generate yaml -o ./events.yaml
  opentp generate template --file ./template.hbs -o ./EVENTS.md
  opentp mcp --root ./my-plan
`);
}

function printVersion(): void {
  console.log(`opentp v${VERSION} (spec ${SPEC_VERSION})`);
  console.log(`Schemas: ${SPEC_SCHEMAS_URL}`);
}

/**
 * Loads opentp.yaml from the project root. Returns the exit code instead when it is missing or
 * cannot be loaded (a configuration error).
 */
function loadProjectConfig(root: string): OpenTPConfig | number {
  const configPath = findConfigFile(root);
  if (!configPath) {
    logger.error({ root }, "opentp.yaml not found");
    return EXIT_USAGE;
  }

  logger.debug({ configPath }, "Loading config");
  try {
    const config = loadConfig(configPath);
    logger.debug({ title: config.info.title, version: config.info.version }, "Config loaded");
    return config;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ file: configPath }, message);
    return EXIT_USAGE;
  }
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

async function runValidate(options: CliOptions): Promise<number> {
  const { root, verbose, json, fix, externalRules, externalTransforms } = options;

  // Set log level based on verbose flag
  if (verbose) {
    setLogLevel("debug");
  }

  // 1. Find and load config
  const config = loadProjectConfig(root);
  if (typeof config === "number") {
    return config;
  }

  // 2. Load external transforms (before loading events, since transforms are used there)
  if (!(await loadTransformPlugins(externalTransforms))) {
    return EXIT_USAGE;
  }

  // 3. Load dictionaries
  const dictsPath = getDictsPath(config, root);
  let dictionaries = new Map<string, (string | number | boolean)[]>();
  let dictIssues: DictionaryIssue[] = [];

  if (dictsPath) {
    logger.debug({ path: dictsPath }, "Loading dictionaries");
    const result = loadDictionaries(dictsPath, config.opentp);
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
  const { events, issues: eventIssues } = loadEvents(eventsPath, eventsTemplate, config);
  logger.debug({ count: events.length, issues: eventIssues.length }, "Events loaded");

  // 5. If fix mode - fix keys
  if (fix) {
    if (!config.spec.events["x-opentp"]?.keygen) {
      logger.error(
        "Key generation is not configured. Add spec.events.x-opentp.keygen to opentp.yaml to use 'opentp fix'.",
      );
      return EXIT_USAGE;
    }

    if (validateConfig(config).length > 0) {
      // Never rewrite keys from a broken configuration; validation below reports the problems
      logger.error("Event keys were not fixed: opentp.yaml has configuration errors");
    } else {
      let fixed = 0;
      for (const event of events) {
        if (typeof event.expectedKey !== "string") {
          logger.error(
            { file: event.relativePath, reason: event.keygenError },
            "Expected key could not be generated (check spec.events.x-opentp.keygen.template and transforms)",
          );
          continue;
        }

        if (event.key !== event.expectedKey) {
          try {
            const eventFile = loadYaml<EventFile>(event.filePath);
            eventFile.event.key = event.expectedKey;
            saveYaml(event.filePath, eventFile);
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

  // 6. Validate (also reports opentp.yaml problems once)
  logger.debug("Starting validation");
  const eventErrors = await validateEvents(events, config, dictionaries, externalRules);
  const errors = [...loadIssuesToErrors(dictIssues, eventIssues), ...eventErrors];

  // 7. Output result: the report or the JSON document on stdout, the summary (a log line) on stderr
  if (json) {
    console.log(
      JSON.stringify(
        {
          success: errors.length === 0,
          events: events.length,
          errors: errors,
        },
        null,
        2,
      ),
    );
  } else {
    if (errors.length === 0) {
      logger.info({ count: events.length }, "✓ All events are valid");
    } else {
      console.log(formatErrors(errors));
      logger.error({ errorCount: errors.length, eventCount: events.length }, "Validation failed");
    }
  }

  return errors.length === 0 ? EXIT_OK : EXIT_FAILURE;
}

async function runGenerate(options: CliOptions): Promise<number> {
  const { root, verbose, generatorOptions, externalGenerators, externalTransforms } = options;
  const generatorName = options.generatorName as string;

  if (verbose) {
    setLogLevel("debug");
  }

  // Load opentp.yaml (required for generation). External generators are loaded only via CLI flags.
  const config = loadProjectConfig(root);
  if (typeof config === "number") {
    return config;
  }

  for (const generatorPath of externalGenerators) {
    try {
      logger.debug({ path: generatorPath }, "Loading external generators");
      await loadExternalGenerators(generatorPath);
    } catch (err) {
      logger.error({ path: generatorPath, err }, "Failed to load external generators");
      return EXIT_USAGE;
    }
  }

  // Get generator
  const generator = getGenerator(generatorName);
  if (!generator) {
    logger.error(
      { name: generatorName },
      `Unknown generator. Available: ${getGeneratorNames().join(", ")}`,
    );
    return EXIT_USAGE;
  }

  if (!(await loadTransformPlugins(externalTransforms))) {
    return EXIT_USAGE;
  }

  logger.debug({ generator: generatorName }, "Running generator");

  // Load data
  const dictsPath = getDictsPath(config, root);
  const dictResult = dictsPath
    ? loadDictionaries(dictsPath, config.opentp)
    : { dictionaries: new Map<string, (string | number | boolean)[]>(), issues: [] };
  const dictionaries = dictResult.dictionaries;
  const eventsPath = getEventsPath(config, root);
  const eventsTemplate = getEventsTemplate(config);

  if (!eventsPath || !eventsTemplate) {
    logger.error("Events path not configured");
    return EXIT_USAGE;
  }

  const { events, issues: eventIssues } = loadEvents(eventsPath, eventsTemplate, config);
  logger.debug({ count: events.length, issues: eventIssues.length }, "Events loaded");

  // Generate does not validate events, but refuses to export a plan that could not be loaded
  // completely: opentp.yaml configuration errors, dictionary issues, or event files that failed
  // to load. The problems go to stderr so that stdout stays clean.
  const loadErrors = [
    ...configIssuesToErrors(validateConfig(config)),
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

  // Run generator
  try {
    const result = await generator.generate({
      config,
      events,
      dictionaries,
      options: generatorOptions,
    });

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

    return EXIT_OK;
  } catch (err) {
    logger.error({ error: (err as Error).message }, "Generator failed");
    return EXIT_FAILURE;
  }
}

/**
 * Serves the plan over MCP on stdin/stdout until the client closes stdin. The plan must load at
 * start (exit 2 otherwise, like the other commands); later changes are picked up per request, and a
 * plan that becomes unloadable is reported by every tool instead of stopping the server.
 */
async function runMcp(options: CliOptions): Promise<number> {
  const { verbose, externalRules, externalTransforms } = options;
  const root = path.resolve(options.root);

  if (verbose) {
    setLogLevel("debug");
  }

  const config = loadProjectConfig(root);
  if (typeof config === "number") {
    return config;
  }

  // From here on stdout belongs to the protocol: plugins are imported and the plan is loaded next,
  // and anything they print must not reach it
  reserveStdoutForProtocol();

  if (!(await loadTransformPlugins(externalTransforms))) {
    return EXIT_USAGE;
  }

  const store = new PlanStore(root, { externalRules });
  try {
    const plan = await store.current();
    logger.debug({ events: plan.events.length }, "Plan loaded");
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    return EXIT_USAGE;
  }

  await serveMcpStdio(store);
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
