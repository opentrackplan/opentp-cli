/**
 * The loaded tracking plan behind `opentp mcp`: loaded once, and reloaded only when a file changed.
 *
 * Every request calls PlanStore.current(), which compares the modification time and size of
 * opentp.yaml and of every file under the events and dictionaries roots with the last load. An agent
 * that edits an event file therefore sees its change in the next call, without a watcher.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  type ConfigIssue,
  findConfigFile,
  getDictsPath,
  getEventsPath,
  getEventsTemplate,
  loadConfig,
  validateConfig,
} from "../core/config";
import { type DictionaryIssue, loadDictionaries } from "../core/dict";
import { type EventLoadIssue, loadEvents } from "../core/event";
import { loadIssuesToErrors, validateEvents } from "../core/validator";
import type { OpenTPConfig, ResolvedEvent, ValidationError } from "../types";
import { scanDirectory } from "../util";
import { eventDocument, TrigramIndex } from "./search";

/** The plan cannot be loaded at all (opentp.yaml missing or invalid): every tool reports it */
export class PlanError extends Error {}

export interface PlanStoreOptions {
  /** --external-rules directories, used by validation */
  externalRules?: string[];
}

export type DictionaryValues = Map<string, (string | number | boolean)[]>;

/** One consistent load of the plan */
export class PlanSnapshot {
  /** Events by key; with duplicate keys the first loaded event wins (validation reports duplicates) */
  readonly byKey = new Map<string, ResolvedEvent>();
  private searchIndex?: TrigramIndex;
  private validationResult?: Promise<ValidationError[]>;

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
    private readonly externalRules: string[],
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

  /** Validation errors of the whole plan, exactly as `opentp validate` reports them (computed once) */
  validation(): Promise<ValidationError[]> {
    this.validationResult ??= validateEvents(
      this.events,
      this.config,
      this.dictionaries,
      this.externalRules,
    ).then((errors) => [...loadIssuesToErrors(this.dictIssues, this.eventIssues), ...errors]);
    return this.validationResult;
  }

  validateEvents(events: ResolvedEvent[]): Promise<ValidationError[]> {
    return validateEvents(events, this.config, this.dictionaries, this.externalRules);
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

  private load(): PlanSnapshot {
    const configPath = findConfigFile(this.root);
    if (!configPath) {
      throw new PlanError(`opentp.yaml not found in ${this.root}`);
    }

    let config: OpenTPConfig;
    try {
      config = loadConfig(configPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new PlanError(`${path.basename(configPath)} cannot be loaded: ${message}`);
    }

    const eventsPath = getEventsPath(config, this.root);
    const eventsTemplate = getEventsTemplate(config);
    if (!eventsPath || !eventsTemplate) {
      throw new PlanError("Events path not configured in opentp.yaml");
    }

    const dictsPath = getDictsPath(config, this.root);
    const { dictionaries, issues: dictIssues } = dictsPath
      ? loadDictionaries(dictsPath, config.opentp)
      : { dictionaries: new Map() as DictionaryValues, issues: [] as DictionaryIssue[] };
    const { events, issues: eventIssues } = loadEvents(eventsPath, eventsTemplate, config);

    return new PlanSnapshot(
      this.root,
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
      this.options.externalRules ?? [],
    );
  }

  /**
   * Modification time and size of opentp.yaml and of every file under the directories of `snapshot`
   * (a change to opentp.yaml reloads the plan, so new directories are picked up then)
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
