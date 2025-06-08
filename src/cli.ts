#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import * as process from "node:process";
import {
  findConfigFile,
  getDictsPath,
  getEventsPath,
  getEventsPattern,
  loadConfig,
} from "./core/config";
import { loadDictionaries } from "./core/dict";
import { loadEvents } from "./core/event";
import { formatErrors, validateEvents } from "./core/validator";
import type { GeneratorOptions } from "./generators";
import { getGenerator, getGeneratorNames, loadExternalGenerators } from "./generators";
import { loadExternalTransforms } from "./transforms";
import type { EventFile } from "./types";
import { loadYaml, saveYaml } from "./util/files";
import { logger, setLogLevel } from "./util/logger";

const VERSION = "0.1.0";

interface CliOptions {
  root: string;
  command: string;
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

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    root: process.env.OPENTP_ROOT || process.cwd(),
    command: "validate",
    fix: false,
    verbose: false,
    json: false,
    externalRules: [],
    externalTransforms: [],
    externalGenerators: [],
    generatorOptions: {},
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (
      arg === "validate" ||
      arg === "fix" ||
      arg === "export" ||
      arg === "help" ||
      arg === "version"
    ) {
      options.command = arg;
    } else if (arg === "generate") {
      options.command = "generate";
      // Next arg is the generator name (if not a flag)
      if (args[i + 1] && !args[i + 1].startsWith("-")) {
        options.generatorName = args[++i];
      }
    } else if (arg === "--fix" || arg === "-f") {
      options.fix = true;
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--root" || arg === "-r") {
      options.root = args[++i] || options.root;
    } else if (arg.startsWith("--root=")) {
      options.root = arg.slice(7);
    } else if (arg === "--external-rules") {
      const rulePath = args[++i];
      if (rulePath) {
        options.externalRules.push(rulePath);
      }
    } else if (arg.startsWith("--external-rules=")) {
      options.externalRules.push(arg.slice(17));
    } else if (arg === "--external-transforms") {
      const transformPath = args[++i];
      if (transformPath) {
        options.externalTransforms.push(transformPath);
      }
    } else if (arg.startsWith("--external-transforms=")) {
      options.externalTransforms.push(arg.slice(22));
    } else if (arg === "--external-generators") {
      const generatorPath = args[++i];
      if (generatorPath) {
        options.externalGenerators.push(generatorPath);
      }
    } else if (arg.startsWith("--external-generators=")) {
      options.externalGenerators.push(arg.slice(22));
    } else if (arg === "--output" || arg === "-o") {
      options.generatorOptions.output = args[++i];
    } else if (arg.startsWith("--output=")) {
      options.generatorOptions.output = arg.slice(9);
    } else if (arg === "--file") {
      options.generatorOptions.file = args[++i];
    } else if (arg.startsWith("--file=")) {
      options.generatorOptions.file = arg.slice(7);
    } else if (arg === "--pretty") {
      options.generatorOptions.pretty = true;
    } else if (arg === "--no-pretty") {
      options.generatorOptions.pretty = false;
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
OpenTrackPlan CLI v${VERSION}

Usage: opentp [command] [options]

Commands:
  validate              Validate events against opentp.yaml schema (default)
  fix                   Auto-fix event keys
  generate <name>       Generate output using a generator
  help                  Show this help message
  version               Show version

Generators:
  json                  Export events as JSON

Options:
  --root, -r <path>              Project root directory (default: current directory)
  --fix, -f                      Auto-fix issues (same as 'fix' command)
  --verbose, -v                  Verbose output
  --json                         Output results as JSON
  --external-rules <path>        Path to directory with custom rules (can be repeated)
  --external-transforms <path>   Path to directory with custom transforms (can be repeated)
  --external-generators <path>   Path to directory with custom generators (can be repeated)

Generator Options:
  --output, -o <path>            Output file path (default: stdout)
  --pretty / --no-pretty         Pretty print output (default: true)

Environment:
  OPENTP_ROOT         Alternative to --root option

Examples:
  opentp validate
  opentp validate --root ./my-project
  opentp fix
  opentp generate json
  opentp generate json --output ./events.json
`);
}

function printVersion(): void {
  console.log(`opentp v${VERSION}`);
}

async function runValidate(options: CliOptions): Promise<number> {
  const { root, verbose, json, fix, externalRules, externalTransforms } = options;

  // Set log level based on verbose flag
  if (verbose) {
    setLogLevel("debug");
  }

  // 1. Find and load config
  const configPath = findConfigFile(root);
  if (!configPath) {
    logger.error({ root }, "opentp.yaml not found");
    return 1;
  }

  logger.debug({ configPath }, "Loading config");
  const config = loadConfig(configPath);
  logger.debug({ title: config.info.title, version: config.info.version }, "Config loaded");

  // 2. Load external transforms (before loading events, since transforms are used there)
  const allTransformsPaths = [...(config.spec.external?.transforms ?? []), ...externalTransforms];

  for (const transformPath of allTransformsPaths) {
    try {
      logger.debug({ path: transformPath }, "Loading external transforms");
      await loadExternalTransforms(transformPath);
    } catch (err) {
      logger.error({ path: transformPath, err }, "Failed to load external transforms");
    }
  }

  // 3. Load dictionaries
  const dictsPath = getDictsPath(config, root);
  let dictionaries = new Map<string, (string | number | boolean)[]>();

  if (dictsPath) {
    logger.debug({ path: dictsPath }, "Loading dictionaries");
    dictionaries = loadDictionaries(dictsPath);
    logger.debug({ count: dictionaries.size }, "Dictionaries loaded");
  }

  // 4. Load events
  const eventsPath = getEventsPath(config, root);
  const eventsPattern = getEventsPattern(config);

  if (!eventsPath || !eventsPattern) {
    logger.error("Events path not configured in opentp.yaml");
    return 1;
  }

  logger.debug({ path: eventsPath, pattern: eventsPattern }, "Loading events");
  const events = loadEvents(eventsPath, eventsPattern, config);
  logger.debug({ count: events.length }, "Events loaded");

  // 5. If fix mode - fix keys
  if (fix) {
    let fixed = 0;
    for (const event of events) {
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

  // 6. Validate
  logger.debug("Starting validation");
  const errors = await validateEvents(events, config, dictionaries, externalRules);

  // 7. Output result
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
      logger.error({ errorCount: errors.length, eventCount: events.length }, "✗ Validation failed");
    }
  }

  return errors.length === 0 ? 0 : 1;
}

async function _runExport(options: CliOptions): Promise<number> {
  const { root, verbose } = options;

  if (verbose) {
    setLogLevel("debug");
  }

  // Load everything
  const configPath = findConfigFile(root);
  if (!configPath) {
    logger.error("opentp.yaml not found");
    return 1;
  }

  logger.debug({ configPath }, "Loading config");
  const config = loadConfig(configPath);

  const dictsPath = getDictsPath(config, root);
  const dictionaries = dictsPath ? loadDictionaries(dictsPath) : new Map();
  const eventsPath = getEventsPath(config, root);
  const eventsPattern = getEventsPattern(config);

  if (!eventsPath || !eventsPattern) {
    logger.error("Events path not configured");
    return 1;
  }

  const events = loadEvents(eventsPath, eventsPattern, config);
  logger.debug({ count: events.length }, "Exporting events");

  // Export
  const output = {
    opentp: config.opentp,
    info: config.info,
    events: events.map((e) => ({
      key: e.key,
      taxonomy: e.taxonomy,
      lifecycle: e.lifecycle,
      payload: e.payload,
    })),
    dictionaries: Object.fromEntries(dictionaries),
  };

  console.log(JSON.stringify(output, null, 2));
  return 0;
}

async function runGenerate(options: CliOptions): Promise<number> {
  const { root, verbose, generatorName, generatorOptions, externalGenerators } = options;

  if (verbose) {
    setLogLevel("debug");
  }

  // Check generator name
  if (!generatorName) {
    logger.error(
      `Generator name required. Available generators: ${getGeneratorNames().join(", ")}`,
    );
    return 1;
  }

  // Load external generators from config and CLI
  const configPath = findConfigFile(root);
  if (!configPath) {
    logger.error("opentp.yaml not found");
    return 1;
  }

  const config = loadConfig(configPath);

  const allGeneratorPaths = [
    ...((config.spec.external?.generators ?? []) as string[]),
    ...externalGenerators,
  ];

  for (const generatorPath of allGeneratorPaths) {
    try {
      logger.debug({ path: generatorPath }, "Loading external generators");
      await loadExternalGenerators(generatorPath);
    } catch (err) {
      logger.error({ path: generatorPath, err }, "Failed to load external generators");
    }
  }

  // Get generator
  const generator = getGenerator(generatorName);
  if (!generator) {
    logger.error(
      { name: generatorName },
      `Unknown generator. Available: ${getGeneratorNames().join(", ")}`,
    );
    return 1;
  }

  logger.debug({ generator: generatorName }, "Running generator");

  // Load data
  const dictsPath = getDictsPath(config, root);
  const dictionaries = dictsPath ? loadDictionaries(dictsPath) : new Map();
  const eventsPath = getEventsPath(config, root);
  const eventsPattern = getEventsPattern(config);

  if (!eventsPath || !eventsPattern) {
    logger.error("Events path not configured");
    return 1;
  }

  const events = loadEvents(eventsPath, eventsPattern, config);
  logger.debug({ count: events.length }, "Events loaded");

  // Run generator
  try {
    const result = await generator.generate({
      config,
      events,
      dictionaries,
      options: generatorOptions,
    });

    // Handle output
    if (result.stdout) {
      console.log(result.stdout);
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

    return 0;
  } catch (err) {
    logger.error({ error: (err as Error).message }, "Generator failed");
    return 1;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  let exitCode = 0;

  switch (options.command) {
    case "help":
      printHelp();
      break;

    case "version":
      printVersion();
      break;

    case "validate":
      exitCode = await runValidate(options);
      break;

    case "fix":
      options.fix = true;
      exitCode = await runValidate(options);
      break;

    case "export":
      // Legacy: export is now 'generate json'
      options.generatorName = "json";
      exitCode = await runGenerate(options);
      break;

    case "generate":
      exitCode = await runGenerate(options);
      break;

    default:
      logger.error({ command: options.command }, "Unknown command");
      printHelp();
      exitCode = 1;
  }

  process.exit(exitCode);
}

// Run CLI only if this is a direct script call
if (require.main === module || process.argv[1]?.includes("index")) {
  main().catch((error) => {
    logger.fatal({ error }, "Fatal error");
    process.exit(1);
  });
}
