/**
 * What `opentp validate` will still report after the migration (the `manual` list): the migrated
 * plan is written to a temporary directory (opentp.yaml, opentp.cli.yaml, the events and
 * dictionaries roots) and validated there with the validate pipeline. Webhook checks are not
 * called, key generation is not compared (it does not change), and overlap is not computed.
 * A migrated opentp.yaml or opentp.cli.yaml that cannot be loaded at all is `fatal`: nothing is
 * written then.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getBindingProblems } from "../checks";
import {
  buildCheckEnvironment,
  CLI_CONFIG_LABEL,
  CliConfigError,
  checkCliConfig,
  getSeverities,
  type LoadedCliConfig,
  readCliConfig,
} from "../cliconfig";
import {
  getDictsPath,
  getEventsPath,
  getEventsTemplate,
  loadConfig,
  rootToolFiles,
} from "../core/config";
import { loadDictionaries } from "../core/dict";
import { loadEvents } from "../core/event";
import { errorsOnly, loadIssuesToErrors, validateEvents } from "../core/validator";
import { filterByExtension, scanDirectory } from "../util";
import type { Finding } from "./report";

export interface VerifyInput {
  root: string;
  /** Relative path of opentp.yaml (or opentp.yml) and its migrated text */
  config: { rel: string; text: string };
  /** opentp.cli.yaml after the migration, if there is one */
  cli: { rel: string; text: string } | null;
  /** Migrated texts by path relative to the root */
  texts: Map<string, string>;
  /** The events and dictionaries roots (absolute; they may be outside the plan root) */
  planDirs: string[];
}

function toRel(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

/** The deepest directory that contains every path */
function commonAncestor(paths: string[]): string {
  let ancestor = path.resolve(paths[0]);
  for (const other of paths.slice(1).map((dir) => path.resolve(dir))) {
    while (ancestor !== path.dirname(ancestor) && toRel(ancestor, other).startsWith("..")) {
      ancestor = path.dirname(ancestor);
    }
  }
  return ancestor;
}

function realPathOf(file: string): string | null {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
}

/**
 * Copies the YAML files of a plan directory into the temporary plan, migrated where they change.
 * `byRealPath` holds the migrated texts by the real path of their file, for a symbolic link to a
 * file that is migrated under another path.
 */
function copyDirectory(
  input: VerifyInput,
  dir: string,
  tmp: string,
  copied: Set<string>,
  byRealPath: Map<string, string>,
): void {
  if (!fs.existsSync(dir)) return;
  for (const [, abs] of filterByExtension(scanDirectory(dir), [".yaml", ".yml"])) {
    const rel = toRel(input.root, abs);
    if (copied.has(rel)) continue;
    copied.add(rel);
    const destination = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const real = realPathOf(abs);
    const text = input.texts.get(rel) ?? (real === null ? undefined : byRealPath.get(real));
    if (text !== undefined) fs.writeFileSync(destination, text, "utf-8");
    else fs.copyFileSync(abs, destination);
  }
}

export interface VerifyResult {
  /** What validate reports (paths relative to the plan root) */
  manual: Finding[];
  /** opentp.yaml or opentp.cli.yaml cannot be loaded after the migration: write nothing */
  fatal: Finding[];
}

/** One line of a CliConfigError, without the file label (the finding names the file) */
function cliLine(line: string): string {
  return line.startsWith(`${CLI_CONFIG_LABEL}: `) ? line.slice(CLI_CONFIG_LABEL.length + 2) : line;
}

/** Validates the migrated plan */
export async function verifyMigratedPlan(input: VerifyInput): Promise<VerifyResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opentp-migrate-"));
  // The plan root sits as deep in the temporary directory as it does below the common ancestor of
  // the plan root and the events and dictionaries roots, so that `../events` stays inside
  const base = commonAncestor([input.root, ...input.planDirs]);
  const tmp = path.join(tmpDir, toRel(base, input.root));
  const findings: Finding[] = [];
  try {
    fs.mkdirSync(tmp, { recursive: true });
    const configPath = path.join(tmp, input.config.rel);
    fs.writeFileSync(configPath, input.config.text, "utf-8");
    let config: ReturnType<typeof loadConfig>;
    try {
      config = loadConfig(configPath);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        manual: [],
        fatal: [
          {
            file: input.config.rel,
            path: "",
            message: `The migrated file cannot be loaded (${reason}): fix it and run opentp migrate again`,
          },
        ],
      };
    }

    const eventsRel = toRel(tmp, getEventsPath(config, tmp) ?? tmp);
    const dictsPath = getDictsPath(config, tmp);
    const dictsRel = dictsPath ? toRel(tmp, dictsPath) : null;
    const copied = new Set<string>([input.config.rel]);
    const byRealPath = new Map<string, string>();
    for (const [rel, text] of input.texts) {
      const real = realPathOf(path.join(input.root, rel));
      if (real !== null) byRealPath.set(real, text);
    }
    copyDirectory(input, path.join(input.root, eventsRel), tmp, copied, byRealPath);
    if (dictsRel !== null) {
      copyDirectory(input, path.join(input.root, dictsRel), tmp, copied, byRealPath);
    }

    const cliRel = input.cli?.rel ?? "opentp.cli.yaml";
    let cli: LoadedCliConfig | null = null;
    if (input.cli) {
      const cliPath = path.join(tmp, "opentp.cli.yaml");
      fs.writeFileSync(cliPath, input.cli.text, "utf-8");
      try {
        cli = { path: cliPath, dir: tmp, config: readCliConfig(cliPath) };
      } catch (error) {
        const lines = error instanceof CliConfigError ? error.lines : [String(error)];
        return {
          manual: [],
          fatal: lines.map((line) => ({
            file: cliRel,
            path: "",
            message: `The migrated file is not valid (${cliLine(line)}): fix what migrate copies into it and run opentp migrate again`,
          })),
        };
      }
      // The header and the cli range: validate reports them; the rest of the plan is still checked
      try {
        checkCliConfig(cli.config, { planVersion: config.opentp });
      } catch (error) {
        const lines = error instanceof CliConfigError ? error.lines : [String(error)];
        for (const line of lines) findings.push({ file: cliRel, path: "", message: cliLine(line) });
      }
      for (const problem of getBindingProblems(
        cli?.config.checks?.bindings ?? {},
        config.spec.checks,
        {
          pluginsSkipped: true,
        },
      )) {
        findings.push({ file: cliRel, path: "", message: problem });
      }
    }

    const skipFiles = rootToolFiles(tmp);
    const dictionaries = dictsPath
      ? loadDictionaries(dictsPath, config.opentp, { skipFiles })
      : { dictionaries: new Map<string, (string | number | boolean)[]>(), issues: [] };
    const eventsPath = getEventsPath(config, tmp) as string;
    const template = getEventsTemplate(config) as string;
    const { events, issues } = loadEvents(eventsPath, template, config, {
      keygen: null,
      skipFiles,
    });
    const results = [
      ...loadIssuesToErrors(dictionaries.issues, issues),
      ...(await validateEvents(events, config, dictionaries.dictionaries, {
        keygen: null,
        checks: buildCheckEnvironment(config, cli).withoutWebhooks(),
        severities: { ...getSeverities(cli), overlap: "off" },
      })),
    ];

    const label = (event: string): string => {
      if (event === "opentp.yaml") return input.config.rel;
      if (event === "opentp.cli.yaml") return cliRel;
      if (event.startsWith("dictionaries/") && dictsRel !== null) {
        return path.posix.join(dictsRel, event.slice("dictionaries/".length));
      }
      return path.posix.join(eventsRel, event);
    };
    for (const error of errorsOnly(results)) {
      findings.push({ file: label(error.event), path: error.path, message: error.message });
    }
    return { manual: findings, fatal: [] };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
