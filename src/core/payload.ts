import type {
  ArrayItems,
  EventPayload,
  Field,
  FieldPolicy,
  OpenTPConfig,
  PayloadVersion,
  ResolvedEventPayload,
  ResolvedPayloadVersion,
  ResolvedTargetPayload,
  TargetPayload,
  VersionedTargetPayload,
} from "../types";
import { getOwn, setOwn } from "../util/objects";
import { keysInSourceOrder } from "../util/yaml";

export interface PayloadIssue {
  path: string;
  message: string;
}

export const UNVERSIONED_VERSION_KEY = "__unversioned__";

interface NormalizedTargetPayload {
  isUnversioned: boolean;
  currentRef: string;
  aliases: Record<string, string>;
  versions: Record<string, PayloadVersion>;
  /** The keys of `versions` in file order */
  versionOrder: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPayloadVersion(value: unknown): value is PayloadVersion {
  return isPlainObject(value) && isPlainObject((value as Record<string, unknown>).schema);
}

/**
 * The field definitions of a `schema` map that are mappings. Other values (`user_id:` with no
 * definition) are reported once where they are written and are skipped everywhere else.
 */
export function fieldMap(schema: unknown): Record<string, Field> {
  if (!isPlainObject(schema)) return {};
  const fields: Record<string, Field> = {};
  for (const [name, field] of Object.entries(schema)) {
    if (isPlainObject(field)) setOwn(fields, name, field as Field);
  }
  return fields;
}

/** A payload version whose schema holds only usable field definitions */
function usableVersion(version: PayloadVersion): PayloadVersion {
  return { ...version, schema: fieldMap(version.schema) };
}

function isVersionedTargetPayload(value: unknown): value is VersionedTargetPayload {
  if (!isPlainObject(value)) return false;
  if (isPlainObject((value as Record<string, unknown>).schema)) return false; // versioned targets must not have top-level schema
  return typeof (value as Record<string, unknown>).current === "string";
}

function parseTargetPayload(
  payload: unknown,
  issues: PayloadIssue[],
  path: string,
): NormalizedTargetPayload {
  if (isPayloadVersion(payload)) {
    return {
      isUnversioned: true,
      currentRef: UNVERSIONED_VERSION_KEY,
      aliases: {},
      versions: { [UNVERSIONED_VERSION_KEY]: usableVersion(payload) },
      versionOrder: [UNVERSIONED_VERSION_KEY],
    };
  }

  if (!isVersionedTargetPayload(payload)) {
    issues.push({
      path,
      message: "Invalid target payload: expected {schema,...} or {current,...}",
    });
    return {
      isUnversioned: true,
      currentRef: UNVERSIONED_VERSION_KEY,
      aliases: {},
      versions: {},
      versionOrder: [],
    };
  }

  const obj = payload as Record<string, unknown>;
  const versions: Record<string, PayloadVersion> = {};
  const versionOrder: string[] = [];
  const aliases: Record<string, string> = {};

  // In file order: an object lists integer-like keys ("1", "2") first, in numeric order
  for (const key of keysInSourceOrder(obj)) {
    const value = obj[key];
    if (key === "current") continue;

    if (typeof value === "string") {
      setOwn(aliases, key, value);
      continue;
    }

    if (isPayloadVersion(value)) {
      setOwn(versions, key, usableVersion(value));
      versionOrder.push(key);
      continue;
    }

    issues.push({
      path: `${path}.${key}`,
      message: "Invalid version entry: expected string alias or {schema,...}",
    });
  }

  return {
    isUnversioned: false,
    currentRef: String(obj.current),
    aliases,
    versions,
    versionOrder,
  };
}

// --- $ref: refMerge ------------------------------------------------------------------------------

/**
 * Merges the schema of a referenced version (`base`) with the schema of the version that has the
 * `$ref` (`override`), field by field (refMergeField). Between versions only a changed `type` and
 * `required: true` changed to `false` are errors, reported at `<basePath>.schema.<field>`; the
 * narrowing and presence rules of the layers never apply between versions. `lookup` gives the
 * values of dictionaries, for inherited examples that a `dict` or `items.dict` no longer allows.
 */
export function refMerge(
  base: Record<string, Field>,
  override: Record<string, Field>,
  issues?: PayloadIssue[],
  basePath?: string,
  lookup?: DictionaryLookup,
): Record<string, Field> {
  const out: Record<string, Field> = { ...base };
  for (const [name, overrideField] of Object.entries(override)) {
    const baseField = getOwn(out, name);
    if (baseField) {
      if (issues && basePath) {
        checkRefConflicts(baseField, overrideField, issues, `${basePath}.schema.${name}`);
      }
      setOwn(out, name, refMergeField(baseField, overrideField, lookup));
    } else {
      setOwn(out, name, overrideField);
    }
  }
  return out;
}

function checkRefConflicts(
  base: Field,
  override: Field,
  issues: PayloadIssue[],
  fieldPath: string,
): void {
  if (base.type && override.type && base.type !== override.type) {
    issues.push({
      path: fieldPath,
      message: `Field type conflict: base '${base.type}' vs override '${override.type}'`,
    });
  }

  if (base.required === true && override.required === false) {
    issues.push({
      path: fieldPath,
      message: "Cannot weaken required field (base required=true, override required=false)",
    });
  }
}

/**
 * One field of a derived version: each keyword of the referencing version (`override`) replaces the
 * referenced one; setting one of `value`, `enum` or `dict` removes the other two; `checks` and `pii`
 * merge by key (a later entry replaces the earlier one whole); each `x-*` key is replaced whole.
 * An inherited `example` that a narrowing override (`value`, `enum`, `dict`, `items`) no longer
 * allows is dropped, as between layers: the derived version does not write it, so it is never
 * checked there (an example is checked where it is written). A dictionary's values come from
 * `lookup`; without it, or for an unknown dictionary, a `dict` keeps the example.
 */
export function refMergeField(base: Field, override: Field, lookup?: DictionaryLookup): Field {
  const merged: Field = { ...base, ...override };
  const pii = mergeByKey(base.pii, override.pii);
  if (pii !== undefined) merged.pii = pii as Field["pii"];
  const checks = mergeByKey(base.checks, override.checks);
  if (checks !== undefined) merged.checks = checks;
  keepOneRestriction(merged, override);
  const narrows =
    override.value !== undefined ||
    override.enum !== undefined ||
    override.dict !== undefined ||
    override.items !== undefined;
  if (
    narrows &&
    override.example === undefined &&
    merged.example !== undefined &&
    !exampleAllowed(merged.example, merged, lookup)
  ) {
    delete merged.example;
  }
  return merged;
}

/** `{ ...earlier, ...later }` when both are mappings; otherwise the later one if set */
function mergeByKey(earlier: unknown, later: unknown): Record<string, unknown> | undefined {
  if (isPlainObject(earlier) && isPlainObject(later)) return { ...earlier, ...later };
  if (later !== undefined) return later as Record<string, unknown>;
  return earlier as Record<string, unknown> | undefined;
}

/**
 * Keeps the one of `value`, `enum` and `dict` that `written` sets (value before enum before dict:
 * a definition that sets several is reported where it is written)
 */
function keepOneRestriction(merged: Field | ArrayItems, written: Field | ArrayItems): void {
  const target = merged as Field;
  const source = written as Field;
  if (source.value !== undefined) {
    delete target.enum;
    delete target.dict;
  } else if (source.enum !== undefined) {
    delete target.value;
    delete target.dict;
  } else if (source.dict !== undefined) {
    delete target.value;
    delete target.enum;
  }
}

// --- Layers: layerMerge --------------------------------------------------------------------------

/** The values of a dictionary, or null when it does not exist */
export type DictionaryLookup = (dict: string) => readonly unknown[] | null;

/**
 * A problem found while merging a field definition over the earlier layers:
 * - `type`: a type that differs from the earlier one (never ignorable);
 * - `fixed`: a changed fixed value, or a fixed value replaced with an enum or a dictionary (never
 *   ignorable);
 * - `required`: `required: false` after an earlier `required: true` (never ignorable);
 * - `policy`: a lowered policy (base layers);
 * - `narrowing`: a value, enum or dictionary that is not within the earlier enum or dictionary (a
 *   field-level check: ignorable in events).
 */
export interface MergeProblem {
  /** Keyword path below the field: "" (the field), "value", "enum", "dict", "items", "items.enum", ... */
  keyword: string;
  message: string;
  rule: "type" | "fixed" | "required" | "policy" | "narrowing";
  /** The rule needed the values of a dictionary */
  dictionary?: boolean;
}

export interface LayerMergeOptions {
  /**
   * The layer of the later definition: "base" (catalog, spec.targets.all, spec.targets.<T>) or
   * "event" (an event payload version). In a base layer `required: false` is the same as unset and
   * `policy` may be raised; in an event `policy` is ignored (it is reported where it is written).
   */
  layer: "base" | "event";
  /**
   * The values of a dictionary (null when unknown: membership and subset rules that need it are
   * skipped, and the unknown dictionary is reported where it is written)
   */
  dictionaryValues?: DictionaryLookup;
}

export const POLICIES: readonly FieldPolicy[] = ["specified", "restricted", "fixed"];

export function isPolicy(value: unknown): value is FieldPolicy {
  return typeof value === "string" && (POLICIES as readonly string[]).includes(value);
}

/** Two values are the same: by type and value; arrays element by element */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameValue(item, b[index]))
    );
  }
  if (isPlainObject(a) && isPlainObject(b)) return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

/** A value as shown in messages: JSON (strings in double quotes, arrays as lists) */
export function showValue(value: unknown): string {
  const json = JSON.stringify(value);
  return json === undefined ? String(value) : json;
}

function listValues(values: readonly unknown[]): string {
  return `[${values.map(String).join(", ")}]`;
}

/** The allowed values of an earlier definition (enum or dictionary), or null when there are none */
function allowedValues(
  earlier: Field | ArrayItems,
  lookup: DictionaryLookup | undefined,
): { values: readonly unknown[]; source: string; dictionary: boolean } | null {
  // An empty enum is reported where it is written; it does not restrict later layers
  if (Array.isArray(earlier.enum) && earlier.enum.length > 0) {
    return { values: earlier.enum, source: "enum", dictionary: false };
  }
  if (typeof earlier.dict === "string") {
    const values = lookup?.(earlier.dict) ?? null;
    return values === null
      ? null
      : { values, source: `dictionary '${earlier.dict}'`, dictionary: true };
  }
  return null;
}

/**
 * Merges the fixed value, enum and dictionary of a later definition over the merged earlier one
 * (the `value`, `enum` and `dict` rows of the field merge), into `result`.
 */
function mergeRestriction(
  earlier: Field | ArrayItems,
  later: Field | ArrayItems,
  result: Field | ArrayItems,
  prefix: string,
  options: LayerMergeOptions,
  problems: MergeProblem[],
): boolean {
  const m = earlier as Field;
  const l = later as Field;
  const keyword = (name: string) => `${prefix}${name}`;
  const fixed = m.value !== undefined;

  if (l.value !== undefined) {
    if (fixed) {
      if (!sameValue(m.value, l.value)) {
        problems.push({
          keyword: keyword("value"),
          message: `Cannot change the fixed value ${showValue(m.value)} to ${showValue(l.value)}`,
          rule: "fixed",
        });
      }
    } else {
      const allowed = allowedValues(m, options.dictionaryValues);
      if (allowed && !allowed.values.some((value) => sameValue(value, l.value))) {
        problems.push(
          allowed.dictionary
            ? {
                keyword: keyword("value"),
                message: `Value '${String(l.value)}' is not in ${allowed.source}`,
                rule: "narrowing",
                dictionary: true,
              }
            : {
                keyword: keyword("value"),
                message: `Value ${showValue(l.value)} is not in allowed enum: ${listValues(allowed.values)}`,
                rule: "narrowing",
              },
        );
      }
    }
  } else if (l.enum !== undefined) {
    if (fixed) {
      problems.push({
        keyword: keyword("enum"),
        message: `Cannot replace the fixed value ${showValue(m.value)} with an enum`,
        rule: "fixed",
      });
    } else if (Array.isArray(l.enum)) {
      const allowed = allowedValues(m, options.dictionaryValues);
      const extra = allowed
        ? l.enum.filter((value) => !allowed.values.some((item) => sameValue(item, value)))
        : [];
      if (allowed && extra.length > 0) {
        problems.push({
          keyword: keyword("enum"),
          message: allowed.dictionary
            ? `Enum values ${listValues(extra)} are not in ${allowed.source}`
            : `Enum values ${listValues(extra)} are not in spec enum: ${listValues(allowed.values)}`,
          rule: "narrowing",
          ...(allowed.dictionary ? { dictionary: true } : {}),
        });
      }
    }
  } else if (l.dict !== undefined) {
    if (fixed) {
      problems.push({
        keyword: keyword("dict"),
        message: `Cannot replace the fixed value ${showValue(m.value)} with a dictionary`,
        rule: "fixed",
      });
    } else if (typeof l.dict === "string") {
      const allowed = allowedValues(m, options.dictionaryValues);
      const values = options.dictionaryValues?.(l.dict) ?? null;
      if (allowed && values) {
        const extra = values.filter(
          (value) => !allowed.values.some((item) => sameValue(item, value)),
        );
        if (extra.length > 0) {
          const base =
            allowed.source === "enum" ? `base enum ${listValues(allowed.values)}` : allowed.source;
          problems.push({
            keyword: keyword("dict"),
            message: `Dictionary '${l.dict}' has values ${listValues(extra)} that are not in ${base}`,
            rule: "narrowing",
            dictionary: true,
          });
        }
      }
    }
  } else {
    return false;
  }

  for (const name of ["value", "enum", "dict"] as const) delete (result as Field)[name];
  if (l.value !== undefined) (result as Field).value = l.value;
  else if (l.enum !== undefined) (result as Field).enum = l.enum;
  else (result as Field).dict = l.dict;
  return true;
}

/**
 * Merges array `items` keyword by keyword: a different `items.type` is a type conflict;
 * `items.value`/`items.enum`/`items.dict` follow the rules of the field; other keywords: later wins
 */
function mergeItems(
  earlier: ArrayItems,
  later: ArrayItems,
  options: LayerMergeOptions,
  problems: MergeProblem[],
): { items: ArrayItems; narrowed: boolean } {
  const items: ArrayItems = { ...earlier };
  for (const [key, value] of Object.entries(later)) {
    if (key === "value" || key === "enum" || key === "dict") continue;
    if (key === "type") {
      if (earlier.type !== undefined && earlier.type !== value) {
        problems.push({
          keyword: "items",
          message: `Item type conflict: base '${earlier.type}' vs ${conflictLabel(options)} '${String(value)}'`,
          rule: "type",
        });
      } else {
        items.type = value as ArrayItems["type"];
      }
      continue;
    }
    if (key === "checks") {
      items.checks = mergeByKey(earlier.checks, value);
      continue;
    }
    (items as Record<string, unknown>)[key] = value;
  }
  const narrowed = mergeRestriction(earlier, later, items, "items.", options, problems);
  return { items, narrowed };
}

function conflictLabel(options: LayerMergeOptions): string {
  return options.layer === "base" ? "target" : "override";
}

/**
 * Whether an example is allowed by the fixed value, enum, dictionary and item restrictions of a
 * field (membership only; an unknown dictionary allows everything)
 */
export function exampleAllowed(
  example: unknown,
  field: Field,
  lookup: DictionaryLookup | undefined,
): boolean {
  if (field.value !== undefined) return sameValue(example, field.value);
  const allowed = allowedValues(field, lookup);
  if (allowed && !allowed.values.some((value) => sameValue(value, example))) return false;
  if (Array.isArray(example) && isPlainObject(field.items)) {
    const items = field.items;
    if (items.value !== undefined) {
      return example.every((item) => sameValue(item, (items as Field).value));
    }
    const allowedItems = allowedValues(items, lookup);
    if (allowedItems) {
      return example.every((item) => allowedItems.values.some((value) => sameValue(value, item)));
    }
  }
  return true;
}

/**
 * The field merge of a later definition over the merged earlier one (layers: catalog ->
 * spec.targets.all -> spec.targets.<T> -> event). Returns the merged definition and the problems
 * (see MergeProblem); keywords follow the 2026-09 field merge table:
 * - `type`: a different type is a conflict, the earlier type is kept;
 * - `value`/`enum`/`dict`: a fixed value cannot change or be replaced; otherwise a later value,
 *   enum or dictionary must stay within the earlier enum or dictionary, and replaces the other two;
 * - `items`: merged keyword by keyword like a field;
 * - `required`: `false` after an earlier `true` is an error; the result is `true` if any layer says
 *   so;
 * - `policy`: base layers only; may be raised, not lowered;
 * - `checks`, `pii`: merged by key; each `x-*` key and every other keyword: the later one wins;
 * - `example`: the later one wins; an inherited example that a later value, enum, dictionary or
 *   item restriction no longer allows is dropped.
 */
export function layerMerge(
  earlier: Field | undefined,
  later: Field,
  options: LayerMergeOptions,
): { field: Field; problems: MergeProblem[] } {
  const problems: MergeProblem[] = [];
  if (earlier === undefined) {
    const field: Field = { ...later };
    if (options.layer === "event") delete field.policy;
    keepOneRestriction(field, later);
    return { field, problems };
  }

  const result: Field = { ...earlier };
  for (const [key, value] of Object.entries(later)) {
    switch (key) {
      case "type":
        if (earlier.type !== undefined && earlier.type !== value) {
          problems.push({
            keyword: "",
            message: `Field type conflict: base '${earlier.type}' vs ${conflictLabel(options)} '${String(value)}'`,
            rule: "type",
          });
        } else {
          result.type = value as Field["type"];
        }
        break;
      case "value":
      case "enum":
      case "dict":
      case "items":
      case "example":
        break;
      case "required":
        if (value === false && earlier.required === true) {
          problems.push({
            keyword: "",
            message:
              options.layer === "base"
                ? "Cannot weaken required field in target schema (base required=true, target required=false)"
                : "Cannot weaken required field (base required=true, override required=false)",
            rule: "required",
          });
        } else if (earlier.required !== true) {
          result.required = value as boolean;
        }
        break;
      case "policy":
        if (options.layer === "event" || !isPolicy(value)) break;
        if (
          isPolicy(earlier.policy) &&
          POLICIES.indexOf(value) < POLICIES.indexOf(earlier.policy)
        ) {
          problems.push({
            keyword: "policy",
            message: `Cannot lower policy '${earlier.policy}' to '${value}'`,
            rule: "policy",
          });
        } else {
          result.policy = value;
        }
        break;
      case "checks":
        result.checks = mergeByKey(earlier.checks, value);
        break;
      case "pii":
        result.pii = mergeByKey(earlier.pii, value) as Field["pii"];
        break;
      default:
        (result as Record<string, unknown>)[key] = value;
    }
  }

  let narrowed = mergeRestriction(earlier, later, result, "", options, problems);

  if (later.items !== undefined) {
    if (isPlainObject(earlier.items) && isPlainObject(later.items)) {
      const merged = mergeItems(earlier.items, later.items, options, problems);
      result.items = merged.items;
      narrowed = narrowed || merged.narrowed;
    } else {
      result.items = later.items;
    }
  }

  if (later.example !== undefined) {
    result.example = later.example;
  } else if (
    narrowed &&
    earlier.example !== undefined &&
    !exampleAllowed(earlier.example, result, options.dictionaryValues)
  ) {
    delete result.example;
  }

  return { field: result, problems };
}

// --- Base layers ---------------------------------------------------------------------------------

/** One base layer of a target: the catalog, spec.targets.all or spec.targets.<T> */
export interface BaseLayer {
  /** "catalog", "all" or the target id */
  name: string;
  /** Dotted path of its field map in opentp.yaml */
  path: string;
  fields: Record<string, Field>;
  /** Fields of spec.targets are part of every event on the target; catalog fields are not */
  common: boolean;
}

export const CATALOG_PATH = "spec.events.payload.schema";

/** The base layers of a target, in merge order (catalog, spec.targets.all, spec.targets.<T>) */
export function baseLayers(config: OpenTPConfig, targetId: string): BaseLayer[] {
  const layers: BaseLayer[] = [
    {
      name: "catalog",
      path: CATALOG_PATH,
      fields: fieldMap(config.spec.events.payload.schema),
      common: false,
    },
  ];
  const specTargets: unknown = config.spec.targets;
  if (!isPlainObject(specTargets)) return layers;
  for (const name of targetId === "all" ? ["all"] : ["all", targetId]) {
    const target = specTargets[name];
    if (!Object.hasOwn(specTargets, name) || !isPlainObject(target)) continue;
    layers.push({
      name,
      path: `spec.targets.${name}.schema`,
      fields: fieldMap(target.schema),
      common: true,
    });
  }
  return layers;
}

/** A field of the base layers of one target, merged */
export interface BaseField {
  /** The merged definition (catalog -> spec.targets.all -> spec.targets.<T>) */
  field: Field;
  /** Defined in spec.targets.all or spec.targets.<T>: part of every event on the target */
  common: boolean;
  /** Where it is defined, in layer order (`spec.events.payload.schema.<f>`, ...) */
  sites: string[];
  /** The effective policy, if any */
  policy?: FieldPolicy;
  /** A base layer after the one that declared the policy sets `value`, `enum` or `dict` */
  restrictedAfterPolicy: boolean;
  /** A base layer after the one that declared the policy sets `value` */
  fixedAfterPolicy: boolean;
}

/** A base definition as written, with the field merged up to and including its layer */
export interface BaseSite {
  /** Dotted path of the definition (`spec.targets.all.schema.<f>`) */
  path: string;
  name: string;
  written: Field;
  merged: Field;
}

export interface BaseMergeResult {
  /** The merged base fields of the target, in first-definition order */
  fields: Map<string, BaseField>;
  /** Problems between the layers, at the path of the later definition (`<site>[.<keyword>]`) */
  problems: Array<MergeProblem & { path: string }>;
  sites: BaseSite[];
}

/** Merges the base layers of a target (catalog -> spec.targets.all -> spec.targets.<T>) */
export function mergeBaseLayers(
  config: OpenTPConfig,
  targetId: string,
  dictionaryValues?: DictionaryLookup,
): BaseMergeResult {
  const fields = new Map<string, BaseField>();
  const problems: BaseMergeResult["problems"] = [];
  const sites: BaseSite[] = [];

  for (const layer of baseLayers(config, targetId)) {
    for (const [name, written] of Object.entries(layer.fields)) {
      const site = `${layer.path}.${name}`;
      const previous = fields.get(name);
      const merged = layerMerge(previous?.field, written, { layer: "base", dictionaryValues });
      for (const problem of merged.problems) {
        problems.push({ ...problem, path: problem.keyword ? `${site}.${problem.keyword}` : site });
      }

      const entry: BaseField = previous
        ? { ...previous, field: merged.field, sites: [...previous.sites, site] }
        : {
            field: merged.field,
            common: false,
            sites: [site],
            restrictedAfterPolicy: false,
            fixedAfterPolicy: false,
          };
      entry.common = entry.common || layer.common;

      // The declaring layer of the policy is the last one that set the effective policy
      if (isPolicy(written.policy) && merged.field.policy === written.policy) {
        entry.policy = written.policy;
        entry.restrictedAfterPolicy = false;
        entry.fixedAfterPolicy = false;
      } else if (entry.policy !== undefined) {
        if (written.value !== undefined) entry.fixedAfterPolicy = true;
        if (
          written.value !== undefined ||
          written.enum !== undefined ||
          written.dict !== undefined
        ) {
          entry.restrictedAfterPolicy = true;
        }
      }

      fields.set(name, entry);
      sites.push({ path: site, name, written, merged: merged.field });
    }
  }

  return { fields, problems, sites };
}

/** The merged base fields per target id (computed once per validation run) */
export class BaseFieldCache {
  private readonly byTarget = new Map<string, Map<string, BaseField>>();

  constructor(
    private readonly config: OpenTPConfig,
    private readonly dictionaryValues?: DictionaryLookup,
  ) {}

  forTarget(targetId: string): Map<string, BaseField> {
    let fields = this.byTarget.get(targetId);
    if (!fields) {
      fields = mergeBaseLayers(this.config, targetId, this.dictionaryValues).fields;
      this.byTarget.set(targetId, fields);
    }
    return fields;
  }
}
function resolveAliasOrVersion(
  name: string,
  versions: Record<string, PayloadVersion>,
  aliases: Record<string, string>,
  issues: PayloadIssue[],
  path: string,
): string | null {
  const visited = new Set<string>();
  let cur = name;

  while (true) {
    if (visited.has(cur)) {
      issues.push({ path, message: `Alias cycle detected at '${cur}'` });
      return null;
    }
    visited.add(cur);

    if (getOwn(versions, cur)) return cur;

    const next = getOwn(aliases, cur);
    if (typeof next !== "string") {
      issues.push({ path, message: `Reference '${name}' does not resolve to a version key` });
      return null;
    }
    cur = next;
  }
}

function resolveAllAliases(
  versions: Record<string, PayloadVersion>,
  aliases: Record<string, string>,
  issues: PayloadIssue[],
  basePath: string,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [alias, ref] of Object.entries(aliases)) {
    const key = resolveAliasOrVersion(ref, versions, aliases, issues, `${basePath}.${alias}`);
    if (key) setOwn(resolved, alias, key);
  }
  return resolved;
}

function resolveRefSchema(
  versionKey: string,
  versions: Record<string, PayloadVersion>,
  resolvedAliases: Record<string, string>,
  issues: PayloadIssue[],
  stack: string[],
  cache: Map<string, Record<string, Field>>,
  basePath: string,
  resolveExternalSchema?: (ref: string, fromPath: string) => Record<string, Field> | null,
  lookup?: DictionaryLookup,
): Record<string, Field> {
  if (cache.has(versionKey)) return cache.get(versionKey)!;
  if (stack.includes(versionKey)) {
    issues.push({
      path: `${basePath}.${versionKey}.$ref`,
      message: `Cycle detected in $ref: ${stack.join(" -> ")}`,
    });
    return getOwn(versions, versionKey)?.schema ?? {};
  }

  const version = getOwn(versions, versionKey);
  if (!version) return {};

  stack.push(versionKey);

  let schema: Record<string, Field> = version.schema;
  const ref = version.$ref;
  if (typeof ref === "string" && ref.length > 0) {
    const refPath = `${basePath}.${versionKey}.$ref`;

    // Cross-target / cross-selector reference: <targetOrSelector>::<versionOrAlias>
    if (ref.includes("::")) {
      const externalSchema = resolveExternalSchema?.(ref, refPath);
      if (externalSchema) {
        schema = refMerge(externalSchema, schema, issues, `${basePath}.${versionKey}`, lookup);
      } else if (!resolveExternalSchema) {
        issues.push({ path: refPath, message: `Unknown $ref target '${ref}'` });
      }
    } else {
      const refKey = getOwn(versions, ref)
        ? ref
        : (getOwn(resolvedAliases, ref) ??
          resolveAliasOrVersion(ref, versions, resolvedAliases, issues, refPath));
      if (refKey && refKey !== versionKey) {
        const baseSchema = resolveRefSchema(
          refKey,
          versions,
          resolvedAliases,
          issues,
          stack,
          cache,
          basePath,
          resolveExternalSchema,
          lookup,
        );
        schema = refMerge(baseSchema, schema, issues, `${basePath}.${versionKey}`, lookup);
      } else if (!refKey) {
        issues.push({ path: refPath, message: `Unknown $ref target '${ref}'` });
      }
    }
  } else if (ref !== undefined) {
    issues.push({ path: `${basePath}.${versionKey}.$ref`, message: "$ref must be a string" });
  }

  stack.pop();

  cache.set(versionKey, schema);
  return schema;
}

/**
 * Resolves an event payload per target: selectors, versions, aliases, `current` and `$ref`.
 * `covered` lists the targets that a selector covers (in `targets.all` order), also those whose
 * versions do not resolve (they are missing from `payload.targets` and reported in `issues`).
 * `dictionaryValues` lets a `$ref` version that narrows with `dict` or `items.dict` drop an
 * inherited example the dictionary does not allow (see refMergeField).
 */
export function resolveEventPayload(
  payload: EventPayload,
  config: OpenTPConfig,
  options: { dictionaryValues?: DictionaryLookup } = {},
): { payload: ResolvedEventPayload; issues: PayloadIssue[]; covered: string[] } {
  const lookup = options.dictionaryValues;
  const issues: PayloadIssue[] = [];

  const targetsConfig = config.spec.events.payload.targets;
  // An invalid targets.all is reported once against opentp.yaml (validateConfig)
  const allTargets: string[] = Array.isArray(targetsConfig.all) ? targetsConfig.all : [];
  const allTargetSet = new Set(allTargets);

  // Normalize to selector map
  const selectorMap: Record<string, TargetPayload> = {};
  const raw = payload as unknown;

  // The implicit form: one target payload for every target, written right under `payload`
  const implicit = isPayloadVersion(raw) || isVersionedTargetPayload(raw);
  if (implicit) {
    selectorMap.all = raw as TargetPayload;
  } else if (isPlainObject(raw)) {
    for (const [selector, value] of Object.entries(raw)) {
      setOwn(selectorMap, selector, value as TargetPayload);
    }
  } else {
    issues.push({ path: "payload", message: "Invalid payload: expected object" });
  }

  if (isPlainObject(raw) && Object.keys(selectorMap).length === 0) {
    issues.push({
      path: "payload",
      message: "Payload is empty: expected 'schema' or target selectors",
    });
  }

  // Parse selectors
  const selectors: Array<{
    name: string;
    targets: ReadonlySet<string>;
    payload: NormalizedTargetPayload;
  }> = [];

  const selectorPayloads: Record<string, NormalizedTargetPayload> = {};

  for (const [selectorName, selectorPayload] of Object.entries(selectorMap)) {
    const parsedPayload = parseTargetPayload(selectorPayload, issues, `payload.${selectorName}`);
    setOwn(selectorPayloads, selectorName, parsedPayload);

    let selectorTargets: string[] | undefined;
    const group = getOwn(targetsConfig as Record<string, unknown>, selectorName);
    if (Array.isArray(group)) {
      selectorTargets = group;
    } else if (allTargets.includes(selectorName)) {
      selectorTargets = [selectorName];
    } else {
      issues.push({
        path: `payload.${selectorName}`,
        message: `Unknown target selector '${selectorName}'. Define it in spec.events.payload.targets or include it in targets.all.`,
      });
      continue;
    }

    // Group members outside targets.all are reported once against opentp.yaml (validateConfig).
    // A selector left with no known target would never be validated, so it is an error here.
    if (!selectorTargets.some((target) => allTargetSet.has(target))) {
      issues.push({
        path: `payload.${selectorName}`,
        message: `Target selector '${selectorName}' does not cover any target listed in spec.events.payload.targets.all`,
      });
      continue;
    }

    selectors.push({
      name: selectorName,
      targets: new Set(selectorTargets),
      payload: parsedPayload,
    });
  }

  // Cross-target / cross-selector $ref resolution (tooling-defined syntax: <selector>::<versionOrAlias>)
  const selectorSchemaCache = new Map<string, Record<string, Field>>();

  function parseSelectorRef(
    ref: string,
    defaultSelector: string,
  ): { selector: string; name: string } | null {
    const idx = ref.indexOf("::");
    if (idx === -1) {
      return { selector: defaultSelector, name: ref };
    }

    const selector = ref.slice(0, idx).trim();
    const name = ref.slice(idx + 2).trim();
    if (selector.length === 0 || name.length === 0) return null;
    return { selector, name };
  }

  function resolveSelectorAliasOrVersion(
    selector: string,
    name: string,
    fromPath: string,
  ): { selector: string; versionKey: string } | null {
    const visited = new Set<string>();
    let cur = { selector, name };

    while (true) {
      const id = `${cur.selector}::${cur.name}`;
      if (visited.has(id)) {
        issues.push({ path: fromPath, message: `Alias cycle detected at '${id}'` });
        return null;
      }
      visited.add(id);

      const scope = getOwn(selectorPayloads, cur.selector);
      if (!scope) {
        issues.push({ path: fromPath, message: `Unknown target selector '${cur.selector}'` });
        return null;
      }

      if (getOwn(scope.versions, cur.name)) {
        return { selector: cur.selector, versionKey: cur.name };
      }

      const next = getOwn(scope.aliases, cur.name);
      if (typeof next !== "string") {
        issues.push({
          path: fromPath,
          message: `Reference '${id}' does not resolve to a version key`,
        });
        return null;
      }

      const parsed = parseSelectorRef(next, cur.selector);
      if (!parsed) {
        issues.push({ path: fromPath, message: `Invalid reference '${next}'` });
        return null;
      }
      cur = parsed;
    }
  }

  function resolveSelectorSchema(
    selector: string,
    versionKey: string,
    stack: string[],
  ): Record<string, Field> {
    const cacheKey = `${selector}::${versionKey}`;
    if (selectorSchemaCache.has(cacheKey)) return selectorSchemaCache.get(cacheKey)!;

    if (stack.includes(cacheKey)) {
      issues.push({
        path: `payload.${selector}.${versionKey}.$ref`,
        message: `Cycle detected in $ref: ${stack.join(" -> ")}`,
      });
      const scope = getOwn(selectorPayloads, selector);
      const fallback = (scope && getOwn(scope.versions, versionKey)?.schema) ?? {};
      selectorSchemaCache.set(cacheKey, fallback);
      return fallback;
    }

    const scope = getOwn(selectorPayloads, selector);
    const version = scope ? getOwn(scope.versions, versionKey) : undefined;
    if (!scope || !version) {
      const empty: Record<string, Field> = {};
      selectorSchemaCache.set(cacheKey, empty);
      return empty;
    }

    stack.push(cacheKey);

    let schema: Record<string, Field> = version.schema;
    const ref = version.$ref;
    const refPath = `payload.${selector}.${versionKey}.$ref`;

    if (typeof ref === "string" && ref.length > 0) {
      const parsed = parseSelectorRef(ref, selector);
      if (!parsed) {
        issues.push({
          path: refPath,
          message: `Invalid $ref '${ref}'. Expected '<target>::<versionOrAlias>' or '<versionOrAlias>'`,
        });
      } else {
        const resolved = resolveSelectorAliasOrVersion(parsed.selector, parsed.name, refPath);
        if (resolved) {
          const resolvedKey = `${resolved.selector}::${resolved.versionKey}`;
          if (resolvedKey !== cacheKey) {
            const baseSchema = resolveSelectorSchema(resolved.selector, resolved.versionKey, stack);
            schema = refMerge(
              baseSchema,
              schema,
              issues,
              `payload.${selector}.${versionKey}`,
              lookup,
            );
          }
        }
      }
    } else if (ref !== undefined) {
      issues.push({ path: refPath, message: "$ref must be a string" });
    }

    stack.pop();

    selectorSchemaCache.set(cacheKey, schema);
    return schema;
  }

  const resolveExternalSchema = (ref: string, fromPath: string): Record<string, Field> | null => {
    const parsed = parseSelectorRef(ref, "");
    if (!parsed) {
      issues.push({
        path: fromPath,
        message: `Invalid $ref '${ref}'. Expected '<target>::<versionOrAlias>'`,
      });
      return null;
    }

    const resolved = resolveSelectorAliasOrVersion(parsed.selector, parsed.name, fromPath);
    if (!resolved) return null;

    return resolveSelectorSchema(resolved.selector, resolved.versionKey, []);
  };

  const resolvedTargets: Record<string, ResolvedTargetPayload> = {};

  // No-overlap rule: each target may be covered at most once.
  const targetToSelector = new Map<string, string>();
  for (const selector of selectors) {
    for (const target of selector.targets) {
      if (!allTargetSet.has(target)) continue;
      const prev = targetToSelector.get(target);
      if (prev) {
        issues.push({
          path: `payload.${target}`,
          message: `Target '${target}' is covered by both '${prev}' and '${selector.name}'. Each target must be covered at most once.`,
        });
        continue;
      }
      targetToSelector.set(target, selector.name);
    }
  }

  for (const target of allTargets) {
    const selectorName = targetToSelector.get(target);
    if (!selectorName) continue;

    const selected = getOwn(selectorPayloads, selectorName);
    if (!selected) continue;

    // Resolve aliases and current for the selected payload key
    const basePath = `payload.${selectorName}`;
    const resolvedAliases = resolveAllAliases(
      selected.versions,
      selected.aliases,
      issues,
      `${basePath}.aliases`,
    );

    const currentKey = resolveAliasOrVersion(
      selected.currentRef,
      selected.versions,
      { ...selected.aliases, ...resolvedAliases },
      issues,
      `${basePath}.current`,
    );

    if (!currentKey) continue;

    // Resolve $ref schemas
    const cache = new Map<string, Record<string, Field>>();
    const resolvedVersions: Record<string, ResolvedPayloadVersion> = {};
    const writtenBase = implicit ? "payload" : basePath;

    for (const versionKey of selected.versionOrder) {
      const version = getOwn(selected.versions, versionKey) as PayloadVersion;
      const schema = resolveRefSchema(
        versionKey,
        selected.versions,
        resolvedAliases,
        issues,
        [],
        cache,
        basePath,
        resolveExternalSchema,
        lookup,
      );
      setOwn(resolvedVersions, versionKey, {
        key: versionKey,
        $ref: version.$ref,
        meta: version.meta,
        schema,
        ownSchema: version.schema,
        writtenPath: selected.isUnversioned
          ? `${writtenBase}.schema`
          : `${writtenBase}.${versionKey}.schema`,
      });
    }

    setOwn(resolvedTargets, target, {
      target,
      current: currentKey,
      aliases: resolvedAliases,
      versions: resolvedVersions,
      versionOrder: selected.versionOrder,
    });
  }

  // A selector that covers several targets resolves its versions once per target: report each
  // resolution problem once
  return {
    payload: { targets: resolvedTargets },
    issues: uniqueIssues(issues),
    covered: allTargets.filter((target) => targetToSelector.has(target)),
  };
}

function uniqueIssues(issues: PayloadIssue[]): PayloadIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const id = `${issue.path}\u0000${issue.message}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

// --- Effective payload ---------------------------------------------------------------------------

/** Where the definition of an effective field comes from */
export type FieldLayer = "catalog" | "all" | "target" | "event";

/** One field of the effective field set of an event version on a target */
export interface EffectiveField {
  /** The merged definition (catalog -> spec.targets.all -> spec.targets.<T> -> event) */
  field: Field;
  /** The layers that define it, in merge order */
  layers: FieldLayer[];
  /** The event layer's definition (after `$ref`), when the event lists the field */
  event?: Field;
  /** The merged base field, when the field is in the catalog or a common field of the target */
  base?: BaseField;
  /** Problems of the event layer against the base layers */
  problems: MergeProblem[];
}

/**
 * The effective field set of one event version on one target: every common field of the target
 * plus every field of the event layer (after `$ref`), each merged over the base layers. A field of
 * the event layer that is neither a catalog field nor a common field (closed vocabulary) is listed
 * with its event definition only and no `base`.
 */
export function effectiveFields(
  eventSchema: Record<string, Field>,
  baseFields: Map<string, BaseField>,
  dictionaryValues?: DictionaryLookup,
): Map<string, EffectiveField> {
  const out = new Map<string, EffectiveField>();
  const layersOf = (base: BaseField): FieldLayer[] =>
    base.sites.map((site) =>
      site.startsWith(`${CATALOG_PATH}.`)
        ? "catalog"
        : site.startsWith("spec.targets.all.")
          ? "all"
          : "target",
    );

  for (const [name, base] of baseFields) {
    if (base.common) {
      out.set(name, { field: base.field, layers: layersOf(base), base, problems: [] });
    }
  }
  for (const [name, written] of Object.entries(eventSchema)) {
    const base = baseFields.get(name);
    if (!base) {
      out.set(name, { field: written, layers: ["event"], event: written, problems: [] });
      continue;
    }
    const merged = layerMerge(base.field, written, { layer: "event", dictionaryValues });
    out.set(name, {
      field: merged.field,
      layers: [...layersOf(base), "event"],
      event: written,
      base,
      problems: merged.problems,
    });
  }
  return out;
}

/** The effective fields of every version of one target (see resolveEffectivePayload) */
export interface EffectiveTargetPayload {
  target: string;
  /** The current version key (UNVERSIONED_VERSION_KEY for an unversioned payload) */
  current: string;
  aliases: Record<string, string>;
  /** Version key -> effective field name -> merged definition */
  versions: Record<string, Record<string, Field>>;
  /** Version key -> effective field name -> the layers that define it */
  layers: Record<string, Record<string, FieldLayer[]>>;
}

/**
 * The 2026-09 effective payload of every covered target and version: the common fields of the
 * target (spec.targets.all and spec.targets.<T>, over the catalog) plus the fields the version lists
 * (with `$ref` resolved), each merged over the catalog and common fields with layerMerge, as
 * validatePayload does. Catalog fields the event does not list are not part of it. Merge problems
 * are not reported here (validatePayload does); resolution issues are returned.
 */
export function resolveEffectivePayload(
  payload: EventPayload,
  config: OpenTPConfig,
  dictionaryValues?: DictionaryLookup,
): { targets: Record<string, EffectiveTargetPayload>; issues: PayloadIssue[] } {
  const { payload: resolved, issues } = resolveEventPayload(payload, config, { dictionaryValues });
  const cache = new BaseFieldCache(config, dictionaryValues);
  const targets: Record<string, EffectiveTargetPayload> = {};

  for (const [targetId, targetPayload] of Object.entries(resolved.targets)) {
    const baseFields = cache.forTarget(targetId);
    const versions: EffectiveTargetPayload["versions"] = {};
    const layers: EffectiveTargetPayload["layers"] = {};
    for (const [versionKey, version] of Object.entries(targetPayload.versions)) {
      const fields = effectiveFields(version.schema, baseFields, dictionaryValues);
      versions[versionKey] = Object.fromEntries(
        [...fields].map(([name, entry]) => [name, entry.field]),
      );
      layers[versionKey] = Object.fromEntries(
        [...fields].map(([name, entry]) => [name, entry.layers]),
      );
    }
    targets[targetId] = {
      target: targetId,
      current: targetPayload.current,
      aliases: targetPayload.aliases,
      versions,
      layers,
    };
  }

  return { targets, issues };
}
