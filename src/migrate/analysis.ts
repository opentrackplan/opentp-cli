/**
 * The plan-wide decisions of `opentp migrate`, made before any file is edited:
 * - the field catalog (fields events use that are not common fields of every target they cover),
 *   with types, conflicts and completed slot families;
 * - types for base fields that have none;
 * - what `valueRequired: true` on a base field becomes (`policy: fixed` or removed);
 * - binding ids of webhook checks.
 */

import { isAlias, isMap, isSeq, type Node, type Pair } from "yaml";
import { naturalCompare } from "../core/fields";
import { resolveEventPayload } from "../core/payload";
import type { OpenTPConfig } from "../types";
import { isYamlMapping } from "../util";
import {
  defaultTypeMessage,
  type Finding,
  type Findings,
  typeConflictMessage,
  valueRequiredNotPinnedMessage,
  valueRequiredSomeTargetsMessage,
} from "./report";
import type { ScannedFile } from "./scan";
import { keyOf } from "./text";

type Data = Record<string, unknown>;

/** A catalog entry written by migrate: `{ type }`, plus `items: { type }` for arrays */
export interface CatalogEntry {
  type: string;
  itemsType?: string;
}

/** The base layers as 2026-09 sees them, for types: catalog -> spec.targets.all -> spec.targets.<T> */
export interface BaseView {
  targets: string[];
  catalog: Record<string, Data>;
  all: Record<string, Data>;
  byTarget: Record<string, Record<string, Data>>;
}

export const CATALOG_PATH = "spec.events.payload.schema";

/** Where the old base fields of a 2026-01 plan go */
export const COMMON_ALL_PATH = "spec.targets.all.schema";

/** The path of a base definition after the migration (old base fields move to spec.targets.all) */
export function movedPath(site: string): string {
  return site.startsWith(`${CATALOG_PATH}.`)
    ? `${COMMON_ALL_PATH}${site.slice(CATALOG_PATH.length)}`
    : site;
}

function mapping(value: unknown): Data {
  return isYamlMapping(value) ? value : {};
}

function definitions(value: unknown): Record<string, Data> {
  const out: Record<string, Data> = {};
  for (const [name, definition] of Object.entries(mapping(value))) {
    if (isYamlMapping(definition)) out[name] = definition;
  }
  return out;
}

/** The target ids of spec.events.payload.targets.all */
export function targetsOf(config: Data): string[] {
  const all = mapping(mapping(mapping(mapping(config.spec).events).payload).targets).all;
  return Array.isArray(all) ? [...new Set(all.filter((id) => typeof id === "string"))] : [];
}

/** The base layers of a 2026-09 opentp.yaml */
export function baseViewOf(config: Data): BaseView {
  const spec = mapping(config.spec);
  const specTargets = mapping(spec.targets);
  const byTarget: Record<string, Record<string, Data>> = {};
  for (const [id, target] of Object.entries(specTargets)) {
    if (id !== "all") byTarget[id] = definitions(mapping(target).schema);
  }
  return {
    targets: targetsOf(config),
    catalog: definitions(mapping(mapping(spec.events).payload).schema),
    all: definitions(mapping(specTargets.all).schema),
    byTarget,
  };
}

/** Whether a field is a common field of a target */
export function isCommon(view: BaseView, field: string, target: string): boolean {
  return Object.hasOwn(view.all, field) || Object.hasOwn(view.byTarget[target] ?? {}, field);
}

/** The type of a field on a target from the base layers (first layer that sets it) */
export function baseType(view: BaseView, field: string, target: string): CatalogEntry | null {
  const layers = [view.catalog[field], view.all[field], view.byTarget[target]?.[field]];
  let type: string | undefined;
  let itemsType: string | undefined;
  for (const layer of layers) {
    if (!layer) continue;
    if (type === undefined && typeof layer.type === "string") type = layer.type;
    const items = mapping(layer.items);
    if (itemsType === undefined && typeof items.type === "string") itemsType = items.type;
  }
  return type === undefined ? null : { type, ...(itemsType ? { itemsType } : {}) };
}

// --- Event payloads ------------------------------------------------------------------------------

/** The selector -> target ids of an event payload (implicit payloads: `all`) */
export function selectorTargets(
  selector: string | null,
  config: Data,
  targets: string[],
): string[] {
  if (selector === null) return targets;
  const groups = mapping(mapping(mapping(mapping(config.spec).events).payload).targets);
  const group = groups[selector];
  if (Array.isArray(group)) return group.filter((id) => targets.includes(id));
  return targets.includes(selector) ? [selector] : [];
}

/** Whether a raw payload is one implicit target payload (`schema` or `current` at the top) */
export function isImplicitPayload(payload: unknown): boolean {
  return (
    isYamlMapping(payload) &&
    (isYamlMapping(payload.schema) ||
      (typeof payload.current === "string" && !isYamlMapping(payload.schema)))
  );
}

/** Every field definition written in a raw event payload, with its selector (null: implicit) */
export function writtenDefinitions(
  payload: unknown,
): Array<{ selector: string | null; name: string; definition: Data }> {
  const out: Array<{ selector: string | null; name: string; definition: Data }> = [];
  const version = (selector: string | null, value: unknown) => {
    for (const [name, definition] of Object.entries(definitions(mapping(value).schema))) {
      out.push({ selector, name, definition });
    }
  };
  const target = (selector: string | null, value: unknown) => {
    const data = mapping(value);
    if (isYamlMapping(data.schema)) {
      version(selector, data);
      return;
    }
    for (const [key, entry] of Object.entries(data)) {
      if (key !== "current" && isYamlMapping(entry)) version(selector, entry);
    }
  };
  if (isImplicitPayload(payload)) target(null, payload);
  else for (const [selector, value] of Object.entries(mapping(payload))) target(selector, value);
  return out;
}

/** The payload of an event file */
function payloadOf(file: ScannedFile): unknown {
  return mapping(mapping(file.data).event).payload;
}

interface EventVersion {
  file: string;
  target: string;
  deprecated: boolean;
  schema: Record<string, Data>;
}

/** Every resolved (event, target, version) of the event files (`$ref` resolved) */
function eventVersions(events: ScannedFile[], config: Data): EventVersion[] {
  const out: EventVersion[] = [];
  const configLike = {
    spec: {
      events: {
        payload: {
          targets: mapping(mapping(mapping(mapping(config.spec).events).payload).targets),
        },
      },
    },
  } as unknown as OpenTPConfig;
  for (const file of events) {
    const payload = payloadOf(file);
    if (!isYamlMapping(payload)) continue;
    const { payload: resolved } = resolveEventPayload(payload as never, configLike);
    for (const [target, targetPayload] of Object.entries(resolved.targets)) {
      for (const version of Object.values(targetPayload.versions)) {
        out.push({
          file: file.rel,
          target,
          deprecated: isDeprecated(version.meta),
          schema: definitions(version.schema),
        });
      }
    }
  }
  return out;
}

/** Versions marked `meta.deprecated` are exempt from policy (as in the validator) */
function isDeprecated(meta: unknown): boolean {
  if (!isYamlMapping(meta)) return false;
  const deprecated = meta.deprecated;
  return deprecated !== undefined && deprecated !== null && deprecated !== false;
}

// --- Types ---------------------------------------------------------------------------------------

function valueType(value: unknown): string | null {
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (Array.isArray(value)) return "array";
  return null;
}

/** The most frequent type (the first seen on a tie); integer and number together give number */
function majority(types: string[], unifyNumbers: boolean): string | null {
  if (types.length === 0) return null;
  const counts = new Map<string, number>();
  for (const type of types) {
    const key = unifyNumbers && type === "integer" && types.includes("number") ? "number" : type;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [type, count] of counts) {
    if (count > bestCount) {
      best = type;
      bestCount = count;
    }
  }
  return best;
}

interface FieldStats {
  declared: Array<{ type: string; file: string }>;
  itemTypes: string[];
  values: unknown[];
  enumMembers: unknown[];
  /** Dictionaries named by `dict` (and `items.dict`, as `[path]`) */
  dicts: Array<string | [string]>;
}

function emptyStats(): FieldStats {
  return { declared: [], itemTypes: [], values: [], enumMembers: [], dicts: [] };
}

function addStats(stats: FieldStats, definition: Data, file: string): void {
  if (typeof definition.type === "string") stats.declared.push({ type: definition.type, file });
  const items = mapping(definition.items);
  if (typeof items.type === "string") stats.itemTypes.push(items.type);
  if (definition.value !== undefined) stats.values.push(definition.value);
  if (Array.isArray(definition.enum)) stats.enumMembers.push(...definition.enum);
  if (Array.isArray(items.enum)) stats.enumMembers.push(...items.enum.map((member) => [member]));
  if (typeof definition.dict === "string") stats.dicts.push(definition.dict);
  if (typeof items.dict === "string") stats.dicts.push([items.dict]);
}

/**
 * The type of a dictionary's values: its `dict.type`, else the type most of its values have
 * (null when it says nothing)
 */
export function dictionaryType(data: unknown): string | null {
  const dict = mapping(mapping(data).dict);
  if (typeof dict.type === "string") return dict.type;
  const values = Array.isArray(dict.values) ? dict.values : [];
  return majority(
    values.map(valueType).filter((type): type is string => type !== null && type !== "array"),
    true,
  );
}

export interface TypeResult {
  entry: CatalogEntry;
  /** Types declared by events, with counts, when they differ */
  conflict?: { counts: Array<[string, number]>; files: string[] };
  /** Nothing to infer from: string was used */
  defaulted?: boolean;
}

/**
 * The type of a field: typed base definitions first, else the majority of the types events
 * declare, else the type of values (base, then events), else of enum members, else of the
 * dictionaries it names, else string
 */
function inferType(
  baseDefinitions: Data[],
  stats: FieldStats,
  dictionaryTypes: ReadonlyMap<string, string>,
): TypeResult {
  const typed = baseDefinitions.find((definition) => typeof definition.type === "string");
  const dicts: Array<string | [string]> = [...stats.dicts];
  for (const definition of baseDefinitions) {
    if (typeof definition.dict === "string") dicts.push(definition.dict);
    const items = mapping(definition.items);
    if (typeof items.dict === "string") dicts.push([items.dict]);
  }
  const dictTypes = (forItems: boolean): string[] =>
    dicts
      .filter((dict) => Array.isArray(dict) === forItems)
      .map((dict) => dictionaryTypes.get(Array.isArray(dict) ? dict[0] : dict))
      .filter((type): type is string => type !== undefined);
  const itemsOf = (type: string, fromDefinition?: Data): CatalogEntry => {
    if (type !== "array") return { type };
    const items = mapping(fromDefinition?.items);
    const fromValues = [
      ...baseDefinitions.map((definition) => definition.value),
      ...stats.values,
      ...stats.enumMembers,
    ]
      .filter(Array.isArray)
      .flat()
      .map(valueType)
      .filter((item): item is string => item !== null && item !== "array");
    const itemsType =
      (typeof items.type === "string" ? items.type : null) ??
      majority(stats.itemTypes, false) ??
      majority(fromValues, true) ??
      majority(dictTypes(true), true) ??
      "string";
    return { type, itemsType };
  };

  if (typed) return { entry: itemsOf(typed.type as string, typed) };

  const declared = majority(
    stats.declared.map((vote) => vote.type),
    false,
  );
  if (declared !== null) {
    const counts = new Map<string, number>();
    for (const vote of stats.declared) counts.set(vote.type, (counts.get(vote.type) ?? 0) + 1);
    const result: TypeResult = { entry: itemsOf(declared) };
    if (counts.size > 1) {
      const files: string[] = [];
      for (const vote of stats.declared) {
        if (vote.type !== declared && !files.includes(vote.file)) files.push(vote.file);
      }
      result.conflict = { counts: [...counts].sort((a, b) => b[1] - a[1]), files };
    }
    return result;
  }

  const baseValues = baseDefinitions.map((definition) => definition.value);
  for (const values of [baseValues, stats.values]) {
    const type = majority(
      values.map(valueType).filter((type): type is string => type !== null),
      true,
    );
    if (type !== null) return { entry: itemsOf(type) };
  }
  const memberType = majority(
    [
      ...baseDefinitions.flatMap((definition) =>
        Array.isArray(definition.enum) ? definition.enum : [],
      ),
      ...stats.enumMembers,
    ]
      .map(valueType)
      .filter((type): type is string => type !== null),
    true,
  );
  if (memberType !== null) return { entry: itemsOf(memberType) };
  const dictType = majority(dictTypes(false), true);
  if (dictType !== null) return { entry: itemsOf(dictType) };
  return { entry: { type: "string" }, defaulted: true };
}

// --- Catalog -------------------------------------------------------------------------------------

export interface CatalogResult {
  /** New catalog entries, natural-sorted (completed slot families included) */
  entries: Array<[string, CatalogEntry]>;
  /** Slot family members added because a family had gaps */
  slots: string[];
}

/** Fields `<prefix>_<n>` with the same definition: the missing members from 1 to the highest n */
function completeFamilies(
  entries: Map<string, CatalogEntry>,
  isBase: (name: string) => boolean,
): string[] {
  const families = new Map<string, number[]>();
  for (const name of entries.keys()) {
    const match = /^(.+)_([1-9][0-9]*)$/.exec(name);
    if (!match) continue;
    const members = families.get(match[1]) ?? [];
    members.push(Number(match[2]));
    families.set(match[1], members);
  }
  const added: string[] = [];
  for (const [prefix, numbers] of families) {
    if (numbers.length < 2) continue;
    const definitions = numbers.map((n) => JSON.stringify(entries.get(`${prefix}_${n}`)));
    if (new Set(definitions).size !== 1) continue;
    const highest = Math.max(...numbers);
    // Only families whose members are mostly used: `event_2025` and `event_2026` are not slots
    if (numbers.length * 2 < highest) continue;
    const entry = entries.get(`${prefix}_${numbers[0]}`) as CatalogEntry;
    for (let n = 1; n <= highest; n += 1) {
      const name = `${prefix}_${n}`;
      if (entries.has(name) || isBase(name)) continue;
      entries.set(name, { ...entry });
      added.push(name);
    }
  }
  return added.sort(naturalCompare);
}

export interface Analysis {
  view: BaseView;
  catalog: CatalogResult;
  /** Pairs to write first in base definitions, by site path */
  typeInsertions: Map<string, string[]>;
  /** What `valueRequired: true` becomes, by site path of the base definition */
  valueRequired: Map<string, "fixed" | "drop">;
}

export interface AnalysisOptions {
  /** opentp.yaml or opentp.yml (for findings) */
  configFile?: string;
  /** Event files outside the events root, by relative path */
  skeletons?: ReadonlySet<string>;
  /** The type of each dictionary's values, by dictionary path (`taxonomy/areas`) */
  dictionaryTypes?: ReadonlyMap<string, string>;
}

/**
 * Analyses a 2026-01 plan: the catalog, missing base types and valueRequired. `events` are the
 * event files that take part (2026-01 and 2026-09 headers). Their fields go into the catalog;
 * `skeletons` (event files outside the events root, by relative path) do not count as events when
 * valueRequired is decided.
 */
export function analyzePreviousPlan(
  config: Data,
  events: ScannedFile[],
  findings: Findings,
  options: AnalysisOptions = {},
): Analysis {
  const configFile = options.configFile ?? "opentp.yaml";
  const skeletons = options.skeletons ?? new Set<string>();
  const dictionaryTypes = options.dictionaryTypes ?? new Map<string, string>();
  const spec = mapping(config.spec);
  const targets = targetsOf(config);
  const oldBase = definitions(mapping(mapping(spec.events).payload).schema);
  const byTarget: Record<string, Record<string, Data>> = {};
  for (const [id, target] of Object.entries(mapping(spec.targets))) {
    byTarget[id] = definitions(mapping(target).schema);
  }
  // spec.targets.all of a 2026-01 plan is merged behind the moved base fields
  const all = { ...definitions(mapping(mapping(spec.targets).all).schema), ...oldBase };
  delete byTarget.all;
  const view: BaseView = { targets, catalog: {}, all, byTarget };

  const baseDefinitionsOf = (field: string): Data[] =>
    [all[field], ...Object.values(byTarget).map((schema) => schema[field])].filter(
      (definition): definition is Data => definition !== undefined,
    );

  // Usage and written definitions
  const stats = new Map<string, FieldStats>();
  const candidates = new Set<string>();
  const versions = eventVersions(events, config);
  const seenPerFile = new Map<string, Set<string>>();
  for (const version of versions) {
    const seen = seenPerFile.get(version.file) ?? new Set<string>();
    seenPerFile.set(version.file, seen);
    for (const field of Object.keys(version.schema)) {
      seen.add(field);
      if (!isCommon(view, field, version.target)) candidates.add(field);
    }
  }
  for (const file of events) {
    const seen = seenPerFile.get(file.rel) ?? new Set<string>();
    for (const { name, definition } of writtenDefinitions(payloadOf(file))) {
      const fieldStats = stats.get(name) ?? emptyStats();
      stats.set(name, fieldStats);
      addStats(fieldStats, definition, file.rel);
      // A definition the payload resolution did not reach (a broken selector): keep it usable
      if (!seen.has(name) && !targets.every((target) => isCommon(view, name, target))) {
        candidates.add(name);
      }
    }
  }

  // Catalog entries
  const entries = new Map<string, CatalogEntry>();
  for (const field of [...candidates].sort(naturalCompare)) {
    const result = inferType(
      baseDefinitionsOf(field),
      stats.get(field) ?? emptyStats(),
      dictionaryTypes,
    );
    entries.set(field, result.entry);
    if (result.conflict) {
      findings.warn(
        configFile,
        `${CATALOG_PATH}.${field}`,
        typeConflictMessage(
          field,
          result.conflict.counts,
          result.entry.type,
          result.conflict.files,
        ),
      );
    }
    if (result.defaulted) {
      findings.warn(configFile, `${CATALOG_PATH}.${field}`, defaultTypeMessage(field));
    }
  }
  const isBaseField = (name: string) => baseDefinitionsOf(name).length > 0;
  const slots = completeFamilies(entries, isBaseField);
  const sorted = [...entries].sort(([a], [b]) => naturalCompare(a, b));
  for (const [name, entry] of sorted) view.catalog[name] = catalogDefinition(entry);

  // Base fields with no type on some target: the type goes into the first base definition
  const typeInsertions = new Map<string, string[]>();
  for (const field of new Set([
    ...Object.keys(oldBase),
    ...Object.values(byTarget).flatMap(Object.keys),
  ])) {
    if (entries.has(field)) continue;
    const untypedTargets = (targets.length > 0 ? targets : ["all"]).filter(
      (target) => baseType(view, field, target) === null,
    );
    if (untypedTargets.length === 0) continue;
    const result = inferType(
      baseDefinitionsOf(field),
      stats.get(field) ?? emptyStats(),
      dictionaryTypes,
    );
    const pairs = [`type: ${result.entry.type}`];
    const hasItems = baseDefinitionsOf(field).some((definition) => definition.items !== undefined);
    if (result.entry.itemsType && !hasItems) {
      pairs.push(`items: { type: ${result.entry.itemsType} }`);
    }
    const sites: string[] = oldBase[field]
      ? [`${CATALOG_PATH}.${field}`]
      : Object.keys(byTarget)
          .filter(
            (id) => byTarget[id][field] && (untypedTargets.includes(id) || !targets.includes(id)),
          )
          .map((id) => `spec.targets.${id}.schema.${field}`);
    for (const site of sites) typeInsertions.set(site, pairs);
    if (result.defaulted) {
      findings.warn(
        configFile,
        movedPath(sites[0] ?? `${CATALOG_PATH}.${field}`),
        defaultTypeMessage(field),
      );
    }
    const typed = catalogDefinition(result.entry);
    if (oldBase[field]) all[field] = { ...all[field], ...typed };
    else
      for (const id of Object.keys(byTarget))
        if (byTarget[id][field]) byTarget[id][field] = { ...byTarget[id][field], ...typed };
  }

  // valueRequired on base definitions
  const valueRequired = new Map<string, "fixed" | "drop">();
  const decide = (
    site: string,
    field: string,
    definition: Data,
    scope: string[],
    targetId: string | null,
  ) => {
    if (definition.valueRequired === undefined) return;
    if (definition.valueRequired !== true) {
      valueRequired.set(site, "drop");
      return;
    }
    const withValue =
      oldBase[field]?.value !== undefined
        ? targets
        : Object.keys(byTarget).filter((id) => byTarget[id][field]?.value !== undefined);
    if (withValue.length > 0) {
      valueRequired.set(site, "drop");
      const without = scope.filter((target) => !withValue.includes(target));
      if (without.length > 0) {
        findings.warn(
          configFile,
          movedPath(site),
          valueRequiredSomeTargetsMessage(field, withValue, without),
        );
      }
      return;
    }
    const required =
      definition.required === true || (targetId !== null && oldBase[field]?.required === true);
    if (required) {
      valueRequired.set(site, "fixed");
      return;
    }
    const inScope = versions.filter(
      (version) =>
        scope.includes(version.target) && !version.deprecated && !skeletons.has(version.file),
    );
    const unpinned = inScope.filter((version) => version.schema[field]?.value === undefined).length;
    if (inScope.length > 0 && unpinned === 0) {
      valueRequired.set(site, "fixed");
      return;
    }
    valueRequired.set(site, "drop");
    findings.warn(
      configFile,
      movedPath(site),
      valueRequiredNotPinnedMessage(field, unpinned, inScope.length),
    );
  };
  for (const [field, definition] of Object.entries(oldBase)) {
    decide(`${CATALOG_PATH}.${field}`, field, definition, targets, null);
  }
  for (const [id, schema] of Object.entries(byTarget)) {
    for (const [field, definition] of Object.entries(schema)) {
      decide(
        `spec.targets.${id}.schema.${field}`,
        field,
        definition,
        targets.includes(id) ? [id] : [],
        id,
      );
    }
  }

  return { view, catalog: { entries: sorted, slots }, typeInsertions, valueRequired };
}

/** A catalog entry as a definition */
export function catalogDefinition(entry: CatalogEntry): Data {
  return entry.itemsType
    ? { type: entry.type, items: { type: entry.itemsType } }
    : { type: entry.type };
}

// --- Webhook bindings ----------------------------------------------------------------------------

/** JSON with sorted object keys: equal configurations give equal text */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isYamlMapping(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export const WEBHOOK_ID_PREFIX = "webhook-";

/** A new webhook binding: its id and where its configuration is written */
export interface NewBinding {
  id: string;
  file: ScannedFile;
  /** The `webhook` pair inside `x-opentp.checks` (its value may be an alias) */
  pair: Pair;
  /** The configuration as plain data (aliases resolved), normalized (see normalizeWebhook) */
  config: unknown;
  /** Whether normalizeWebhook changed the configuration of `pair` */
  normalized: boolean;
}

/** One place where a webhook configuration is written */
export interface WebhookSource {
  file: ScannedFile;
  /** The path of the `webhook` pair, as migrate reports paths in that file */
  path: string;
}

/** The settings of a webhook binding in opentp.cli.yaml */
export const WEBHOOK_SETTINGS = ["url", "method", "headers", "timeout", "retries", "cache"];

const WEBHOOK_METHODS = ["GET", "POST", "PUT"];

/**
 * A 2026-01 webhook configuration as a 0.10 webhook binding takes it, where that keeps its meaning:
 * a method that is GET, POST or PUT in another case is upper-cased (HTTP clients upper-case these
 * methods anyway), and keys that are not binding settings are dropped (0.9 ignored them). Anything
 * else is left for the shape check.
 */
export function normalizeWebhook(config: unknown): { config: unknown; dropped: string[] } {
  if (!isYamlMapping(config)) return { config, dropped: [] };
  const out: Data = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (!WEBHOOK_SETTINGS.includes(key)) {
      dropped.push(key);
      continue;
    }
    out[key] =
      key === "method" && typeof value === "string" && WEBHOOK_METHODS.includes(value.toUpperCase())
        ? value.toUpperCase()
        : value;
  }
  return { config: out, dropped };
}

export function unknownWebhookSettingMessage(key: string): string {
  return `Unknown webhook setting '${key}': not copied to the binding in opentp.cli.yaml (a webhook binding takes url, method, headers, timeout, retries and cache)`;
}

/**
 * Binding ids for webhook checks: `webhook-<n>` in first-seen order, identical configurations
 * share one id. Ids of existing bindings with the same configuration are reused; ids that exist
 * already (bound, or referred to by migrated files) are never given to another configuration.
 */
export class WebhookIds {
  readonly ids = new Map<Pair, string>();
  readonly added: NewBinding[] = [];
  /** Every place of each new binding's configuration, in first-seen order */
  readonly sources = new Map<string, WebhookSource[]>();
  /** Keys dropped by normalizeWebhook, at the place where they are written */
  readonly dropped: Array<{ source: WebhookSource; key: string }> = [];
  private readonly byConfig = new Map<string, string>();
  private readonly taken: Set<string>;
  private next = 1;

  constructor(existing: Map<string, unknown>, referenced: Iterable<string>) {
    this.taken = new Set([...existing.keys(), ...referenced]);
    for (const [id, config] of existing) this.byConfig.set(canonicalJson(config), id);
  }

  /**
   * Assigns ids to every webhook check of a file, in document order. Aliases are resolved: a
   * webhook configuration reused with an alias gets the id of its anchor, and the checks of an
   * `x-opentp: *alias` are the checks of the mapping it points to.
   */
  collect(file: ScannedFile): void {
    const resolve = (node: unknown): unknown => (isAlias(node) ? node.resolve(file.doc) : node);
    // Paths as migrate reports them: event files without the leading `event.`
    const shown = (path: string): string =>
      file.kind === "event" ? path.replace(/^event\./, "") : path;
    const visit = (node: unknown, path: string): void => {
      if (isMap(node)) {
        for (const pair of node.items as Pair[]) {
          const childPath = path === "" ? (keyOf(pair) ?? "?") : `${path}.${keyOf(pair) ?? "?"}`;
          const xOpentp = keyOf(pair) === "x-opentp" ? resolve(pair.value) : null;
          if (isMap(xOpentp)) {
            const checks = (xOpentp.items as Pair[]).find((member) => keyOf(member) === "checks");
            const checksMap = resolve(checks?.value);
            if (isMap(checksMap)) {
              for (const check of checksMap.items as Pair[]) {
                if (keyOf(check) === "webhook" && isMap(resolve(check.value))) {
                  this.assign(file, check, shown(`${childPath}.checks.webhook`));
                }
              }
            }
          }
          visit(pair.value, childPath);
        }
      } else if (isSeq(node)) {
        node.items.forEach((item, index) => {
          visit(item, `${path}[${index}]`);
        });
      }
    };
    visit(file.doc.contents, "");
  }

  private assign(file: ScannedFile, pair: Pair, path: string): void {
    const source: WebhookSource = { file, path };
    const seen = this.ids.get(pair);
    if (seen !== undefined) {
      // The same pair again, through an alias: one more place of its configuration
      this.sources.get(seen)?.push(source);
      return;
    }
    const written = (pair.value as Node).toJS(file.doc);
    const { config, dropped } = normalizeWebhook(written);
    for (const key of dropped) this.dropped.push({ source, key });
    const key = canonicalJson(config);
    let id = this.byConfig.get(key);
    if (id === undefined) {
      while (this.taken.has(`${WEBHOOK_ID_PREFIX}${this.next}`)) this.next += 1;
      id = `${WEBHOOK_ID_PREFIX}${this.next}`;
      this.taken.add(id);
      this.byConfig.set(key, id);
      const normalized = canonicalJson(written) !== key;
      this.added.push({ id, file, pair, config, normalized });
    }
    this.sources.get(id)?.push(source) ?? this.sources.set(id, [source]);
    this.ids.set(pair, id);
  }

  /**
   * The new bindings whose configuration a webhook binding does not accept even after
   * normalizeWebhook, reported at every place where that configuration is written
   */
  shapeProblems(problemsOf: (config: unknown) => string[]): Finding[] {
    const findings: Finding[] = [];
    for (const binding of this.added) {
      const problems = problemsOf(binding.config);
      if (problems.length === 0) continue;
      for (const source of this.sources.get(binding.id) ?? []) {
        for (const problem of problems) {
          findings.push({
            file: source.file.rel,
            path: source.path,
            message: `Cannot become a webhook binding in opentp.cli.yaml (${problem}): fix the webhook configuration here and run opentp migrate again`,
          });
        }
      }
    }
    return findings;
  }
}
