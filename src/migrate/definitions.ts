/**
 * Text edits of one definition (a payload field, array `items`, a taxonomy field or fragment, a
 * pii configuration or meta field), written in 2026-01, for 2026-09:
 * - `enum: []` is removed;
 * - `x-opentp`: `role` is removed, `checks` becomes a sibling `checks` (webhook checks become
 *   `webhook-<n>: true`), an `x-opentp` left empty is removed;
 * - `valueRequired` is removed, or becomes `policy: fixed` (base fields, decided by the caller);
 * - `required: false` next to `value` is removed;
 * - a number or boolean `example` on a string field is quoted (its source text is kept).
 */

import {
  type Alias,
  type Document,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  type Node,
  type Pair,
  type YAMLMap,
} from "yaml";
import {
  EVENT_VALUE_REQUIRED_REMOVED,
  type FileNotes,
  type Findings,
  REQUIRED_FALSE_REMOVED,
} from "./report";
import {
  blockPairSpan,
  columnOf,
  type Edit,
  EditError,
  type EditList,
  editMapping,
  findPair,
  flowPairText,
  keyOf,
  type MappingChanges,
  type PairChange,
  pairEnd,
  pairStart,
  reindent,
  renderFlowPair,
  sliceWithEdits,
} from "./text";

/** The type a definition ends up with (for quoting examples) */
export interface EffectiveType {
  type?: string;
  itemsType?: string;
}

/** What to do with `valueRequired` in a base definition */
export type ValueRequiredDecision = "fixed" | "drop";

/** One file being edited */
export interface EditTarget {
  /** Path of the file relative to the plan root */
  file: string;
  /** The parsed file (to resolve aliases) */
  doc: Document.Parsed;
  text: string;
  eol: string;
  edits: EditList;
  notes: FileNotes;
  findings: Findings;
  /** Binding ids of webhook check configurations (keyed by the `webhook` pair) */
  webhookIds: Map<Pair, string>;
}

export interface DefinitionOptions {
  /** Dotted path of the definition (for findings) */
  path: string;
  /** The pair whose value the definition is (for `{}` when every key is removed) */
  parent: Pair | null;
  /** The type the field ends up with, when examples may need quoting */
  effectiveType?: () => EffectiveType;
  /** `valueRequired` in a base definition: `policy: fixed` or removed (default: removed, with a warning as in events) */
  valueRequired?: ValueRequiredDecision;
  /** Pairs to write first (`type: integer`) */
  insertFirst?: string[];
  /** Where the definition is written: events warn about a removed valueRequired */
  layer: "event" | "plan";
}

const XOPENTP = "x-opentp";

function isEmptySeq(node: unknown): boolean {
  return isSeq(node) && node.items.length === 0;
}

/** The node an alias points to (other nodes as they are) */
function resolved(target: EditTarget, node: unknown): unknown {
  return isAlias(node) ? node.resolve(target.doc) : node;
}

/** The value of a scalar node, through an alias */
function scalarValue(target: EditTarget, node: unknown): unknown {
  const value = resolved(target, node);
  return isScalar(value) ? value.value : undefined;
}

/** `example` scalars (or array items) that are numbers or booleans on a string field */
function quoteExample(target: EditTarget, pair: Pair, effective: EffectiveType): number {
  const quote = (node: unknown): boolean => {
    if (!isScalar(node) || node.type !== "PLAIN") return false;
    if (typeof node.value !== "number" && typeof node.value !== "boolean") return false;
    const [start, end] = node.range ?? [0, 0];
    target.edits.add(start, end, JSON.stringify(target.text.slice(start, end)));
    return true;
  };
  if (effective.type === "string") return quote(pair.value) ? 1 : 0;
  if (effective.type === "array" && effective.itemsType === "string" && isSeq(pair.value)) {
    return pair.value.items.filter((item) => quote(item)).length;
  }
  return 0;
}

/**
 * Replaces every `webhook` check of a `checks` mapping with `webhook-<n>: true` (inline edits that
 * keep the text around them). Returns the edits.
 */
function webhookEdits(target: EditTarget, checks: unknown): Edit[] {
  const edits: Edit[] = [];
  if (!isMap(checks)) return edits;
  for (const pair of checks.items as Pair[]) {
    const id = target.webhookIds.get(pair);
    if (id === undefined) continue;
    edits.push({ start: pairStart(pair), end: pairEnd(pair), text: `${id}: true` });
  }
  return edits;
}

/**
 * The change for an `x-opentp` pair of a definition, or null to leave it as it is. Unknown members
 * stay in `x-opentp` (reported under manual); `checks` moves next to it.
 */
function xOpentpChange(
  target: EditTarget,
  definition: YAMLMap,
  pair: Pair,
  path: string,
): PairChange | "inline" | null {
  const { text, eol } = target;
  const value = pair.value;
  const xPath = `${path}.${XOPENTP}`;
  if (isAlias(value)) return aliasXOpentpChange(target, definition, pair, value, path);
  if (isScalar(value) && (value.value === null || value.value === undefined)) {
    target.notes.count("removed x-opentp");
    return { remove: true };
  }
  if (!isMap(value)) {
    target.findings.manualItem(target.file, xPath, "x-opentp is not a mapping: remove it");
    return null;
  }

  const members = value.items as Pair[];
  const checksPair = members.find((member) => keyOf(member) === "checks");
  const unknown = members.filter((member) => {
    const key = keyOf(member);
    return key !== "role" && key !== "checks";
  });
  for (const member of unknown) {
    target.findings.manualItem(
      target.file,
      `${xPath}.${keyOf(member) ?? "?"}`,
      `x-opentp.${keyOf(member) ?? "?"} has no 2026-09 equivalent: move or remove it, then remove x-opentp`,
    );
  }
  if (checksPair && findPair(definition, "checks")) {
    target.findings.manualItem(
      target.file,
      xPath,
      "Both checks and x-opentp.checks are set: merge x-opentp.checks into checks by hand, then remove x-opentp",
    );
    return null;
  }

  if (members.some((member) => keyOf(member) === "role"))
    target.notes.count("removed x-opentp.role");
  if (checksPair) target.notes.count("x-opentp.checks -> checks");
  const hooks = checksPair ? webhookEdits(target, checksPair.value) : [];
  if (hooks.length > 0) target.notes.count("webhook check -> binding", hooks.length);

  if (!checksPair && unknown.length === 0) return { remove: true };

  // A flow x-opentp with only checks (and role): rewrite it in place, keeping the rest of the line
  if (value.flow && checksPair && unknown.length === 0) {
    target.edits.add(pairStart(pair), pairEnd(pair), flowPairText(text, checksPair, hooks));
    return "inline";
  }

  return {
    replace: (style: "block" | "flow") => {
      if (style === "flow" || value.flow) {
        const parts: string[] = [];
        if (checksPair) parts.push(flowPairText(text, checksPair, hooks));
        if (unknown.length > 0) {
          const padding = text[(value.range ?? [0])[0] + 1] === " " ? " " : "";
          parts.push(
            `${XOPENTP}: {${padding}${unknown.map((member) => flowPairText(text, member)).join(", ")}${padding}}`,
          );
        }
        if (style === "flow") return parts.join(", ");
        const indent = " ".repeat(columnOf(text, pairStart(pair)));
        return parts.map((part) => `${indent}${part}${eol}`).join("");
      }

      // Block x-opentp: the checks lines move up one level; unknown members stay below x-opentp
      const column = columnOf(text, pairStart(pair));
      let out = "";
      if (checksPair) {
        const [start, end] = blockPairSpan(text, checksPair);
        const block = sliceWithEdits(text, start, end, hooks);
        out += reindent(block, columnOf(text, pairStart(checksPair)), column);
      }
      if (unknown.length > 0) {
        const [start, end] = blockPairSpan(text, pair);
        const removed = members
          .filter((member) => !unknown.includes(member))
          .map((member) => {
            const [memberStart, memberEnd] = blockPairSpan(text, member);
            return { start: memberStart, end: memberEnd, text: "" };
          });
        out += sliceWithEdits(text, start, end, removed);
      }
      return out;
    },
  };
}

/**
 * The change for `x-opentp: *alias`: the mapping the alias points to is migrated where its anchor
 * is, so here `checks` is written out from that mapping (webhook checks as their binding ids), and
 * the alias stays only when the mapping has members with no 2026-09 equivalent.
 */
function aliasXOpentpChange(
  target: EditTarget,
  definition: YAMLMap,
  pair: Pair,
  alias: Alias,
  path: string,
): PairChange | null {
  const { text, eol } = target;
  const xPath = `${path}.${XOPENTP}`;
  const value = alias.resolve(target.doc);
  if (isScalar(value) && (value.value === null || value.value === undefined)) {
    target.notes.count("removed x-opentp");
    return { remove: true };
  }
  if (!isMap(value)) {
    target.findings.manualItem(target.file, xPath, "x-opentp is not a mapping: remove it");
    return null;
  }
  const members = value.items as Pair[];
  const checksPair = members.find((member) => keyOf(member) === "checks");
  const unknown = members.filter((member) => {
    const key = keyOf(member);
    return key !== "role" && key !== "checks";
  });
  for (const member of unknown) {
    target.findings.manualItem(
      target.file,
      `${xPath}.${keyOf(member) ?? "?"}`,
      `x-opentp.${keyOf(member) ?? "?"} has no 2026-09 equivalent: move or remove it, then remove x-opentp`,
    );
  }
  if (checksPair && findPair(definition, "checks")) {
    target.findings.manualItem(
      target.file,
      xPath,
      "Both checks and x-opentp.checks are set: merge x-opentp.checks into checks by hand, then remove x-opentp",
    );
    return null;
  }
  if (members.some((member) => keyOf(member) === "role"))
    target.notes.count("removed x-opentp.role");

  let checks: string | null = null;
  if (checksPair) {
    target.notes.count("x-opentp.checks -> checks");
    const checksValue = resolved(target, checksPair.value);
    let data: unknown;
    if (isMap(checksValue)) {
      const entries: Record<string, unknown> = {};
      let hooks = 0;
      for (const check of checksValue.items as Pair[]) {
        const id = target.webhookIds.get(check);
        if (id !== undefined) {
          entries[id] = true;
          hooks += 1;
        } else {
          const checkValue = check.value as Node | null;
          entries[keyOf(check) ?? "?"] = checkValue ? checkValue.toJS(target.doc) : null;
        }
      }
      if (hooks > 0) target.notes.count("webhook check -> binding", hooks);
      data = entries;
    } else {
      data = (checksValue as Node | null)?.toJS(target.doc) ?? null;
    }
    checks = renderFlowPair("checks", data);
  }
  if (checks === null && unknown.length === 0) return { remove: true };

  return {
    replace: (style: "block" | "flow") => {
      const parts: string[] = [];
      if (checks !== null) parts.push(checks);
      // Members with no 2026-09 equivalent: the alias stays (reported above)
      if (unknown.length > 0) parts.push(flowPairText(text, pair));
      if (style === "flow") return parts.join(", ");
      const indent = " ".repeat(columnOf(text, pairStart(pair)));
      return parts.map((part) => `${indent}${part}${eol}`).join("");
    },
  };
}

/**
 * Edits one definition (see the module comment). Nested `items` are edited too. Problems that
 * stop an edit are reported under manual; the definition then keeps its text.
 */
export function editDefinition(
  target: EditTarget,
  definition: YAMLMap,
  options: DefinitionOptions,
): void {
  const { findings, notes } = target;
  const changes: MappingChanges = { pairs: new Map(), insertFirst: options.insertFirst ?? [] };
  const pairs = definition.items as Pair[];
  const hasValue = pairs.some((pair) => keyOf(pair) === "value");
  const fixed = options.valueRequired === "fixed";
  const editCount = target.edits.size;

  try {
    for (const pair of pairs) {
      const key = keyOf(pair);
      const keyPath = `${options.path}.${key ?? "?"}`;
      switch (key) {
        case "enum":
          if (isEmptySeq(resolved(target, pair.value))) {
            changes.pairs.set(pair, { remove: true });
            notes.count("removed enum: []");
          }
          break;
        case "valueRequired": {
          const value = scalarValue(target, pair.value);
          if (fixed && value === true) {
            target.edits.add(pairStart(pair), pairEnd(pair), "policy: fixed");
            notes.count("valueRequired: true -> policy: fixed");
          } else {
            changes.pairs.set(pair, { remove: true });
            notes.count("removed valueRequired");
            if (options.layer === "event") {
              findings.warn(target.file, keyPath, EVENT_VALUE_REQUIRED_REMOVED);
            }
          }
          break;
        }
        case "required": {
          const value = scalarValue(target, pair.value);
          if (fixed) {
            changes.pairs.set(pair, { remove: true });
            notes.count("removed required (policy: fixed)");
          } else if (hasValue && value === false) {
            changes.pairs.set(pair, { remove: true });
            notes.count("removed required: false next to value");
            findings.warn(target.file, keyPath, REQUIRED_FALSE_REMOVED);
          }
          break;
        }
        case "example": {
          if (!options.effectiveType) break;
          const quoted = quoteExample(target, pair, options.effectiveType());
          if (quoted > 0) notes.count("quoted a number or boolean example", quoted);
          break;
        }
        case XOPENTP: {
          const change = xOpentpChange(target, definition, pair, options.path);
          if (change && change !== "inline") changes.pairs.set(pair, change);
          break;
        }
        case "items":
          if (isMap(pair.value)) {
            editDefinition(target, pair.value, {
              path: keyPath,
              parent: pair,
              layer: options.layer,
              effectiveType: options.effectiveType
                ? () => ({ type: options.effectiveType?.().itemsType })
                : undefined,
            });
          }
          break;
      }
    }
    editMapping(target.text, definition, changes, target.edits, target.eol, options.parent);
  } catch (error) {
    if (!(error instanceof EditError)) throw error;
    target.edits.truncate(editCount);
    findings.manualItem(
      target.file,
      options.path,
      `Could not edit this definition automatically (${error.message}): apply the 2026-09 changes by hand`,
    );
  }
}

/** The definitions of a mapping keyed by names (`schema`, `taxonomy`): name, definition, pair */
export function definitionsOf(map: unknown): Array<[string, YAMLMap, Pair]> {
  if (!isMap(map)) return [];
  const out: Array<[string, YAMLMap, Pair]> = [];
  for (const pair of map.items as Pair[]) {
    const key = keyOf(pair);
    if (key !== null && isMap(pair.value)) out.push([key, pair.value, pair]);
  }
  return out;
}
