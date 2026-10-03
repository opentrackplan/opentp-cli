/**
 * Overlapping events (tool rule `overlap`; opentp-spec docs/semantics.md, "Event predicate and
 * overlap").
 *
 * The predicate of an event version on a target is the AND over its effective field set (the
 * 2026-09 merge of payload.ts: common fields of the target plus the fields the version lists):
 * - a fixed `value` allows exactly that value (arrays: equal element by element);
 * - an `enum`, or a `dict` with known values, allows those values, plus ABSENT (missing or null)
 *   when the field is optional (not required, no fixed value, no restricted or fixed policy; a
 *   policy does not make a field present in a version marked `meta.deprecated`);
 * - every other field is free: arrays without a value (`items.enum` is a constraint, not identity),
 *   fields with an unknown dictionary, fields with no restriction.
 * Versions are OR-ed. Two events overlap on a target when a version predicate of one and a version
 * predicate of the other can match the same hit: every field that both constrain has a common
 * allowed element. A field constrained by only one of them, or outside one field set, does not
 * tell them apart.
 *
 * Kinds per intersecting version pair: `identical` (each contains the other), `contains` (one
 * way), else `overlaps`; the kind of an event pair is the strongest over its targets and version
 * pairs. Version predicates are compared pairwise per target with early exit. Each predicate looks
 * up its candidates through an index on its most selective constrained field; the candidates always
 * include the predicates that leave that field unconstrained, so the index never hides a pair.
 *
 * The number of pairs grows quadratically (an event that lost its identity field contains every
 * event of the plan), so pairs are produced one participant at a time and never held all at once.
 * What is reported is bounded: an event with more than OVERLAP_PAIR_LIMIT overlaps attached to it
 * (each pair is attached to one of its two events) gets one summary instead of one result per pair
 * (summarizeOverlaps).
 */

import type { Field, OpenTPConfig, ResolvedEvent, ValidationError } from "../types";
import { isYamlMapping } from "../util";
import { getDictValues } from "./dict";
import { isDeprecatedVersion, naturalCompare, presenceReason, targetIds } from "./fields";
import {
  BaseFieldCache,
  type DictionaryLookup,
  effectiveFields,
  resolveEventPayload,
} from "./payload";

export type OverlapKind = "identical" | "contains" | "overlaps";

/** The allowed element "absent": the field is missing or its value is null */
export const ABSENT = "\u0000absent";

/** Path of every overlap warning */
export const OVERLAP_PATH = "payload";

/**
 * One allowed element as a comparable token: by type and value (`"1"` and `1` differ), arrays by
 * their JSON text; null is ABSENT
 */
export function valueToken(value: unknown): string {
  if (value === null || value === undefined) return ABSENT;
  switch (typeof value) {
    case "string":
      return `s:${value}`;
    case "number":
      return `n:${String(value)}`;
    case "boolean":
      return `b:${String(value)}`;
    default:
      return `j:${JSON.stringify(value)}`;
  }
}

/**
 * Whether an effective field is in every hit of the version: `required: true` in any layer, a fixed
 * value, or a restricted or fixed policy (unless the version is exempt: `meta.deprecated`)
 */
export function isAlwaysPresent(field: Field, exempt: boolean): boolean {
  return field.required === true || presenceReason(field, !exempt) !== null;
}

/**
 * The allowed elements of one effective field, or null when the field is free (see the module
 * comment). `exempt`: the version is marked `meta.deprecated`.
 */
export function fieldTerm(
  field: Field,
  exempt: boolean,
  lookup?: DictionaryLookup,
): Set<string> | null {
  if (field.value !== undefined) return new Set([valueToken(field.value)]);
  if (field.type === "array") return null;
  let values: readonly unknown[] | null = null;
  if (Array.isArray(field.enum) && field.enum.length > 0) values = field.enum;
  else if (typeof field.dict === "string") values = lookup?.(field.dict) ?? null;
  if (values === null) return null;
  const allowed = new Set(values.map(valueToken));
  if (!isAlwaysPresent(field, exempt)) allowed.add(ABSENT);
  return allowed;
}

/** The predicate of one event version on one target */
export interface VersionPredicate {
  /** The constrained fields and their allowed elements (valueToken, ABSENT) */
  constrained: Map<string, ReadonlySet<string>>;
  /** Every field of the effective field set, constrained or free */
  fields: ReadonlySet<string>;
}

/** The predicate of an effective field set (field name -> merged definition) */
export function versionPredicate(
  fields: Iterable<readonly [string, Field]>,
  exempt: boolean,
  lookup?: DictionaryLookup,
): VersionPredicate {
  const constrained = new Map<string, ReadonlySet<string>>();
  const names = new Set<string>();
  for (const [name, field] of fields) {
    names.add(name);
    const allowed = fieldTerm(field, exempt, lookup);
    if (allowed) constrained.set(name, allowed);
  }
  return { constrained, fields: names };
}

/** A predicate with a field that allows nothing (an empty dictionary) matches no hit */
function isSatisfiable(predicate: VersionPredicate): boolean {
  for (const allowed of predicate.constrained.values()) if (allowed.size === 0) return false;
  return true;
}

function shareElement(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of small) if (large.has(token)) return true;
  return false;
}

/** Whether two version predicates can match the same hit: every field both constrain shares an element */
export function intersects(p: VersionPredicate, q: VersionPredicate): boolean {
  const [small, large] = p.constrained.size <= q.constrained.size ? [p, q] : [q, p];
  for (const [field, allowed] of small.constrained) {
    const other = large.constrained.get(field);
    if (other && !shareElement(allowed, other)) return false;
  }
  return true;
}

/**
 * `p ⊆ q`: every field that `q` constrains is constrained by `p` with allowed elements (ABSENT
 * included) that `q` allows too
 */
export function isWithin(p: VersionPredicate, q: VersionPredicate): boolean {
  if (q.constrained.size > p.constrained.size) return false;
  for (const [field, allowed] of q.constrained) {
    const own = p.constrained.get(field);
    if (!own || own.size > allowed.size) return false;
    for (const token of own) if (!allowed.has(token)) return false;
  }
  return true;
}

/** How two intersecting version predicates relate */
export interface VersionComparison {
  kind: OverlapKind;
  /** `contains`: which of the two predicates is the broader one */
  broader?: "first" | "second";
}

const IDENTICAL: VersionComparison = Object.freeze({ kind: "identical" });
const FIRST_BROADER: VersionComparison = Object.freeze({ kind: "contains", broader: "first" });
const SECOND_BROADER: VersionComparison = Object.freeze({ kind: "contains", broader: "second" });
const OVERLAPS: VersionComparison = Object.freeze({ kind: "overlaps" });

/**
 * Compares two version predicates of the same target; null when they cannot match the same hit.
 * One pass over the fields of `first` computes intersects() and isWithin() both ways.
 */
export function compareVersions(
  first: VersionPredicate,
  second: VersionPredicate,
): VersionComparison | null {
  // first ⊆ second needs every field that second constrains to be constrained by first, and the
  // other way round
  let firstWithin = true;
  let secondWithin = true;
  let shared = 0;
  for (const [field, own] of first.constrained) {
    const other = second.constrained.get(field);
    if (!other) {
      secondWithin = false;
      continue;
    }
    shared += 1;
    // The number of common elements says all three: none, all of `own`, all of `other`
    const [small, large] = own.size <= other.size ? [own, other] : [other, own];
    let common = 0;
    for (const token of small) if (large.has(token)) common += 1;
    if (common === 0) return null;
    if (common !== own.size) firstWithin = false;
    if (common !== other.size) secondWithin = false;
  }
  if (shared !== second.constrained.size) firstWithin = false;
  if (firstWithin && secondWithin) return IDENTICAL;
  if (firstWithin) return SECOND_BROADER;
  if (secondWithin) return FIRST_BROADER;
  return OVERLAPS;
}

// --- Events ---------------------------------------------------------------------------------------

/**
 * What an event's `ignore` list says about overlap: `overlap` silences every overlap warning that
 * involves the event (`all`), `overlap.<key>` (all text after the first `overlap.`) one pair
 */
export function overlapIgnores(ignore: unknown): { all: boolean; keys: Set<string> } {
  const keys = new Set<string>();
  let all = false;
  if (!Array.isArray(ignore)) return { all, keys };
  for (const entry of ignore) {
    // Ignore entries are not schema-checked by the CLI: skip anything without a string path
    const path = isYamlMapping(entry) ? entry.path : undefined;
    if (typeof path !== "string") continue;
    if (path === "overlap") all = true;
    else if (path.startsWith("overlap.")) keys.add(path.slice("overlap.".length));
  }
  return { all, keys };
}

/** The keys an event names as related: `lifecycle.replacedBy` and `aliases[].key` */
function relatedKeys(event: ResolvedEvent): Set<string> {
  const keys = new Set<string>();
  const lifecycle: unknown = event.lifecycle;
  if (isYamlMapping(lifecycle) && typeof lifecycle.replacedBy === "string") {
    keys.add(lifecycle.replacedBy);
  }
  const aliases: unknown = event.aliases;
  if (Array.isArray(aliases)) {
    for (const alias of aliases) {
      if (isYamlMapping(alias) && typeof alias.key === "string") keys.add(alias.key);
    }
  }
  return keys;
}

interface Participant {
  event: ResolvedEvent;
  key: string | null;
  /** Keys of `overlap.<key>` ignore entries */
  ignoredKeys: ReadonlySet<string>;
  /** `lifecycle.replacedBy` and `aliases[].key` */
  related: ReadonlySet<string>;
}

/** The event as a participant, or null when it ignores every overlap (`ignore: overlap`) */
function participantOf(event: ResolvedEvent): Participant | null {
  const ignores = overlapIgnores(event.ignore);
  if (ignores.all) return null;
  return {
    event,
    key: typeof event.key === "string" ? event.key : null,
    ignoredKeys: ignores.keys,
    related: relatedKeys(event),
  };
}

/**
 * Whether a pair is never compared: one event names the other in `lifecycle.replacedBy` or
 * `aliases[].key`, or an `overlap.<key>` ignore entry of either event names the other
 */
function skipsPair(a: Participant, b: Participant): boolean {
  if (a.key !== null && (b.ignoredKeys.has(a.key) || b.related.has(a.key))) return true;
  if (b.key !== null && (a.ignoredKeys.has(b.key) || a.related.has(b.key))) return true;
  return false;
}

function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface OverlapOptions {
  /** Loaded dictionaries (alternative to `lookup`): a `dict` with unknown values leaves a field free */
  dictionaries?: Map<string, (string | number | boolean)[]>;
  /** Dictionary values by reference (null for an unknown dictionary) */
  lookup?: DictionaryLookup;
  /** The merged base fields per target (validateEvents passes its own cache) */
  baseFields?: BaseFieldCache;
  /** Counts the version-predicate comparisons made */
  stats?: OverlapStats;
}

export interface OverlapStats {
  comparisons: number;
}

/**
 * The version predicates of an event per covered target (targets in `targets.all` order, versions
 * in file order). Predicates that match no hit (a field whose dictionary is empty) are left out.
 */
export function eventPredicates(
  event: ResolvedEvent,
  config: OpenTPConfig,
  options: Pick<OverlapOptions, "dictionaries" | "lookup" | "baseFields"> = {},
): Map<string, Array<{ version: string; index: number; predicate: VersionPredicate }>> {
  const lookup = lookupOf(options);
  const baseFields = options.baseFields ?? new BaseFieldCache(config, lookup);
  return predicatesOf(event, config, targetIds(config), baseFields, lookup);
}

function lookupOf(options: OverlapOptions): DictionaryLookup | undefined {
  if (options.lookup) return options.lookup;
  const dictionaries = options.dictionaries;
  return dictionaries ? (dict) => getDictValues(dict, dictionaries) : undefined;
}

function predicatesOf(
  event: ResolvedEvent,
  config: OpenTPConfig,
  targets: readonly string[],
  baseFields: BaseFieldCache,
  lookup: DictionaryLookup | undefined,
): Map<string, Array<{ version: string; index: number; predicate: VersionPredicate }>> {
  const out = new Map<
    string,
    Array<{ version: string; index: number; predicate: VersionPredicate }>
  >();
  // Resolution problems are reported by payload validation; what resolves still takes part
  const { payload } = resolveEventPayload(event.payload, config);
  for (const target of targets) {
    if (!Object.hasOwn(payload.targets, target)) continue;
    const base = baseFields.forTarget(target);
    const versions: Array<{ version: string; index: number; predicate: VersionPredicate }> = [];
    const resolved = payload.targets[target];
    // File order: integer-like version keys ("2" before "1") are not in object key order
    resolved.versionOrder.forEach((key, index) => {
      const version = resolved.versions[key];
      const effective = effectiveFields(version.schema, base, lookup);
      const predicate = versionPredicate(
        [...effective].map(([name, entry]) => [name, entry.field] as const),
        isDeprecatedVersion(version.meta),
        lookup,
      );
      if (isSatisfiable(predicate)) versions.push({ version: key, index, predicate });
    });
    if (versions.length > 0) out.set(target, versions);
  }
  return out;
}

// --- Index ----------------------------------------------------------------------------------------

/** One version predicate of one participant on one target */
interface Entry {
  participant: number;
  /** The version's position in file order */
  version: number;
  predicate: VersionPredicate;
}

/** The first position in an ascending list that is greater than `after` */
function firstAfter(list: readonly number[], after: number): number {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (list[middle] <= after) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The version predicates of one target, indexed by field and allowed element */
class TargetIndex {
  /** field -> allowed element -> positions (ascending) of the entries that allow it */
  private readonly tokens = new Map<string, Map<string, number[]>>();
  /** field -> number of entries that constrain it */
  private readonly constrainedCount = new Map<string, number>();
  /** field -> positions (ascending) of the entries that leave it unconstrained (built lazily) */
  private readonly wildcards = new Map<string, number[]>();
  private readonly seen: Int32Array;
  private stamp = 0;
  /** participant -> position of its first entry; its entries end where the next one's start */
  private readonly starts: Int32Array;

  /** `entries` in participant order; `participants`: the number of participants */
  constructor(
    readonly entries: readonly Entry[],
    participants: number,
  ) {
    this.seen = new Int32Array(entries.length);
    this.starts = new Int32Array(participants + 1);
    let position = 0;
    for (let participant = 0; participant <= participants; participant += 1) {
      while (position < entries.length && entries[position].participant < participant) {
        position += 1;
      }
      this.starts[participant] = position;
    }
    entries.forEach((entry, position) => {
      for (const [field, allowed] of entry.predicate.constrained) {
        let byToken = this.tokens.get(field);
        if (!byToken) {
          byToken = new Map();
          this.tokens.set(field, byToken);
        }
        for (const token of allowed) {
          const list = byToken.get(token);
          if (list) list.push(position);
          else byToken.set(token, [position]);
        }
        this.constrainedCount.set(field, (this.constrainedCount.get(field) ?? 0) + 1);
      }
    });
  }

  /** The positions of a participant's entries: [first, end) */
  rangeOf(participant: number): [number, number] {
    return [this.starts[participant], this.starts[participant + 1]];
  }

  private wildcardsOf(field: string): number[] {
    let list = this.wildcards.get(field);
    if (!list) {
      list = [];
      this.entries.forEach((entry, position) => {
        if (!entry.predicate.constrained.has(field)) list?.push(position);
      });
      this.wildcards.set(field, list);
    }
    return list;
  }

  /**
   * The positions after `after` (-1: all) of the entries that can intersect `predicate`: through
   * its most selective constrained field, the entries that share one of its allowed elements plus
   * the entries that leave that field unconstrained. A superset of the intersecting entries.
   */
  candidates(predicate: VersionPredicate, after: number): number[] {
    const total = this.entries.length;
    let best: string | null = null;
    let bestCost = total;
    for (const [field, allowed] of predicate.constrained) {
      const byToken = this.tokens.get(field);
      let cost = total - (this.constrainedCount.get(field) ?? 0);
      if (byToken) for (const token of allowed) cost += byToken.get(token)?.length ?? 0;
      if (cost < bestCost) {
        best = field;
        bestCost = cost;
      }
    }

    const out: number[] = [];
    if (best === null) {
      for (let position = after + 1; position < total; position += 1) out.push(position);
      return out;
    }

    this.stamp += 1;
    const stamp = this.stamp;
    const byToken = this.tokens.get(best);
    for (const token of predicate.constrained.get(best) ?? []) {
      const list = byToken?.get(token);
      if (!list) continue;
      for (let i = firstAfter(list, after); i < list.length; i += 1) {
        const position = list[i];
        if (this.seen[position] === stamp) continue;
        this.seen[position] = stamp;
        out.push(position);
      }
    }
    // Entries that leave the field unconstrained are never in its token lists
    const wildcards = this.wildcardsOf(best);
    for (let i = firstAfter(wildcards, after); i < wildcards.length; i += 1) {
      out.push(wildcards[i]);
    }
    return out;
  }
}

// --- Pairs ----------------------------------------------------------------------------------------

const KINDS: readonly OverlapKind[] = ["overlaps", "contains", "identical"];

/** Two overlapping events and how they overlap */
export interface Overlap {
  /** The event the warning is attached to */
  event: ResolvedEvent;
  /** The event it overlaps with (named in the message) */
  other: ResolvedEvent;
  /** The targets with an intersecting version pair, in `targets.all` order */
  targets: string[];
  /** The strongest kind over the targets and version pairs */
  kind: OverlapKind;
  /** `contains`: the narrower event (every hit of it also matches `broad`) */
  narrow?: ResolvedEvent;
  /** `contains`: the broader event */
  broad?: ResolvedEvent;
  /** `identical`: the free fields that only one of them lists (natural order) */
  freeFields: string[];
}

/** One side of a compared version pair */
interface Side {
  participant: Participant;
  version: number;
  predicate: VersionPredicate;
}

interface PairState {
  /** The event whose relative path sorts first */
  first: Participant;
  second: Participant;
  /** Target indexes, ascending (record() is called target by target) */
  targets: number[];
  rank: number;
  /** The first `contains` triple (target, version of `first`, version of `second`) decides */
  contains?: { order: [number, number, number]; broad: Participant; narrow: Participant };
  /** `identical`: the free fields that only one of them lists (created when there is one) */
  freeFields?: Set<string>;
}

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

function addFreeField(state: PairState, name: string): void {
  if (!state.freeFields) state.freeFields = new Set();
  state.freeFields.add(name);
}

class PairCollector {
  readonly pairs = new Map<number, PairState>();

  constructor(private readonly stats?: OverlapStats) {}

  /** Compares one version pair on target `target`; `first` sorts first by relative path */
  record(key: number, target: number, first: Side, second: Side): void {
    if (this.stats) this.stats.comparisons += 1;
    const comparison = compareVersions(first.predicate, second.predicate);
    if (!comparison) return;

    let state = this.pairs.get(key);
    if (!state) {
      state = { first: first.participant, second: second.participant, targets: [], rank: 0 };
      this.pairs.set(key, state);
    }
    if (state.targets[state.targets.length - 1] !== target) state.targets.push(target);
    const rank = KINDS.indexOf(comparison.kind);
    if (rank > state.rank) state.rank = rank;

    if (comparison.kind === "contains") {
      const order: [number, number, number] = [target, first.version, second.version];
      if (!state.contains || lexLess(order, state.contains.order)) {
        const firstBroader = comparison.broader === "first";
        state.contains = {
          order,
          broad: firstBroader ? first.participant : second.participant,
          narrow: firstBroader ? second.participant : first.participant,
        };
      }
    } else if (comparison.kind === "identical") {
      const a = first.predicate.fields;
      const b = second.predicate.fields;
      for (const name of a) if (!b.has(name)) addFreeField(state, name);
      for (const name of b) if (!a.has(name)) addFreeField(state, name);
    }
  }

  /**
   * The overlaps in key order. Without `attachTo`, a `contains` pair goes to the broader event and
   * every other pair to the event whose relative path sorts first.
   */
  overlaps(targets: readonly string[], attachTo?: Participant): Overlap[] {
    return [...this.pairs.keys()]
      .sort((a, b) => a - b)
      .map((key) => {
        const state = this.pairs.get(key) as PairState;
        const kind = KINDS[state.rank];
        let event = state.first;
        let other = state.second;
        if (attachTo) {
          event = attachTo;
          other = attachTo === state.first ? state.second : state.first;
        } else if (kind === "contains" && state.contains) {
          event = state.contains.broad;
          other = state.contains.narrow;
        }
        return {
          event: event.event,
          other: other.event,
          targets: state.targets.map((index) => targets[index]),
          kind,
          ...(kind === "contains" && state.contains
            ? { narrow: state.contains.narrow.event, broad: state.contains.broad.event }
            : {}),
          freeFields:
            kind === "identical" && state.freeFields
              ? [...state.freeFields].sort(naturalCompare)
              : [],
        };
      });
  }
}

// --- Summaries ------------------------------------------------------------------------------------

/** More overlaps than this attached to one event are reported as one summary */
export const OVERLAP_PAIR_LIMIT = 20;

/** The number of other events a summary names as examples */
const SUMMARY_EXAMPLES = 3;

/** The overlaps attached to one event, when there are more than OVERLAP_PAIR_LIMIT, as one result */
export interface OverlapSummary {
  kind: "summary";
  /** The event the overlaps are attached to */
  event: ResolvedEvent;
  /** The number of other events */
  count: number;
  /** The targets of all those overlaps, in `targets.all` order */
  targets: string[];
  /** Identical events */
  identical: number;
  /** Events contained in this one (every hit of them also matches this event) */
  contained: number;
  /** Events that contain this one */
  containing: number;
  /** Events with which some hits match both (kind `overlaps`) */
  partial: number;
  /** The first other events by relative path */
  examples: ResolvedEvent[];
}

/** What is reported for an event: one overlap per pair, or one summary */
export type ReportedOverlap = Overlap | OverlapSummary;

/** The overlaps attached to one event: counters and the first ones by the other event's path */
interface Attached {
  event: ResolvedEvent;
  count: number;
  targets: Set<string>;
  identical: number;
  contained: number;
  containing: number;
  partial: number;
  /** At most OVERLAP_PAIR_LIMIT + 1, in relative-path order of the other event */
  first: Overlap[];
}

function byOtherPath(a: Overlap, b: Overlap): number {
  return comparePaths(a.other.relativePath, b.other.relativePath);
}

/**
 * Groups overlaps by the event they are attached to and replaces the overlaps of an event with more
 * than OVERLAP_PAIR_LIMIT attached overlaps by one summary. Memory stays bounded whatever the number of
 * pairs: per event, counters and at most OVERLAP_PAIR_LIMIT + 1 overlaps. Results come in the
 * relative-path order of the event, each event's overlaps in the relative-path order of the other.
 */
export function summarizeOverlaps(
  overlaps: Iterable<Overlap>,
  targets: readonly string[],
): ReportedOverlap[] {
  const byEvent = new Map<ResolvedEvent, Attached>();
  for (const overlap of overlaps) {
    let attached = byEvent.get(overlap.event);
    if (!attached) {
      attached = {
        event: overlap.event,
        count: 0,
        targets: new Set(),
        identical: 0,
        contained: 0,
        containing: 0,
        partial: 0,
        first: [],
      };
      byEvent.set(overlap.event, attached);
    }
    attached.count += 1;
    for (const target of overlap.targets) attached.targets.add(target);
    if (overlap.kind === "identical") attached.identical += 1;
    else if (overlap.kind === "overlaps") attached.partial += 1;
    else if (overlap.broad === overlap.event) attached.contained += 1;
    else attached.containing += 1;

    // Keep the first ones by the other event's path. pairs() and pairsWith() deliver each event's
    // overlaps in that order, so this is an append (or a skip) in practice.
    const first = attached.first;
    const full = first.length > OVERLAP_PAIR_LIMIT;
    if (full && byOtherPath(overlap, first[first.length - 1]) >= 0) continue;
    let at = first.length;
    while (at > 0 && byOtherPath(overlap, first[at - 1]) < 0) at -= 1;
    first.splice(at, 0, overlap);
    if (full) first.pop();
  }

  const out: ReportedOverlap[] = [];
  const events = [...byEvent.values()].sort((a, b) =>
    comparePaths(a.event.relativePath, b.event.relativePath),
  );
  for (const attached of events) {
    if (attached.count <= OVERLAP_PAIR_LIMIT) {
      for (const overlap of attached.first) out.push(overlap);
      continue;
    }
    out.push({
      kind: "summary",
      event: attached.event,
      count: attached.count,
      targets: targets.filter((target) => attached.targets.has(target)),
      identical: attached.identical,
      contained: attached.contained,
      containing: attached.containing,
      partial: attached.partial,
      examples: attached.first.slice(0, SUMMARY_EXAMPLES).map((overlap) => overlap.other),
    });
  }
  return out;
}

// --- Public API -----------------------------------------------------------------------------------

/**
 * The overlaps of a tracking plan, computed once from its events. `pairs()` lists every overlapping
 * pair of the plan and `all()` what is reported for it; `with(draft)` compares one draft event
 * with the plan (for the MCP draft tools).
 */
export class OverlapIndex {
  /** Participants sorted by relative path (events with `ignore: overlap` are left out) */
  private readonly participants: Participant[];
  private readonly targets: string[];
  private readonly indexes: TargetIndex[];
  private readonly lookup: DictionaryLookup | undefined;
  private readonly baseFields: BaseFieldCache;
  private readonly stats?: OverlapStats;

  constructor(
    events: readonly ResolvedEvent[],
    private readonly config: OpenTPConfig,
    options: OverlapOptions = {},
  ) {
    this.lookup = lookupOf(options);
    this.baseFields = options.baseFields ?? new BaseFieldCache(config, this.lookup);
    this.stats = options.stats;
    this.targets = targetIds(config);
    this.participants = [...events]
      .sort((a, b) => comparePaths(a.relativePath, b.relativePath))
      .map(participantOf)
      .filter((participant): participant is Participant => participant !== null);

    const entries: Entry[][] = this.targets.map(() => []);
    this.participants.forEach((participant, index) => {
      const predicates = this.predicatesOf(participant.event);
      this.targets.forEach((target, t) => {
        for (const { index: version, predicate } of predicates.get(target) ?? []) {
          entries[t].push({ participant: index, version, predicate });
        }
      });
    });
    this.indexes = entries.map((list) => new TargetIndex(list, this.participants.length));
  }

  private predicatesOf(event: ResolvedEvent) {
    return predicatesOf(event, this.config, this.targets, this.baseFields, this.lookup);
  }

  /**
   * Every overlapping pair of the plan (each pair once), in relative-path order of the pair. The
   * pairs are produced one participant at a time, so only the pairs of one participant are held
   * in memory however many pairs the plan has.
   */
  *pairs(): Generator<Overlap> {
    for (let first = 0; first < this.participants.length; first += 1) {
      const participant = this.participants[first];
      const collector = new PairCollector(this.stats);
      this.indexes.forEach((index, t) => {
        const [start, end] = index.rangeOf(first);
        for (let position = start; position < end; position += 1) {
          const entry = index.entries[position];
          // Entries are in participant order: later positions belong to this or later participants
          for (const candidatePosition of index.candidates(entry.predicate, position)) {
            const candidate = index.entries[candidatePosition];
            if (candidate.participant === first) continue;
            const second = this.participants[candidate.participant];
            if (skipsPair(participant, second)) continue;
            collector.record(
              candidate.participant,
              t,
              { participant, version: entry.version, predicate: entry.predicate },
              { participant: second, version: candidate.version, predicate: candidate.predicate },
            );
          }
        }
      });
      yield* collector.overlaps(this.targets);
    }
  }

  /** What is reported for the plan: every pair, or one summary per event with more than 20 attached */
  all(): ReportedOverlap[] {
    return summarizeOverlaps(this.pairs(), this.targets);
  }

  /**
   * The overlaps between a draft event and every plan event except the one at the draft's path,
   * all attached to the draft (sorted by the other event's relative path)
   */
  pairsWith(draft: ResolvedEvent): Overlap[] {
    const own = participantOf(draft);
    if (!own) return [];
    const collector = new PairCollector(this.stats);
    const predicates = this.predicatesOf(draft);
    this.indexes.forEach((index, t) => {
      for (const { index: version, predicate } of predicates.get(this.targets[t]) ?? []) {
        const side: Side = { participant: own, version, predicate };
        for (const position of index.candidates(predicate, -1)) {
          const candidate = index.entries[position];
          const other = this.participants[candidate.participant];
          if (other.event.relativePath === draft.relativePath || skipsPair(own, other)) continue;
          const otherSide: Side = {
            participant: other,
            version: candidate.version,
            predicate: candidate.predicate,
          };
          const draftFirst = comparePaths(draft.relativePath, other.event.relativePath) < 0;
          collector.record(
            candidate.participant,
            t,
            draftFirst ? side : otherSide,
            draftFirst ? otherSide : side,
          );
        }
      }
    });
    return collector.overlaps(this.targets, own);
  }

  /** What is reported for a draft: every overlap of pairsWith(draft), or one summary */
  with(draft: ResolvedEvent): ReportedOverlap[] {
    return summarizeOverlaps(this.pairsWith(draft), this.targets);
  }
}

/** What is reported for a plan's overlapping pairs (see OverlapIndex.all) */
export function findOverlaps(
  events: readonly ResolvedEvent[],
  config: OpenTPConfig,
  options: OverlapOptions = {},
): ReportedOverlap[] {
  return new OverlapIndex(events, config, options).all();
}

/**
 * The overlaps between one draft event and the plan's events, except the event at the draft's
 * relative path (the file the draft would replace). Every overlap is attached to the draft; turn
 * them into results with `overlapResults(overlaps, severity)` unless the severity is off.
 */
export function overlapsWith(
  draft: ResolvedEvent,
  events: readonly ResolvedEvent[],
  config: OpenTPConfig,
  options: OverlapOptions = {},
): ReportedOverlap[] {
  return new OverlapIndex(events, config, options).with(draft);
}

function keyText(event: ResolvedEvent | undefined): string {
  return event === undefined ? "" : String(event.key ?? "");
}

/** The kind text of an overlap message */
function kindText(overlap: Overlap): string {
  switch (overlap.kind) {
    case "identical":
      return overlap.freeFields.length > 0
        ? `identical: no constrained field tells them apart; they differ only in free fields: ${overlap.freeFields.join(", ")}`
        : "identical: no constrained field tells them apart";
    case "contains":
      return `every hit of '${keyText(overlap.narrow)}' also matches '${keyText(overlap.broad)}'`;
    default:
      return "some hits match both";
  }
}

/** `Overlaps with event '<key>' (<relPath>) on <t1>, <t2>: <kind text>` */
export function overlapMessage(overlap: Overlap): string {
  const other = overlap.other;
  return `Overlaps with event '${keyText(other)}' (${other.relativePath}) on ${overlap.targets.join(", ")}: ${kindText(overlap)}`;
}

/**
 * `Overlaps with <n> other events on <targets> (<a> identical, <b> contained in this event, <c>
 * containing this event, <d> partial); for example '<key>' (<relPath>), ...` (zero counts left out)
 */
export function overlapSummaryMessage(summary: OverlapSummary): string {
  const counts = [
    [summary.identical, "identical"],
    [summary.contained, "contained in this event"],
    [summary.containing, "containing this event"],
    [summary.partial, "partial"],
  ]
    .filter(([count]) => (count as number) > 0)
    .map(([count, text]) => `${count} ${text}`);
  const examples = summary.examples.map((event) => `'${keyText(event)}' (${event.relativePath})`);
  return `Overlaps with ${summary.count} other events on ${summary.targets.join(", ")} (${counts.join(", ")}); for example ${examples.join(", ")}`;
}

const SUMMARY_MESSAGE = /^Overlaps with (\d+) other events on /;

/** The number of other events an overlap message stands for: `<n>` for a summary, else 1 */
export function overlapMessageWeight(message: string): number {
  const match = SUMMARY_MESSAGE.exec(message);
  return match ? Number(match[1]) : 1;
}

/** Overlaps as validation results (rule `overlap`, path `payload`) with the given severity */
export function overlapResults(
  overlaps: readonly ReportedOverlap[],
  severity: "warning" | "error",
): ValidationError[] {
  return overlaps.map((overlap) => ({
    event: overlap.event.relativePath,
    path: OVERLAP_PATH,
    message: overlap.kind === "summary" ? overlapSummaryMessage(overlap) : overlapMessage(overlap),
    severity,
    rule: "overlap",
  }));
}
