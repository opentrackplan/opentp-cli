/**
 * The loaded tracking plan behind `opentp mcp`: loaded once, and reloaded only when a file changed.
 *
 * Every request calls PlanStore.current(), which compares the modification time and size of
 * opentp.yaml, opentp.cli.yaml and every file under the events and dictionaries roots with the last
 * load. An agent that edits an event file therefore sees its change in the next call, without a
 * watcher. Plugins and the `mcp` section of opentp.cli.yaml are read once, when the server starts.
 *
 * In an application repository (opentp.cli.yaml with plan:) the plan is loaded from plan: the same
 * way as `opentp validate` does it (a git plan from the cache, the plan repository's tracker and
 * check settings merged in, no key checks); its files are watched in the plan's directory.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  type CheckEnvironment,
  getBindingProblems,
  type Severities,
  type ToolRuleId,
} from "../checks";
import {
  buildCheckEnvironment,
  CliConfigError,
  cliConfigCandidates,
  findApplicationFile,
  getSeverities,
  type LoadedCliConfig,
  loadCliConfig,
} from "../cliconfig";
import {
  completeApplication,
  type OpenedApplication,
  openApplication,
} from "../cliconfig/application";
import type { FetchPlanOptions } from "../cliconfig/plan-source";
import {
  getTrackerProblems,
  resolveTrackerBinding,
  type TrackerBinding,
} from "../cliconfig/tracker";
import {
  type ConfigIssue,
  findConfigFile,
  getDictsPath,
  getEventsPath,
  getEventsTemplate,
  getKeygenProblems,
  loadConfig,
  rootToolFiles,
  validateConfig,
} from "../core/config";
import { type DictionaryIssue, loadDictionaries } from "../core/dict";
import { type EventLoadIssue, loadEvents } from "../core/event";
import { OverlapIndex, overlapResults } from "../core/overlap";
import { loadIssuesToErrors, validateEvents } from "../core/validator";
import type { KeygenConfig, OpenTPConfig, ResolvedEvent, ValidationError } from "../types";
import { scanDirectory } from "../util";
import { eventDocument, TrigramIndex } from "./search";

/**
 * The plan cannot be loaded at all (opentp.yaml missing or invalid, opentp.cli.yaml unusable): every
 * tool reports it
 */
export class PlanError extends Error {}

export interface PlanStoreOptions {
  /** --cli-config (absolute); default: opentp.cli.yaml or opentp.cli.yml in the root */
  cliConfigPath?: string;
  /** --fail-on: tool rules reported as errors */
  failOn?: ToolRuleId[];
  /** checks.plugins were named but not loaded: rule bindings to them are not errors */
  checksPluginsSkipped?: boolean;
  /** Application repository mode: how a git plan is fetched (environment, git runner) */
  fetch?: FetchPlanOptions;
}

/** The result of validating draft events: webhook bindings are not run for drafts */
export interface DraftValidation {
  results: ValidationError[];
  skippedWebhooks: string[];
}

export type DictionaryValues = Map<string, (string | number | boolean)[]>;

/** One consistent load of the plan */
export class PlanSnapshot {
  /** Events by key; with duplicate keys the first loaded event wins (validation reports duplicates) */
  readonly byKey = new Map<string, ResolvedEvent>();
  private searchIndex?: TrigramIndex;
  private validationResult?: Promise<ValidationError[]>;
  private trackerBinding?: TrackerBinding | null;
  private overlaps?: OverlapIndex;

  constructor(
    readonly root: string,
    readonly configPath: string,
    readonly config: OpenTPConfig,
    readonly eventsPath: string,
    readonly eventsTemplate: string,
    readonly dictsPath: string | null,
    readonly dictionaries: DictionaryValues,
    readonly dictIssues: DictionaryIssue[],
    readonly events: ResolvedEvent[],
    readonly eventIssues: EventLoadIssue[],
    readonly configIssues: ConfigIssue[],
    /** opentp.cli.yaml, if there is one */
    readonly cli: LoadedCliConfig | null,
    /**
     * Keygen and tracker problems of opentp.cli.yaml (reported against "opentp.cli.yaml", or the plan
     * repository's file: ConfigIssue.file)
     */
    readonly cliIssues: ConfigIssue[],
    readonly severities: Severities,
  ) {
    // Sorted by file path: readdir order differs between platforms and runtimes
    this.events.sort((a, b) => (a.relativePath < b.relativePath ? -1 : 1));
    for (const event of this.events) {
      if (typeof event.key === "string" && !this.byKey.has(event.key)) {
        this.byKey.set(event.key, event);
      }
    }
  }

  /** A path relative to the project root, with `/` separators (for tool output) */
  projectPath(absolutePath: string): string {
    return path.relative(this.root, absolutePath).split(path.sep).join("/");
  }

  /** The events root relative to the project root, e.g. "events" */
  get eventsRoot(): string {
    return this.projectPath(this.eventsPath);
  }

  /**
   * Turns a file given by a client into a path relative to the events root: accepts paths relative
   * to the events root ("auth/login.yaml") or to the project root ("events/auth/login.yaml").
   */
  eventsRelativePath(file: string): string {
    const normalized = file.replace(/\\/g, "/").replace(/^\.\//, "");
    const prefix = `${this.eventsRoot}/`;
    if (this.eventsRoot !== "" && normalized.startsWith(prefix)) {
      return normalized.slice(prefix.length);
    }
    return normalized;
  }

  get search(): TrigramIndex {
    this.searchIndex ??= new TrigramIndex(this.events.map((event) => eventDocument(event)));
    return this.searchIndex;
  }

  /** keygen from opentp.cli.yaml (never in an application repository) */
  get keygen(): KeygenConfig | null {
    return this.cli?.config.keygen ?? null;
  }

  /** Application repository mode: `plan:` as written in opentp.cli.yaml */
  get pinnedPlan(): string | null {
    return this.cli?.application?.plan ?? null;
  }

  /** Key checks run in a plan repository, not in an application repository */
  get keyChecks(): boolean {
    return !this.cli?.application;
  }

  /** The predicates of the plan's events for comparing drafts with them (built once) */
  get overlapIndex(): OverlapIndex {
    this.overlaps ??= new OverlapIndex(this.events, this.config, {
      dictionaries: this.dictionaries,
    });
    return this.overlaps;
  }

  /**
   * Overlap warnings (or errors, by checks.severity.overlap and --fail-on) between a draft event and
   * the plan's events except the one at the draft's path, attached to the draft. Ignore entries of
   * either event apply; severity off computes nothing.
   */
  draftOverlaps(draft: ResolvedEvent): ValidationError[] {
    const severity = this.severities.overlap;
    if (severity === "off") return [];
    return overlapResults(this.overlapIndex.with(draft), severity);
  }

  /** The tracker binding of opentp.cli.yaml per target, or null without a tracker section */
  get tracker(): TrackerBinding | null {
    if (this.trackerBinding === undefined) {
      this.trackerBinding = resolveTrackerBinding(this.cli?.config.tracker, this.config);
    }
    return this.trackerBinding;
  }

  /** How check ids resolve: spec.checks plus the bindings of opentp.cli.yaml */
  checks(): CheckEnvironment {
    return buildCheckEnvironment(this.config, this.cli);
  }

  /**
   * Validation errors and warnings of the whole plan, exactly as `opentp validate` reports them
   * (computed once)
   */
  validation(): Promise<ValidationError[]> {
    this.validationResult ??= validateEvents(this.events, this.config, this.dictionaries, {
      keygen: this.keygen,
      tracker: this.cli?.config.tracker,
      trackerOrigin: this.cli?.application?.trackerOrigin,
      checks: this.checks(),
      severities: this.severities,
      keyChecks: this.keyChecks,
      pinnedPlan: this.pinnedPlan !== null,
    }).then((errors) => [...loadIssuesToErrors(this.dictIssues, this.eventIssues), ...errors]);
    return this.validationResult;
  }

  /**
   * Validates draft events against the plan. Webhook bindings are not run: a draft must not make
   * requests with values chosen by whoever wrote it.
   */
  async validateDrafts(events: ResolvedEvent[]): Promise<DraftValidation> {
    const checks = this.checks().withoutWebhooks();
    const results = await validateEvents(events, this.config, this.dictionaries, {
      keygen: this.keygen,
      tracker: this.cli?.config.tracker,
      trackerOrigin: this.cli?.application?.trackerOrigin,
      checks,
      severities: this.severities,
      keyChecks: this.keyChecks,
      pinnedPlan: this.pinnedPlan !== null,
    });
    return { results, skippedWebhooks: [...checks.skippedWebhooks].sort() };
  }
}

export class PlanStore {
  private cached?: { signature: string; snapshot: PlanSnapshot };

  constructor(
    readonly root: string,
    private readonly options: PlanStoreOptions = {},
  ) {}

  /**
   * The current plan, reloaded when any file of it changed since the last call.
   * @throws PlanError when opentp.yaml is missing or cannot be loaded
   */
  async current(): Promise<PlanSnapshot> {
    const previous = this.cached;
    const signature = this.signature(previous?.snapshot);
    if (previous && previous.signature === signature) {
      return previous.snapshot;
    }
    const snapshot = this.load();
    // Keep the signature taken before loading when the directories did not move, so that a file
    // changed during the load triggers another load next time; otherwise (the first load, or new
    // roots in opentp.yaml) take it now, over the new directories.
    const sameDirectories =
      previous !== undefined &&
      previous.snapshot.eventsPath === snapshot.eventsPath &&
      previous.snapshot.dictsPath === snapshot.dictsPath;
    this.cached = { snapshot, signature: sameDirectories ? signature : this.signature(snapshot) };
    return snapshot;
  }

  /**
   * Application repository mode, first step (the application file and the plan's location)
   * @throws PlanError
   */
  private openApplication(file: string): OpenedApplication {
    try {
      return openApplication(file, this.root, this.options.fetch);
    } catch (error) {
      if (error instanceof CliConfigError) throw new PlanError(error.lines.join("\n"));
      throw error;
    }
  }

  private load(): PlanSnapshot {
    // Application repository mode: the plan is the one that plan: names
    let applicationFile: string | null;
    try {
      applicationFile = findApplicationFile(this.root, this.options.cliConfigPath);
    } catch (error) {
      if (error instanceof CliConfigError) throw new PlanError(error.lines.join("\n"));
      throw error;
    }
    const opened = applicationFile === null ? null : this.openApplication(applicationFile);
    const planRoot = opened?.planRoot ?? this.root;

    const configPath = findConfigFile(planRoot);
    if (!configPath) {
      throw new PlanError(`opentp.yaml not found in ${planRoot}`);
    }

    let config: OpenTPConfig;
    try {
      config = loadConfig(configPath, { pinnedPlan: opened?.plan });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new PlanError(`${path.basename(configPath)} cannot be loaded: ${message}`);
    }

    let cli: LoadedCliConfig | null;
    try {
      cli = opened
        ? completeApplication(opened, { planVersion: config.opentp })
        : loadCliConfig(this.root, {
            explicitPath: this.options.cliConfigPath,
            planVersion: config.opentp,
          });
    } catch (error) {
      if (error instanceof CliConfigError) throw new PlanError(error.lines.join("\n"));
      throw error;
    }
    // The plugins of a plan repository never run in an application repository
    const planPlugins = (cli?.application?.planPlugins.length ?? 0) > 0;
    const bindingProblems = getBindingProblems(
      cli?.config.checks?.bindings ?? {},
      config.spec.checks,
      { pluginsSkipped: this.options.checksPluginsSkipped || planPlugins },
    );
    if (bindingProblems.length > 0) {
      throw new PlanError(
        bindingProblems.map((problem) => `opentp.cli.yaml: ${problem}`).join("\n"),
      );
    }
    const keygen = cli?.config.keygen ?? null;

    const eventsPath = getEventsPath(config, planRoot);
    const eventsTemplate = getEventsTemplate(config);
    if (!eventsPath || !eventsTemplate) {
      throw new PlanError("Events path not configured in opentp.yaml");
    }

    const skipFiles = rootToolFiles(planRoot);
    const dictsPath = getDictsPath(config, planRoot);
    const { dictionaries, issues: dictIssues } = dictsPath
      ? loadDictionaries(dictsPath, config.opentp, { skipFiles, pinnedPlan: opened !== null })
      : { dictionaries: new Map() as DictionaryValues, issues: [] as DictionaryIssue[] };
    const { events, issues: eventIssues } = loadEvents(eventsPath, eventsTemplate, config, {
      keygen,
      skipFiles,
    });

    return new PlanSnapshot(
      planRoot,
      configPath,
      config,
      eventsPath,
      eventsTemplate,
      dictsPath,
      dictionaries,
      dictIssues,
      events,
      eventIssues,
      validateConfig(config),
      cli,
      [
        ...getKeygenProblems(keygen, config),
        ...getTrackerProblems(cli?.config.tracker, config, cli?.application?.trackerOrigin),
      ],
      getSeverities(cli, this.options.failOn),
    );
  }

  /**
   * Modification time and size of opentp.yaml, opentp.cli.yaml and every file under the directories
   * of `snapshot` (a change to opentp.yaml reloads the plan, so new directories are picked up then).
   * In an application repository also the plan's opentp.yaml and opentp.cli.yaml.
   */
  private signature(snapshot: PlanSnapshot | undefined): string {
    const parts: string[] = [];
    const stat = (file: string): void => {
      try {
        const info = fs.statSync(file);
        parts.push(`${file}\0${info.mtimeMs}\0${info.size}`);
      } catch {
        parts.push(`${file}\0missing`);
      }
    };

    const configPath = findConfigFile(this.root);
    if (configPath) stat(configPath);
    else parts.push("no-config");
    for (const file of cliConfigCandidates(this.root, this.options.cliConfigPath)) stat(file);

    if (snapshot && path.resolve(snapshot.root) !== path.resolve(this.root)) {
      // The plan of an application repository
      parts.push(`plan\0${snapshot.root}`);
      stat(snapshot.configPath);
      for (const file of cliConfigCandidates(snapshot.root)) stat(file);
    }

    if (snapshot) {
      for (const dir of [snapshot.eventsPath, snapshot.dictsPath]) {
        if (!dir) continue;
        parts.push(`dir\0${dir}`);
        for (const file of [...scanDirectory(dir).values()].sort()) stat(file);
      }
    }
    return parts.join("\n");
  }
}
