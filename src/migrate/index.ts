/**
 * `opentp migrate`: upgrades a 2026-01 tracking plan to 2026-09 (see docs/migrate.md).
 *
 * Every edit is computed in memory first. If a file cannot be parsed, a directory cannot be read,
 * or the plan cannot be migrated correctly (a migrated text that does not load again, an alias
 * whose anchor an edit moves or removes), nothing is written. Writes go through a temporary file
 * and a rename (a symbolic link is kept: its target is written), event and dictionary files first,
 * then opentp.cli.yaml, then opentp.yaml: while opentp.yaml still says 2026-01 a run can be
 * repeated, and it finishes the job (files already on 2026-09 are kept).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Document, Pair } from "yaml";
import {
  CliConfigError,
  findCliConfigFile,
  readCliConfig,
  webhookShapeProblems,
} from "../cliconfig";
import { PREVIOUS_SPEC_VERSION, resolvePath } from "../core/config";
import { SPEC_VERSION } from "../meta";
import { formatLoadError, isYamlMapping } from "../util";
import { mergeKeyPaths, unresolvedAliases } from "./aliases";
import {
  type Analysis,
  analyzePreviousPlan,
  type BaseView,
  baseViewOf,
  dictionaryType,
  movedPath,
  unknownWebhookSettingMessage,
  WEBHOOK_ID_PREFIX,
  WebhookIds,
} from "./analysis";
import { buildCliConfig, type ExistingCliConfig, existingWebhooks } from "./cli-config";
import { type ConfigMigration, MigrationError, migrateConfigFile } from "./config";
import { migrateEventFile } from "./events";
import { type FileChange, type FileKind, type Finding, Findings } from "./report";
import { isInside, parseYaml, relativePath, type ScannedFile, scanPlan } from "./scan";
import { EditError } from "./text";
import { type VerifyResult, verifyMigratedPlan } from "./verify";

export type { FileChange, Finding } from "./report";

export type MigrateMode = "write" | "dry-run" | "check";

export interface MigrateOptions {
  /** Plan root */
  root: string;
  /** --cli-config: opentp.cli.yaml to read and update instead of the one in the plan root */
  cliConfig?: string;
  mode: MigrateMode;
  /** Base for a relative --cli-config (default: the current directory) */
  cwd?: string;
}

export interface MigrateSummary {
  from: string;
  to: string;
  mode: MigrateMode;
  /** Whether files were written (false for --dry-run, --check and failures) */
  written: boolean;
  changed: number;
  created: number;
  warnings: number;
  manual: number;
  catalog: { fields: number; slots: string[] };
  movedBaseFields: number;
  webhookBindings: string[];
  keygenMoved: boolean;
  nextSteps: string[];
}

export interface MigrateResult {
  /** 0 done (or nothing to do), 1 --check found work or the plan cannot be migrated, 2 usage */
  exitCode: 0 | 1 | 2;
  /** Why the run stopped with exit code 2 */
  usageError?: string;
  /** Why nothing was written (files that cannot be parsed, conflicts) */
  errors: Finding[];
  changed: FileChange[];
  created: FileChange[];
  warnings: Finding[];
  manual: Finding[];
  summary: MigrateSummary;
  /** No file had to change */
  nothingToMigrate: boolean;
}

export const NEXT_STEPS = [
  'Run "opentp validate" and fix what it reports (the manual items, if any).',
  "Bump every pinned opentp (OPENTP_VERSION, CI images, the cli range in opentp.cli.yaml) to 0.10.x in the same commit.",
];

const CONFIG_FILENAMES = ["opentp.yaml", "opentp.yml"];

/** `checks` ids written anywhere in a document, for webhook ids already in use */
function referencedCheckIds(data: unknown, out: Set<string>): void {
  if (Array.isArray(data)) {
    for (const item of data) referencedCheckIds(item, out);
    return;
  }
  if (!isYamlMapping(data)) return;
  for (const [key, value] of Object.entries(data)) {
    if (key === "checks" && isYamlMapping(value)) {
      for (const id of Object.keys(value)) if (id.startsWith(WEBHOOK_ID_PREFIX)) out.add(id);
    }
    referencedCheckIds(value, out);
  }
}

function emptyResult(mode: MigrateMode): MigrateResult {
  return {
    exitCode: 0,
    errors: [],
    changed: [],
    created: [],
    warnings: [],
    manual: [],
    nothingToMigrate: false,
    summary: {
      from: PREVIOUS_SPEC_VERSION,
      to: SPEC_VERSION,
      mode,
      written: false,
      changed: 0,
      created: 0,
      warnings: 0,
      manual: 0,
      catalog: { fields: 0, slots: [] },
      movedBaseFields: 0,
      webhookBindings: [],
      keygenMoved: false,
      nextSteps: [],
    },
  };
}

function usage(mode: MigrateMode, message: string): MigrateResult {
  return { ...emptyResult(mode), exitCode: 2, usageError: message };
}

/** Nothing is written: the lists of changes are dropped, the errors say why */
function failure(result: MigrateResult, errors: Finding[]): MigrateResult {
  return { ...result, exitCode: 1, errors, changed: [], created: [] };
}

/** The type of the values of every dictionary under the dictionaries root, by dictionary path */
function dictionaryTypesOf(files: ScannedFile[], dictsRoot: string | null): Map<string, string> {
  const types = new Map<string, string>();
  if (dictsRoot === null) return types;
  for (const file of files) {
    if (file.kind !== "dictionary" || !isInside(dictsRoot, file.abs)) continue;
    const key = path
      .relative(dictsRoot, file.abs)
      .split(path.sep)
      .join("/")
      .replace(/\.ya?ml$/i, "");
    const type = dictionaryType(file.data);
    if (type !== null && !types.has(key)) types.set(key, type);
  }
  return types;
}

/** Merge keys are not supported (YAML 1.2): what migrate lists under manual */
export const MERGE_KEY_MESSAGE =
  "YAML merge keys (<<) are not supported (2026-09 is YAML 1.2, where << is an ordinary key): write the merged keys out in this mapping";

/** Whether a path exists, as a file, a directory or a symbolic link (also a broken one) */
function pathExists(file: string): boolean {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

/** Why the run stopped while edits were computed */
function planningError(error: unknown, file: string): Finding {
  if (error instanceof MigrationError) {
    return { file: error.file ?? file, path: error.path, message: error.message };
  }
  if (error instanceof EditError) {
    return {
      file,
      path: "",
      message: `Cannot be edited automatically (${error.message}): write it as a plain block mapping and run opentp migrate again`,
    };
  }
  return {
    file,
    path: "",
    message: `Internal error (${formatLoadError(error)}); nothing was written. Please report this with the original file`,
  };
}

/**
 * Writes a file through a temporary file in the same directory and a rename. A symbolic link (to
 * the file, or to a directory on its path) is kept: the file it points to is written.
 */
function writeAtomically(target: string, text: string): void {
  let file = target;
  try {
    file = fs.realpathSync(target);
  } catch {
    file = target;
  }
  const directory = path.dirname(file);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.opentp-migrate-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`,
  );
  let mode: number | undefined;
  try {
    mode = fs.statSync(file).mode;
  } catch {
    mode = undefined;
  }
  try {
    fs.writeFileSync(temporary, text, {
      encoding: "utf-8",
      ...(mode !== undefined ? { mode } : {}),
    });
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

/** Runs the migration (see the module comment) */
export async function migrate(options: MigrateOptions): Promise<MigrateResult> {
  const root = path.resolve(options.root);
  const { mode } = options;
  const result = emptyResult(mode);
  const findings = new Findings();
  const errors: Finding[] = [];

  // opentp.cli.yaml (optional) first: an application repository (plan:) has no plan to migrate
  let existingCli: ExistingCliConfig | null = null;
  let cliAbs: string;
  try {
    const found = findCliConfigFile(root, options.cliConfig, options.cwd ?? process.cwd());
    cliAbs = found ?? path.join(root, "opentp.cli.yaml");
  } catch (error) {
    return usage(mode, error instanceof Error ? error.message : String(error));
  }
  const cliRel = relativePath(root, cliAbs);
  if (fs.existsSync(cliAbs)) {
    const text = fs.readFileSync(cliAbs, "utf-8");
    const parsed = parseYaml(text);
    if (parsed.error !== null) {
      errors.push({ file: cliRel, path: "", message: parsed.error });
    } else {
      const data = parsed.data;
      if (isYamlMapping(data) && Object.hasOwn(data, "plan")) {
        return usage(
          mode,
          "migrate edits the plan repository; run it there (opentp.cli.yaml has plan:)",
        );
      }
      // migrate merges into the file: its shape must be right first (as for every other command)
      try {
        readCliConfig(cliAbs);
      } catch (error) {
        if (error instanceof CliConfigError) return usage(mode, error.lines.join("\n"));
        throw error;
      }
      existingCli = { rel: cliRel, text, doc: parsed.doc, data: isYamlMapping(data) ? data : {} };
    }
  }

  // opentp.yaml: exactly one, version first
  const configNames = CONFIG_FILENAMES.filter((name) => fs.existsSync(path.join(root, name)));
  if (configNames.length === 0) return usage(mode, `opentp.yaml not found in ${root}`);
  if (configNames.length > 1) {
    return usage(mode, `Both opentp.yaml and opentp.yml exist in ${root}; keep one`);
  }
  const configRel = configNames[0];
  const configAbs = path.join(root, configRel);
  const configText = fs.readFileSync(configAbs, "utf-8");
  const parsedConfig = parseYaml(configText);
  let configData: Record<string, unknown> | null = null;
  if (parsedConfig.error !== null) {
    errors.push({ file: configRel, path: "", message: parsedConfig.error });
  } else {
    const data = parsedConfig.data;
    if (!isYamlMapping(data))
      return usage(mode, `${configRel}: expected a mapping with 'opentp', 'info' and 'spec'`);
    configData = data;
    const version = data.opentp;
    if (typeof version !== "string" || version.length === 0) {
      return usage(mode, `${configRel}: missing required field: opentp`);
    }
    if (version !== PREVIOUS_SPEC_VERSION && version !== SPEC_VERSION) {
      return usage(
        mode,
        `This plan uses OpenTrackPlan ${version}; opentp migrate upgrades ${PREVIOUS_SPEC_VERSION} plans to ${SPEC_VERSION}`,
      );
    }
  }

  // Every YAML file of the plan
  const paths = isYamlMapping(configData?.spec) ? configData.spec.paths : undefined;
  const rootOf = (key: "events" | "dictionaries"): string | null => {
    const entry = isYamlMapping(paths) ? paths[key] : undefined;
    const dir = isYamlMapping(entry) ? entry.root : undefined;
    return typeof dir === "string" ? resolvePath(root, dir) : null;
  };
  const eventsRoot = rootOf("events");
  const dictsRoot = rootOf("dictionaries");
  // The events root must exist (as for validate); a dictionaries root is optional
  if (eventsRoot !== null && !pathExists(eventsRoot)) {
    errors.push({
      file: configRel,
      path: "spec.paths.events.root",
      message: `Events directory not found: ${eventsRoot}`,
    });
  }
  const scan = scanPlan(
    root,
    [eventsRoot, dictsRoot].filter((dir): dir is string => dir !== null && pathExists(dir)),
  );
  errors.push(...scan.unparsable.map((file) => ({ ...file, path: "" })));
  if (errors.length > 0 || configData === null) return failure(result, errors);
  for (const dir of scan.skippedDirectories) {
    findings.warn(
      dir.file,
      "",
      `Cannot read this directory (${dir.message}): skipped; a 2026-01 file in it would not be migrated`,
    );
  }
  for (const file of scan.skipped) {
    findings.warn(file.file, "", `Cannot be loaded (${file.message}): skipped (not a plan file)`);
  }
  for (const link of scan.symlinks) {
    findings.warn(
      link,
      "",
      "Symbolic link: not followed or migrated (migrate the file it points to)",
    );
  }
  for (const { link, target } of scan.linkedTwice) {
    findings.warn(link, "", `Symbolic link to ${target}: migrated as that file (the link stays)`);
  }
  for (const link of scan.directoryLinks) {
    findings.warn(
      link,
      "",
      "Symbolic link to a directory: not followed or migrated (opentp validate does not read it either)",
    );
  }

  const configVersion = configData.opentp as string;
  const eventFiles: ScannedFile[] = [];
  const toMigrate: ScannedFile[] = [];
  const referenced = new Set<string>();
  if (configVersion === SPEC_VERSION) referencedCheckIds(configData, referenced);
  for (const file of scan.files) {
    const known = file.version === PREVIOUS_SPEC_VERSION || file.version === SPEC_VERSION;
    if (file.kind === "other") {
      if (file.version === PREVIOUS_SPEC_VERSION) {
        const both =
          isYamlMapping(file.data) &&
          Object.hasOwn(file.data, "event") &&
          Object.hasOwn(file.data, "dict");
        findings.warn(
          file.rel,
          "",
          both
            ? "Has opentp: 2026-01 and both an event and a dict key: not migrated"
            : "Has opentp: 2026-01 but no event or dict key: not migrated",
        );
      }
      continue;
    }
    if (!known) {
      findings.warn(
        file.rel,
        "opentp",
        `opentp: ${file.version} is not ${PREVIOUS_SPEC_VERSION}: not migrated`,
      );
      continue;
    }
    if (file.kind === "event") eventFiles.push(file);
    if (file.version === PREVIOUS_SPEC_VERSION) toMigrate.push(file);
    else referencedCheckIds(file.data, referenced);
  }

  const configFile: ScannedFile = {
    rel: configRel,
    abs: configAbs,
    text: configText,
    doc: parsedConfig.doc,
    data: configData,
    kind: "other",
    version: configVersion,
  };

  if (toMigrate.length === 0 && configVersion === SPEC_VERSION) {
    return {
      ...result,
      nothingToMigrate: true,
      warnings: findings.warnings,
      summary: { ...result.summary, warnings: findings.warnings.length },
    };
  }

  // Webhook ids: first seen in files sorted by relative path, then in document order
  const webhooks = new WebhookIds(existingWebhooks(existingCli), referenced);
  const migrated = [...toMigrate, ...(configVersion === PREVIOUS_SPEC_VERSION ? [configFile] : [])];
  const withWebhooks = [...migrated].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  // Plan-wide decisions, then every file in memory. Any problem stops the run: nothing is written
  const texts = new Map<string, string>();
  let analysis: Analysis | null = null;
  let view: BaseView;
  let configMigration: ConfigMigration | null = null;
  let cliOutput: ReturnType<typeof buildCliConfig> = null;
  let current = configRel;
  try {
    for (const file of withWebhooks) {
      current = file.rel;
      webhooks.collect(file);
    }
    for (const { source, key } of webhooks.dropped) {
      findings.warn(source.file.rel, `${source.path}.${key}`, unknownWebhookSettingMessage(key));
    }
    // A configuration that cannot become a binding is fixed where it is written
    const webhookProblems = webhooks.shapeProblems(webhookShapeProblems);
    if (webhookProblems.length > 0) return failure(result, webhookProblems);

    // YAML merge keys: listed, the rest of the file is migrated
    for (const file of migrated) {
      for (const place of mergeKeyPaths(file.doc)) {
        const where =
          file === configFile
            ? movedPath(place)
            : file.kind === "event"
              ? place.replace(/^event\./, "")
              : place;
        findings.manualItem(file.rel, where, MERGE_KEY_MESSAGE);
      }
    }

    current = configRel;
    if (configVersion === PREVIOUS_SPEC_VERSION) {
      // Event files outside the events root (skeletons) are not events of the plan
      const skeletons = new Set(
        eventFiles.filter((file) => !isInside(eventsRoot, file.abs)).map((file) => file.rel),
      );
      analysis = analyzePreviousPlan(configData, eventFiles, findings, {
        configFile: configRel,
        skeletons,
        dictionaryTypes: dictionaryTypesOf(scan.files, dictsRoot),
      });
      view = analysis.view;
      configMigration = migrateConfigFile(configFile, analysis, webhooks.ids, findings);
    } else {
      view = baseViewOf(configData);
    }

    const ids: Map<Pair, string> = webhooks.ids;
    for (const file of toMigrate) {
      current = file.rel;
      const migratedFile = migrateEventFile(file, {
        config: configData,
        view,
        webhookIds: ids,
        findings,
      });
      if (migratedFile.text !== file.text) {
        texts.set(file.rel, migratedFile.text);
        const outsideRoots =
          file.kind === "event" ? !isInside(eventsRoot, file.abs) : !isInside(dictsRoot, file.abs);
        result.changed.push({
          file: file.rel,
          kind: file.kind as FileKind,
          ...(outsideRoots ? { outsideRoots: true as const } : {}),
          changes: migratedFile.notes.lines(),
        });
      }
    }

    current = cliRel;
    cliOutput = buildCliConfig(existingCli, configMigration?.keygen ?? null, webhooks.added);
  } catch (error) {
    return failure(result, [planningError(error, current)]);
  }

  if (cliOutput) {
    texts.set(cliRel, cliOutput.text);
    const change: FileChange = {
      file: cliRel,
      kind: "cli-config",
      changes: cliOutput.notes.lines(),
    };
    if (existingCli) result.changed.push(change);
    else result.created.push(change);
  }
  if (configMigration && configMigration.text !== configText) {
    texts.set(configRel, configMigration.text);
    result.changed.push({
      file: configRel,
      kind: "config",
      changes: configMigration.notes.lines(),
    });
  }

  // Every migrated text must load again: an alias whose anchor an edit moved after it or removed
  // is named with both places; anything else is a bug in an edit. Either way nothing is written
  const originals = new Map<string, Document.Parsed>([
    ...toMigrate.map((file): [string, Document.Parsed] => [file.rel, file.doc]),
    [configRel, parsedConfig.doc],
    ...(existingCli ? [[cliRel, existingCli.doc] as [string, Document.Parsed]] : []),
  ]);
  const broken: Finding[] = [];
  for (const [file, text] of texts) {
    const { error } = parseYaml(text);
    if (error === null) continue;
    const aliases = unresolvedAliases(file, originals.get(file) ?? null, text);
    if (aliases.length > 0) {
      broken.push(...aliases);
      continue;
    }
    broken.push({
      file,
      path: "",
      message: `The migrated text cannot be parsed (${error}); nothing was written. Please report this with the original file`,
    });
  }
  if (broken.length > 0) return failure(result, broken);

  // What validate will still report
  const cliText = texts.get(cliRel) ?? existingCli?.text;
  let verified: VerifyResult;
  try {
    verified = await verifyMigratedPlan({
      root,
      config: { rel: configRel, text: texts.get(configRel) ?? configText },
      cli: cliText !== undefined ? { rel: cliRel, text: cliText } : null,
      texts,
      planDirs: [eventsRoot, dictsRoot].filter((dir): dir is string => dir !== null),
    });
  } catch (error) {
    return failure(result, [planningError(error, configRel)]);
  }
  if (verified.fatal.length > 0) return failure(result, verified.fatal);
  // Migrate's own items first (they say why), then everything validate reports; a merge key that
  // migrate listed is not listed again
  const mergeKeyFiles = new Set(
    findings.manual.filter((item) => item.message === MERGE_KEY_MESSAGE).map((item) => item.file),
  );
  const manual = verified.manual.filter(
    (item) => !(mergeKeyFiles.has(item.file) && item.path.endsWith("<<")),
  );
  manual.unshift(...findings.manual);
  // Ids of webhook checks with no binding (for example after an interrupted earlier run)
  const bound = new Set([
    ...existingWebhooks(existingCli).keys(),
    ...webhooks.added.map((b) => b.id),
  ]);
  for (const id of [...referenced].sort()) {
    if (!bound.has(id)) {
      manual.push({
        file: cliRel,
        path: `checks.bindings.${id}`,
        message: `The plan refers to the check '${id}' but opentp.cli.yaml does not bind it (an interrupted earlier run?): add its webhook binding`,
      });
    }
  }

  const nothingToMigrate = texts.size === 0;
  result.nothingToMigrate = nothingToMigrate;
  result.warnings = findings.warnings;
  result.manual = nothingToMigrate ? [] : manual;

  if (mode === "write" && !nothingToMigrate) {
    const order = [
      ...result.changed.filter((change) => change.kind === "event" || change.kind === "dictionary"),
      ...[...result.created, ...result.changed].filter((change) => change.kind === "cli-config"),
      ...result.changed.filter((change) => change.kind === "config"),
    ];
    for (const change of order) {
      const text = texts.get(change.file) as string;
      const abs = change.kind === "cli-config" ? cliAbs : path.join(root, change.file);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      writeAtomically(abs, text);
    }
    result.summary.written = true;
  }

  result.summary = {
    ...result.summary,
    changed: result.changed.length,
    created: result.created.length,
    warnings: result.warnings.length,
    manual: result.manual.length,
    catalog: {
      fields: analysis?.catalog.entries.length ?? 0,
      slots: analysis?.catalog.slots ?? [],
    },
    movedBaseFields: configMigration?.movedFields ?? 0,
    webhookBindings: webhooks.added.map((binding) => binding.id),
    keygenMoved: configMigration?.keygen != null,
    nextSteps: nothingToMigrate ? [] : NEXT_STEPS,
  };
  if (mode === "check" && !nothingToMigrate) result.exitCode = 1;
  return result;
}
