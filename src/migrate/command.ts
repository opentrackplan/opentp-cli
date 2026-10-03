/**
 * The `opentp migrate` command: runs the migration and prints the result. Changed and created
 * files go to stdout (one path per line); warnings, manual items, the summary and the next steps
 * go to stderr. With --json, stdout carries one document `{ changed, created, warnings, manual,
 * summary }` (plus `errors` when nothing could be written).
 */

import { logger, setLogLevel } from "../util/logger";
import { type Finding, type MigrateMode, type MigrateResult, migrate } from "./index";

export interface MigrateCommandOptions {
  root: string;
  cliConfig?: string;
  check: boolean;
  dryRun: boolean;
  json: boolean;
  verbose: boolean;
}

/** Findings shown per message before "... and N more" (all with --verbose) */
const SHOWN_PER_MESSAGE = 10;

function place(finding: Finding): string {
  return finding.path === "" ? finding.file : `${finding.file}: ${finding.path}`;
}

/** Prints findings grouped by message: the message once, then where it applies */
function printGrouped(findings: Finding[], level: "warn" | "error", verbose: boolean): void {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const group = groups.get(finding.message) ?? [];
    group.push(finding);
    groups.set(finding.message, group);
  }
  for (const [message, group] of groups) {
    if (group.length === 1) {
      logger[level](`${place(group[0])}: ${message}`);
      continue;
    }
    logger[level](`${message} (${group.length} places)`);
    const shown = verbose ? group : group.slice(0, SHOWN_PER_MESSAGE);
    for (const finding of shown) console.error(`    ${place(finding)}`);
    if (shown.length < group.length)
      console.error(`    ... and ${group.length - shown.length} more`);
  }
}

function jsonDocument(result: MigrateResult): string {
  return JSON.stringify(
    {
      changed: result.changed,
      created: result.created,
      warnings: result.warnings,
      manual: result.manual,
      summary: result.summary,
      ...(result.errors.length > 0 ? { errors: result.errors } : {}),
    },
    null,
    2,
  );
}

function printHuman(result: MigrateResult, mode: MigrateMode, verbose: boolean): void {
  if (result.errors.length > 0) {
    logger.error("Nothing was migrated (no file was written):");
    for (const error of result.errors) console.error(`    ${place(error)}: ${error.message}`);
    return;
  }

  for (const change of [...result.changed, ...result.created]) console.log(change.file);
  if (verbose) {
    for (const change of [...result.changed, ...result.created]) {
      logger.debug(
        { changes: change.changes, ...(change.outsideRoots ? { outsideRoots: true } : {}) },
        change.file,
      );
    }
  }

  printGrouped(result.warnings, "warn", verbose);
  if (result.nothingToMigrate) {
    logger.info(`✓ Nothing to migrate: the plan is on ${result.summary.to}`);
    return;
  }

  const { summary } = result;
  const outside = result.changed
    .filter((change) => change.outsideRoots)
    .map((change) => change.file);
  if (outside.length > 0) {
    logger.info(`Migrated outside the events and dictionaries roots: ${outside.join(", ")}`);
  }
  if (summary.movedBaseFields > 0) {
    logger.info(
      `${summary.movedBaseFields} base fields moved to spec.targets.all.schema (still part of every event)`,
    );
  }
  if (summary.catalog.fields > 0) {
    const slots =
      summary.catalog.slots.length > 0
        ? ` (added to complete slot families: ${summary.catalog.slots.join(", ")})`
        : "";
    logger.info(
      `${summary.catalog.fields} fields in the catalog spec.events.payload.schema${slots}`,
    );
  }
  if (summary.webhookBindings.length > 0) {
    logger.info(`Webhook checks bound in opentp.cli.yaml: ${summary.webhookBindings.join(", ")}`);
  }

  if (result.manual.length > 0) {
    logger.error(
      `${result.manual.length} problems to fix by hand (opentp validate will report them):`,
    );
    printGrouped(result.manual, "error", verbose);
  }

  const counts = {
    changed: summary.changed,
    created: summary.created,
    warnings: summary.warnings,
    manual: summary.manual,
  };
  if (mode === "check") {
    logger.error(counts, `Migration to ${summary.to} needed (run opentp migrate)`);
    return;
  }
  logger.info(
    counts,
    mode === "dry-run"
      ? `✓ Dry run (nothing written): migration to ${summary.to}`
      : `✓ Migrated to ${summary.to}`,
  );
  console.error("Next steps:");
  summary.nextSteps.forEach((step, index) => {
    console.error(`  ${index + 1}. ${step}`);
  });
}

/** Runs `opentp migrate`; returns the exit code */
export async function runMigrateCommand(options: MigrateCommandOptions): Promise<number> {
  if (options.verbose) setLogLevel("debug");
  const mode: MigrateMode = options.check ? "check" : options.dryRun ? "dry-run" : "write";
  const result = await migrate({ root: options.root, cliConfig: options.cliConfig, mode });

  if (result.exitCode === 2) {
    for (const line of (result.usageError ?? "Cannot migrate").split("\n")) logger.error(line);
    return 2;
  }
  if (options.json) {
    console.log(jsonDocument(result));
  } else {
    printHuman(result, mode, options.verbose);
  }
  return result.exitCode;
}
