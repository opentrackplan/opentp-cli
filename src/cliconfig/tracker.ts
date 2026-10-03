/**
 * The tracker binding (D3): `tracker` in opentp.cli.yaml says where each plan field travels inside a
 * tracker payload (Snowplow, GA4, Amplitude, Segment or a generic JSON payload). It is tool
 * configuration, not identity: it never changes which hits are which event or which values are
 * valid, only where generated code puts a field.
 *
 * - getTrackerProblems: the section checked against the plan. The problems are validation errors
 *   with event "opentp.cli.yaml" and a `tracker.<...>` path: `validate` exits 1, `fix` rewrites
 *   nothing, `generate` refuses, MCP validate_plan lists them (`event` and `contexts` on a type
 *   other than snowplow included). Shape errors (unknown keys, wrong value types) are found
 *   earlier, when the file is read (exit 2). In an application repository (TrackerOrigin), a
 *   problem at a key that only the plan repository's file has carries that file's label.
 * - resolveTracker / resolveTrackerBinding: the path of every catalog field and every common field
 *   per target (GeneratorContext.tracker, MCP describe_plan).
 * - mergeTrackerSections: an application repository's section over the plan repository's.
 *
 * Resolution per target T and field f, first match wins: (1) the exact name in
 * `targets.T.map`, (2) the exact name in `map`, (3) the globs of `targets.T.map`, (4) the globs of
 * `map`; else the unmapped default of the type. A path that ends at a container gets the field name
 * as its last segment. Paths written in a map follow the segment grammar; an appended field name is
 * one segment whatever it contains (`Item Name`, `page.url`), so a binding keeps its `segments`.
 */

import type { ConfigIssue } from "../core/config";
import { didYouMean, naturalCompare, suggestNames, targetIds } from "../core/fields";
import { baseLayers } from "../core/payload";
import type { OpenTPConfig } from "../types";
import { isYamlMapping, setOwn } from "../util";
import type { CliTracker, TrackerType } from "./schema";

export type { CliTracker } from "./schema";
export { TRACKER_TYPES, type TrackerType } from "./schema";

/** Who sets a field instead of the code that tracks the event */
export type TrackerSetBy = "app" | "tracker";

/** Where one field travels on one target */
export interface TrackerFieldBinding {
  /**
   * Dot path in the tracker payload for display, e.g. `contexts.dimensions.dimension_1` or
   * `atomic.app_id`. An appended field name is written as it is, even when it contains a `.`.
   */
  path: string;
  /** The path as segments; an appended field name is one segment (`["event_properties", "page.url"]`) */
  segments: string[];
  /** Set once by the application (`app`) or filled by the tracker or collector (`tracker`) */
  setBy?: TrackerSetBy;
}

/** The binding of one target */
export interface TrackerTargetBinding {
  type: TrackerType;
  /** Snowplow: Iglu URI of the event schema (`tracker.event`) */
  event?: string;
  /** Snowplow: context schemas by alias (`tracker.contexts` and `tracker.targets.<T>.contexts`) */
  contexts: Record<string, string>;
  /** Every catalog field and every common field of the target, in natural order */
  fields: Record<string, TrackerFieldBinding>;
}

/** The resolved binding per target id (in `spec.events.payload.targets.all` order) */
export type TrackerBinding = Record<string, TrackerTargetBinding>;

export interface TrackerResolution {
  binding: TrackerBinding;
  /**
   * Problems at `tracker.<...>` (validation errors against "opentp.cli.yaml", or against the plan
   * repository's file: ConfigIssue.file)
   */
  problems: ConfigIssue[];
}

/**
 * Application repository mode: the section in effect is the application's merged over the plan
 * repository's (mergeTrackerSections), so a problem can be at a key that only the plan repository's
 * opentp.cli.yaml has. Such a problem carries `planLabel` as its file.
 */
export interface TrackerOrigin {
  /** The application file's own tracker section, as written (absent: every key is the plan's) */
  app: CliTracker | undefined;
  /** The label of the plan repository's file: `opentp.cli.yaml of the plan '<plan>'` */
  planLabel: string;
}

// --- Path grammar --------------------------------------------------------------------------------

/** One segment of a tracker path */
export const TRACKER_SEGMENT = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const SEGMENT_TEXT = "[A-Za-z_][A-Za-z0-9_-]*";

/** An Iglu schema URI: iglu:<vendor>/<name>/jsonschema/<model>-<revision>-<addition> */
export const IGLU_URI = /^iglu:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/jsonschema\/[0-9]+-[0-9]+-[0-9]+$/;

/**
 * What may follow a root segment:
 * - `exact`: nothing (`user_id`);
 * - `name`: nothing (a container) or one segment (`params[.<name>]`);
 * - `path`: nothing (a container) or any segments (`event[.<path>]`);
 * - `column`: exactly one segment (`atomic.<column>`);
 * - `alias`: an alias (a container), then any segments (`contexts.<alias>[.<path>]`).
 */
type RootKind = "exact" | "name" | "path" | "column" | "alias";

/** The roots of each type (generic: any dot path, no containers) */
const GRAMMAR: Record<TrackerType, ReadonlyMap<string, RootKind> | null> = {
  snowplow: new Map([
    ["atomic", "column"],
    ["event", "path"],
    ["contexts", "alias"],
  ]),
  ga4: new Map([
    ["params", "name"],
    ["user_properties", "name"],
    ["user_id", "exact"],
    ["client_id", "exact"],
    ["name", "exact"],
  ]),
  amplitude: new Map([
    ["event_type", "exact"],
    ["event_properties", "name"],
    ["user_properties", "name"],
    ["groups", "name"],
    ["group_properties", "name"],
    ["user_id", "exact"],
    ["device_id", "exact"],
  ]),
  segment: new Map([
    ["event", "exact"],
    ["properties", "name"],
    ["traits", "name"],
    ["context", "path"],
    ["userId", "exact"],
    ["anonymousId", "exact"],
  ]),
  generic: null,
};

/** Where a field without a map entry goes: this container plus its name (generic: its name) */
export const UNMAPPED_CONTAINER: Readonly<Record<TrackerType, string | null>> = {
  snowplow: "event",
  ga4: "params",
  amplitude: "event_properties",
  segment: "properties",
  generic: null,
};

function formText(root: string, kind: RootKind): string {
  switch (kind) {
    case "exact":
      return root;
    case "name":
      return `${root}[.<name>]`;
    case "path":
      return `${root}[.<path>]`;
    case "column":
      return `${root}.<column>`;
    case "alias":
      return `${root}.<alias>[.<path>]`;
  }
}

/** `a`, `a or b`, `a, b or c` (or with `and`) */
function listText(items: readonly string[], conjunction: "or" | "and" = "or"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;
}

/** The path forms of a type, for messages and docs */
export function trackerPathForms(type: TrackerType): string[] {
  const grammar = GRAMMAR[type];
  if (grammar === null) return ["any dot path"];
  return [...grammar].map(([root, kind]) => formText(root, kind));
}

/** A path that fits the grammar of its type */
export interface TrackerPathShape {
  /** The path ends at a container: the field name is appended */
  container: boolean;
  /** Snowplow: the context alias the path goes through */
  alias?: string;
}

/** Checks a path written in a map against the grammar of the tracker type */
export function analyzeTrackerPath(
  type: TrackerType,
  path: string,
): { shape: TrackerPathShape; problem?: undefined } | { shape?: undefined; problem: string } {
  const segments = path.split(".");
  if (!segments.every((segment) => TRACKER_SEGMENT.test(segment))) {
    return {
      problem: `Invalid path '${path}': segments are separated by '.' and match ${SEGMENT_TEXT}`,
    };
  }
  const grammar = GRAMMAR[type];
  if (grammar === null) return { shape: { container: false } };

  const count = segments.length;
  switch (grammar.get(segments[0])) {
    case "exact":
      if (count === 1) return { shape: { container: false } };
      break;
    case "name":
      if (count <= 2) return { shape: { container: count === 1 } };
      break;
    case "path":
      return { shape: { container: count === 1 } };
    case "column":
      if (count === 2) return { shape: { container: false } };
      break;
    case "alias":
      if (count >= 2) return { shape: { container: count === 2, alias: segments[1] } };
      break;
  }
  return {
    problem: `Invalid path '${path}' for tracker type ${type}: expected ${listText(trackerPathForms(type))}`,
  };
}

// --- Field names and globs -----------------------------------------------------------------------

/** A map key or setBy entry with `*` is a glob; any other is a field name */
export function isTrackerGlob(pattern: string): boolean {
  return pattern.includes("*");
}

/**
 * Whether a glob matches a whole name: `*` matches any text (also none), every other character
 * itself. No regex: the first and last parts are a prefix and a suffix, and the parts between are
 * found left to right (the leftmost match of each part is always the best), so the time is linear
 * in the name, whatever the number of stars.
 */
export function trackerGlobMatches(glob: string, name: string): boolean {
  const parts = glob.split("*");
  if (parts.length === 1) return glob === name;
  const first = parts[0];
  const last = parts[parts.length - 1];
  const end = name.length - last.length;
  if (end < first.length || !name.startsWith(first) || !name.endsWith(last)) return false;
  let position = first.length;
  for (const part of parts.slice(1, -1)) {
    if (part === "") continue;
    const found = name.indexOf(part, position);
    if (found === -1 || found + part.length > end) return false;
    position = found + part.length;
  }
  return true;
}

/** The fields a name or glob selects among `candidates` */
function selectFields(pattern: string, candidates: readonly string[]): string[] {
  if (!isTrackerGlob(pattern)) return candidates.includes(pattern) ? [pattern] : [];
  return candidates.filter((name) => trackerGlobMatches(pattern, name));
}

/** Catalog fields and the common fields of a target (spec.targets.all and spec.targets.<T>) */
function baseFieldNames(config: OpenTPConfig, targetId: string): string[] {
  const names = new Set<string>();
  for (const layer of baseLayers(config, targetId)) {
    for (const name of Object.keys(layer.fields)) names.add(name);
  }
  return [...names].sort(naturalCompare);
}

// --- Resolution ----------------------------------------------------------------------------------

/** Problems in insertion order, each (path, message) once */
class ProblemList {
  readonly items: ConfigIssue[] = [];
  private readonly seen = new Set<string>();

  add(path: string, message: string): void {
    const id = `${path}\0${message}`;
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.items.push({ path, message });
  }
}

/** One entry of `map` or `targets.<T>.map` */
interface MapEntry {
  key: string;
  /** The path as written */
  path: string;
  /** Where it is written: `tracker.map.<key>` or `tracker.targets.<T>.map.<key>` */
  where: string;
  /** The target of `targets.<T>.map`, null for the global map */
  targetId: string | null;
  /** The key is a glob */
  glob: boolean;
  /** null: the path does not fit the grammar (reported) */
  shape: TrackerPathShape | null;
}

/** Who a field's final path came from: a map entry, or the unmapped default (`tracker`) */
interface Placement {
  field: string;
  path: string;
  segments: string[];
  where: string;
}

function mapEntries(
  map: Record<string, string> | undefined,
  base: string,
  type: TrackerType,
  candidates: readonly string[],
  targetId: string | null,
  problems: ProblemList,
): MapEntry[] {
  const entries: MapEntry[] = [];
  for (const [key, path] of Object.entries(map ?? {})) {
    const where = `${base}.${key}`;
    checkFieldPattern(key, where, candidates, targetId, problems);
    const analyzed = analyzeTrackerPath(type, path);
    if (analyzed.problem !== undefined) problems.add(where, analyzed.problem);
    entries.push({
      key,
      path,
      where,
      targetId,
      glob: isTrackerGlob(key),
      shape: analyzed.shape ?? null,
    });
  }
  return entries;
}

/** A map key or setBy entry must name a field, or be a glob that matches at least one */
function checkFieldPattern(
  pattern: string,
  where: string,
  candidates: readonly string[],
  targetId: string | null,
  problems: ProblemList,
): string[] {
  const selected = selectFields(pattern, candidates);
  if (selected.length > 0) return selected;
  const scope =
    targetId === null
      ? "a catalog field (spec.events.payload.schema) or a common field (spec.targets)"
      : `a catalog field or a common field of target '${targetId}' (spec.targets.all/${targetId}.schema)`;
  if (isTrackerGlob(pattern)) {
    problems.add(where, `'${pattern}' matches no field: expected it to match ${scope}`);
  } else {
    problems.add(
      where,
      `Unknown field '${pattern}': expected ${scope}${didYouMean(suggestNames(pattern, candidates))}`,
    );
  }
  return [];
}

function onlySnowplow(key: "event" | "contexts"): string {
  return `'${key}' is only allowed for tracker type snowplow`;
}

function checkIgluUri(uri: string, where: string, problems: ProblemList): void {
  if (!IGLU_URI.test(uri)) {
    problems.add(
      where,
      `Invalid Iglu URI '${uri}': expected iglu:<vendor>/<name>/jsonschema/<model>-<revision>-<addition>`,
    );
  }
}

function checkContexts(
  contexts: Record<string, string> | undefined,
  base: string,
  problems: ProblemList,
): void {
  for (const [alias, uri] of Object.entries(contexts ?? {})) {
    const where = `${base}.${alias}`;
    if (!TRACKER_SEGMENT.test(alias)) {
      problems.add(where, `Invalid context alias '${alias}': it must match ${SEGMENT_TEXT}`);
    }
    checkIgluUri(uri, where, problems);
  }
}

/**
 * The map entry that places `field`: exact names before globs, the target's map before the global
 * one. Two globs of the same step that place it at different paths are a problem (the first wins).
 */
function findEntry(
  field: string,
  steps: ReadonlyArray<{ entries: MapEntry[]; where: string }>,
  problems: ProblemList,
): MapEntry | null {
  for (const { entries } of steps) {
    const exact = entries.find((entry) => !entry.glob && entry.key === field);
    if (exact) return exact;
  }
  for (const { entries, where } of steps) {
    const matching = entries.filter((entry) => entry.glob && trackerGlobMatches(entry.key, field));
    if (matching.length === 0) continue;
    const [first, ...others] = matching;
    for (const other of others) {
      if (other.path === first.path) continue;
      problems.add(
        where,
        `Field '${field}' matches the globs '${first.key}' (${first.path}) and '${other.key}' (${other.path}): add an exact entry for it or make the globs disjoint`,
      );
    }
    return first;
  }
  return null;
}

/** A field name appended to a container (null: the name alone): one segment, whatever it contains */
function appendLeaf(container: string | null, field: string): { path: string; segments: string[] } {
  if (container === null) return { path: field, segments: [field] };
  return { path: `${container}.${field}`, segments: [...container.split("."), field] };
}

/** A key for a list of segments (a `.` inside a segment stays apart from a separator) */
function segmentsKey(segments: readonly string[]): string {
  return JSON.stringify(segments);
}

/** Problems found on several targets, reported once with the list of targets */
class PerTarget {
  private readonly groups = new Map<
    string,
    { where: string; message: string; targets: string[] }
  >();

  add(where: string, message: string, targetId: string): void {
    const id = `${where}\0${message}`;
    const group = this.groups.get(id);
    if (group) {
      if (!group.targets.includes(targetId)) group.targets.push(targetId);
    } else {
      this.groups.set(id, { where, message, targets: [targetId] });
    }
  }

  report(problems: ProblemList): void {
    for (const { where, message, targets } of this.groups.values()) {
      problems.add(
        where,
        `${message} (${targets.length === 1 ? "target" : "targets"}: ${targets.join(", ")})`,
      );
    }
  }
}

/**
 * Every key of a tracker section as a problem path names it: `tracker`, `tracker.map.<key>`,
 * `tracker.setBy.app[0]`, `tracker.targets.<T>.contexts.<alias>`, ...
 */
function trackerKeyPaths(value: unknown, at = "tracker", out = new Set<string>()): Set<string> {
  out.add(at);
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      trackerKeyPaths(item, `${at}[${index}]`, out);
    });
  } else if (isYamlMapping(value)) {
    for (const [key, item] of Object.entries(value)) trackerKeyPaths(item, `${at}.${key}`, out);
  }
  return out;
}

/**
 * The problems, with the plan repository's label on those at a key that the application file does
 * not write (the key, and so the problem, comes only from the plan repository's file). A problem at
 * a key that both files write, or that comes from both sections together (`tracker.setBy`,
 * `tracker`), stays the application's.
 */
function labelPlanProblems(
  problems: ConfigIssue[],
  origin: TrackerOrigin | undefined,
): ConfigIssue[] {
  if (origin === undefined) return problems;
  const written = origin.app === undefined ? new Set<string>() : trackerKeyPaths(origin.app);
  return problems.map((problem) =>
    written.has(problem.path) ? problem : { ...problem, file: origin.planLabel },
  );
}

/**
 * Resolves the tracker section against the plan: the binding per target and its problems.
 * `origin` (application repository mode) labels the problems that come from the plan repository's
 * file.
 * @returns null when there is no tracker section
 */
export function resolveTracker(
  tracker: CliTracker | null | undefined,
  config: OpenTPConfig,
  origin?: TrackerOrigin,
): TrackerResolution | null {
  if (tracker === null || tracker === undefined) return null;
  const problems = new ProblemList();
  const type = tracker.type;
  const snowplow = tracker.type === "snowplow";

  const targets = targetIds(config);
  const fieldsByTarget = new Map(targets.map((id) => [id, baseFieldNames(config, id)]));
  const planFields = [
    ...new Set([...baseFieldNames(config, "all"), ...[...fieldsByTarget.values()].flat()]),
  ].sort(naturalCompare);

  // Envelope (snowplow): the event schema and the context schemas by alias. The shape accepts
  // both keys for every type, so a binding written for snowplow is a validation error elsewhere.
  if (snowplow) {
    if (tracker.event !== undefined) checkIgluUri(tracker.event, "tracker.event", problems);
    checkContexts(tracker.contexts, "tracker.contexts", problems);
  } else {
    if (tracker.event !== undefined) problems.add("tracker.event", onlySnowplow("event"));
    if (tracker.contexts !== undefined) problems.add("tracker.contexts", onlySnowplow("contexts"));
  }
  const globalContexts: Record<string, string> = snowplow ? { ...tracker.contexts } : {};

  // setBy: fields the application or the tracker sets
  const setBy = new Map<string, TrackerSetBy>();
  const setByTracker = new Set<string>();
  for (const side of ["app", "tracker"] as const) {
    (tracker.setBy?.[side] ?? []).forEach((pattern, index) => {
      const fields = checkFieldPattern(
        pattern,
        `tracker.setBy.${side}[${index}]`,
        planFields,
        null,
        problems,
      );
      for (const field of fields) {
        if (side === "app") setBy.set(field, "app");
        else setByTracker.add(field);
      }
    });
  }
  for (const field of [...setByTracker].sort(naturalCompare)) {
    if (setBy.get(field) === "app") {
      problems.add("tracker.setBy", `Field '${field}' is in both setBy.app and setBy.tracker`);
    } else {
      setBy.set(field, "tracker");
    }
  }

  // The global map, then the per-target overrides
  const globalEntries = mapEntries(tracker.map, "tracker.map", type, planFields, null, problems);
  const overrides = new Map<string, { entries: MapEntry[]; contexts: Record<string, string> }>();
  for (const [targetId, override] of Object.entries(tracker.targets ?? {})) {
    const base = `tracker.targets.${targetId}`;
    if (!snowplow && override.contexts !== undefined) {
      problems.add(`${base}.contexts`, onlySnowplow("contexts"));
    }
    if (!targets.includes(targetId)) {
      problems.add(
        base,
        targets.length > 0
          ? `Unknown target '${targetId}': expected one of ${targets.join(", ")} (spec.events.payload.targets.all)`
          : `Unknown target '${targetId}': spec.events.payload.targets.all lists no targets`,
      );
      continue;
    }
    const contexts: Record<string, string> = {};
    if (snowplow) {
      checkContexts(override.contexts, `${base}.contexts`, problems);
      Object.assign(contexts, override.contexts);
    }
    const entries = mapEntries(
      override.map,
      `${base}.map`,
      type,
      fieldsByTarget.get(targetId) ?? [],
      targetId,
      problems,
    );
    for (const entry of entries) {
      const alias = entry.shape?.alias;
      if (
        alias !== undefined &&
        !Object.hasOwn(globalContexts, alias) &&
        !Object.hasOwn(contexts, alias)
      ) {
        problems.add(
          entry.where,
          `Context alias '${alias}' is not declared in tracker.contexts or ${base}.contexts`,
        );
      }
    }
    overrides.set(targetId, { entries, contexts });
  }

  // Resolution per target
  const binding: TrackerBinding = {};
  const sharedPaths = new PerTarget();
  const missingAliases = new PerTarget();
  const unusedGlobalAliases = new Set<MapEntry>(
    globalEntries.filter(
      (entry) =>
        entry.shape?.alias !== undefined && !Object.hasOwn(globalContexts, entry.shape.alias),
    ),
  );
  for (const targetId of targets) {
    const override = overrides.get(targetId);
    const contexts = { ...globalContexts, ...override?.contexts };
    const steps = [
      { entries: override?.entries ?? [], where: `tracker.targets.${targetId}.map` },
      { entries: globalEntries, where: "tracker.map" },
    ];
    const fields: Record<string, TrackerFieldBinding> = {};
    // By segmentsKey of the final path
    const placements = new Map<string, Placement[]>();

    for (const field of fieldsByTarget.get(targetId) ?? []) {
      const entry = findEntry(field, steps, problems);
      let placed: { path: string; segments: string[] };
      let where: string;
      if (entry) {
        where = entry.where;
        if (entry.shape === null) continue;
        const alias = entry.shape.alias;
        if (alias !== undefined && entry.targetId === null) {
          unusedGlobalAliases.delete(entry);
          if (!Object.hasOwn(contexts, alias)) {
            missingAliases.add(
              entry.where,
              `Context alias '${alias}' is not declared in tracker.contexts or tracker.targets.<id>.contexts`,
              targetId,
            );
          }
        }
        placed = entry.shape.container
          ? appendLeaf(entry.path, field)
          : { path: entry.path, segments: entry.path.split(".") };
      } else {
        where = "tracker";
        placed = appendLeaf(UNMAPPED_CONTAINER[type], field);
      }

      const { path, segments } = placed;
      const placement = { field, path, segments, where };
      const id = segmentsKey(segments);
      const shared = placements.get(id);
      if (shared) shared.push(placement);
      else placements.set(id, [placement]);
      const who = setBy.get(field);
      setOwn(
        fields,
        field,
        who === undefined ? { path, segments } : { path, segments, setBy: who },
      );
    }

    for (const [first, ...others] of placements.values()) {
      // Two fields at one path: reported at the first map entry involved (unmapped: `tracker`)
      if (others.length > 0) {
        const names = [first, ...others].map((placement) => `'${placement.field}'`);
        const mapped = [...others, first].find((placement) => placement.where !== "tracker");
        sharedPaths.add(
          mapped?.where ?? "tracker",
          `Fields ${listText(names, "and")} map to the same path '${first.path}'`,
          targetId,
        );
      }
      // A path inside another field's path: one of them would have to be an object
      for (let length = 1; length < first.segments.length; length += 1) {
        const outer = placements.get(segmentsKey(first.segments.slice(0, length)))?.[0];
        if (!outer) continue;
        sharedPaths.add(
          first.where,
          `Field '${first.field}' maps to '${first.path}', inside the path '${outer.path}' of field '${outer.field}'`,
          targetId,
        );
      }
    }

    binding[targetId] = {
      type,
      ...(snowplow && tracker.event !== undefined ? { event: tracker.event } : {}),
      contexts: snowplow ? contexts : {},
      fields,
    };
  }

  // A global entry through an alias that no target declares, even where it places no field
  const declaredSomewhere = new Set(
    [...overrides.values()].flatMap((override) => Object.keys(override.contexts)),
  );
  for (const entry of unusedGlobalAliases) {
    const alias = entry.shape?.alias as string;
    if (!declaredSomewhere.has(alias)) {
      problems.add(entry.where, `Context alias '${alias}' is not declared in tracker.contexts`);
    }
  }
  missingAliases.report(problems);
  sharedPaths.report(problems);

  return { binding, problems: labelPlanProblems(problems.items, origin) };
}

/** The problems of the tracker section (none without one); see resolveTracker for `origin` */
export function getTrackerProblems(
  tracker: CliTracker | null | undefined,
  config: OpenTPConfig,
  origin?: TrackerOrigin,
): ConfigIssue[] {
  return resolveTracker(tracker, config, origin)?.problems ?? [];
}

/** The resolved binding per target, or null without a tracker section */
export function resolveTrackerBinding(
  tracker: CliTracker | null | undefined,
  config: OpenTPConfig,
): TrackerBinding | null {
  return resolveTracker(tracker, config)?.binding ?? null;
}

// --- Application repositories --------------------------------------------------------------------

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isYamlMapping(base) || !isYamlMapping(override)) return override;
  const merged = new Map<string, unknown>(Object.entries(base));
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    merged.set(key, Object.hasOwn(base, key) ? deepMerge(base[key], value) : value);
  }
  // fromEntries defines own properties, so a key such as `__proto__` stays a plain key
  return Object.fromEntries(merged);
}

/**
 * An application repository's tracker section over the plan repository's (application repository
 * mode): mappings merge key by key (`map`, `contexts`, `setBy`, `targets` and the mappings inside
 * them) and the application wins; arrays (`setBy` lists) and scalars are replaced. When the
 * application names another `type`, its section replaces the plan repository's whole: the plan's
 * paths, contexts and event schema follow another grammar. Both sections have the shape that
 * opentp.cli.yaml allows, so the result has it too.
 */
export function mergeTrackerSections(
  base: CliTracker | null | undefined,
  app: CliTracker | null | undefined,
): CliTracker | undefined {
  if (base === null || base === undefined) return app ?? undefined;
  if (app === null || app === undefined) return base;
  if (app.type !== base.type) return app;
  return deepMerge(base, app) as CliTracker;
}
