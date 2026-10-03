/**
 * 2026-09 field rules shared by opentp.yaml checks (validateConfig, validateEvents) and per-event
 * payload validation: values, enum members and examples against the type and constraints of a
 * field, PII settings, the problems of the base layers (catalog, spec.targets.all,
 * spec.targets.<T>), and field-name suggestions for the closed vocabulary.
 */

import type {
  ArrayItems,
  Field,
  OpenTPConfig,
  PayloadMeta,
  PiiConfig,
  PiiReservedFieldConfig,
} from "../types";
import { isYamlMapping } from "../util";
import { numberConstraintProblems, stringConstraintProblems } from "./constraints";
import {
  type BaseField,
  type DictionaryLookup,
  isPolicy,
  mergeBaseLayers,
  sameValue,
  showValue,
} from "./payload";

/** A problem of a value at `<path><suffix>` (suffix: "", "[0]", ".pii.kind", ...) */
export interface ValueProblem {
  suffix: string;
  message: string;
  /** The rule needed the values of a dictionary */
  dictionary?: boolean;
}

export interface ValueOptions {
  /** Dictionary values (unknown dictionaries are reported where they are written: skipped here) */
  lookup?: DictionaryLookup;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

/** A field as constraints (string and number keywords); invalid regexes are reported where written */
function constraintProblems(value: string | number, field: Field | ArrayItems): string[] {
  if (typeof value === "string") {
    return stringConstraintProblems(value, field, { invalidPattern: "skip" });
  }
  if (!Number.isFinite(value)) return ["Expected finite number"];
  return numberConstraintProblems(value, field);
}

function numberProblems(value: number, field: Field | ArrayItems, isInt: boolean): string[] {
  if (!Number.isFinite(value)) return ["Expected finite number"];
  const problems = isInt && !Number.isInteger(value) ? ["Expected integer"] : [];
  return [...problems, ...numberConstraintProblems(value, field)];
}

/** One array item against `items` (type, constraints, enum and dictionary membership) */
function itemProblems(
  value: string | number | boolean,
  items: ArrayItems,
  lookup: DictionaryLookup | undefined,
): Array<Omit<ValueProblem, "suffix">> {
  const type = items.type;
  const problems: Array<Omit<ValueProblem, "suffix">> = [];
  const add = (messages: string[]) => {
    for (const message of messages) problems.push({ message });
  };

  if (type === "string") {
    if (typeof value !== "string")
      return [{ message: `Expected string item, got ${typeof value}` }];
    add(stringConstraintProblems(value, items, { invalidPattern: "skip" }));
  } else if (type === "number") {
    if (!isFiniteNumber(value)) return [{ message: `Expected number item, got ${typeof value}` }];
    add(numberProblems(value, items, false));
  } else if (type === "integer") {
    if (!isInteger(value)) return [{ message: `Expected integer item, got ${typeof value}` }];
    add(numberProblems(value, items, true));
  } else if (type === "boolean") {
    if (typeof value !== "boolean") {
      return [{ message: `Expected boolean item, got ${typeof value}` }];
    }
  }

  if (Array.isArray(items.enum) && items.enum.length > 0 && !items.enum.includes(value)) {
    problems.push({ message: `Item value '${String(value)}' is not in allowed enum` });
  }
  if (typeof items.dict === "string") {
    const allowed = lookup?.(items.dict) ?? null;
    if (allowed && !allowed.includes(value)) {
      problems.push({
        message: `Item value '${String(value)}' is not in dictionary '${items.dict}'`,
        dictionary: true,
      });
    }
  }
  return problems;
}

/**
 * The problems of a value (a fixed value, an enum member, an example) against the type and the
 * constraints of a field, including the array keywords and each item against `items`. Membership
 * in the field's own enum or dictionary is not checked here (see layerMerge and exampleProblems).
 */
export function valueProblems(
  value: unknown,
  field: Field,
  options: ValueOptions = {},
): ValueProblem[] {
  const type = field.type;
  const problems: ValueProblem[] = [];
  const add = (messages: string[], suffix = "") => {
    for (const message of messages) problems.push({ suffix, message });
  };

  if (Array.isArray(value)) {
    if (type && type !== "array")
      return [{ suffix: "", message: `Expected ${type} value, got array` }];

    if (typeof field.minItems === "number" && value.length < field.minItems) {
      add([`Expected minItems ${field.minItems}`]);
    }
    if (typeof field.maxItems === "number" && value.length > field.maxItems) {
      add([`Expected maxItems ${field.maxItems}`]);
    }
    if (field.uniqueItems) {
      const seen = new Set<string>();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) {
          add(["Expected uniqueItems"]);
          break;
        }
        seen.add(key);
      }
    }

    value.forEach((item, index) => {
      const suffix = `[${index}]`;
      if (item === null) {
        add(["Array items must be scalar (null is not allowed)"], suffix);
      } else if (
        typeof item !== "string" &&
        typeof item !== "number" &&
        typeof item !== "boolean"
      ) {
        add([`Array items must be scalar, got ${typeof item}`], suffix);
      } else if (typeof item === "number" && !Number.isFinite(item)) {
        add(["Array items must be finite numbers"], suffix);
      } else if (isYamlMapping(field.items)) {
        for (const problem of itemProblems(item, field.items, options.lookup)) {
          problems.push({ suffix, ...problem });
        }
      }
    });
    return problems;
  }

  if (
    value === null ||
    (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
  ) {
    return [
      {
        suffix: "",
        message: `Expected scalar value, got ${value === null ? "null" : typeof value}`,
      },
    ];
  }

  if (type === "string") {
    if (typeof value !== "string")
      return [{ suffix: "", message: `Expected string value, got ${typeof value}` }];
    add(stringConstraintProblems(value, field, { invalidPattern: "skip" }));
  } else if (type === "number") {
    if (!isFiniteNumber(value)) {
      return [{ suffix: "", message: `Expected number value, got ${typeof value}` }];
    }
    add(numberProblems(value, field, false));
  } else if (type === "integer") {
    if (!isInteger(value)) {
      return [{ suffix: "", message: `Expected integer value, got ${typeof value}` }];
    }
    add(numberProblems(value, field, true));
  } else if (type === "boolean") {
    if (typeof value !== "boolean") {
      return [{ suffix: "", message: `Expected boolean value, got ${typeof value}` }];
    }
  } else if (type === "array") {
    add(["Expected array value"]);
  } else if (typeof value !== "boolean") {
    // Untyped (the type is missing, reported once): constraints that apply to the value
    add(constraintProblems(value, field));
  }
  return problems;
}

/**
 * The problems of an `example` against the field merged up to and including the layer that writes
 * it: type and constraints, the fixed value (equal), enum, dictionary and item membership
 */
export function exampleProblems(
  example: unknown,
  field: Field,
  options: ValueOptions = {},
): ValueProblem[] {
  const problems = valueProblems(example, field, options);
  if (field.value !== undefined) {
    if (!sameValue(example, field.value)) {
      problems.push({
        suffix: "",
        message: `Example ${showValue(example)} is not the fixed value ${showValue(field.value)}`,
      });
    }
  } else if (Array.isArray(field.enum) && field.enum.length > 0) {
    if (!field.enum.some((member) => sameValue(member, example))) {
      problems.push({
        suffix: "",
        message: `Example ${showValue(example)} is not in allowed enum: [${field.enum.map(String).join(", ")}]`,
      });
    }
  } else if (typeof field.dict === "string") {
    const allowed = options.lookup?.(field.dict) ?? null;
    if (allowed && !allowed.some((value) => sameValue(value, example))) {
      problems.push({
        suffix: "",
        message: `Example ${showValue(example)} is not in dictionary '${field.dict}'`,
        dictionary: true,
      });
    }
  }
  return problems;
}

// --- Keywords that depend on the type ------------------------------------------------------------

const STRING_KEYWORDS = ["minLength", "maxLength", "pattern", "format"] as const;
const NUMBER_KEYWORDS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
] as const;
const ARRAY_KEYWORDS = ["items", "minItems", "maxItems", "uniqueItems"] as const;

/**
 * The keywords of a written definition that the field's type does not allow (the typed branches of
 * field.schema.json, checked after merging because an event field usually inherits its type):
 * top-level `enum`/`dict` on an array (use `items.enum`/`items.dict`), string constraints on
 * other types, number constraints on other types, `items`/`minItems`/`maxItems`/`uniqueItems` on
 * non-arrays, and the same string and number rules inside `items` by the item type. Suffixes are
 * `.<keyword>` or `.items.<keyword>`. Without a type there is nothing to check (a missing type is
 * reported elsewhere).
 */
export function typedKeywordProblems(
  name: string,
  written: Field,
  effective: Field,
): ValueProblem[] {
  const problems: ValueProblem[] = [];
  const type = effective.type;
  if (typeof type !== "string") return problems;
  const has = (definition: object, keyword: string) =>
    (definition as Record<string, unknown>)[keyword] !== undefined;
  const fieldText = `(the type of '${name}' is ${type})`;

  if (type === "array") {
    for (const keyword of ["enum", "dict"] as const) {
      if (has(written, keyword)) {
        problems.push({
          suffix: `.${keyword}`,
          message: `${keyword} is not allowed on an array field: use items.${keyword}`,
        });
      }
    }
  }
  if (type !== "string") {
    for (const keyword of STRING_KEYWORDS) {
      if (has(written, keyword)) {
        problems.push({
          suffix: `.${keyword}`,
          message: `${keyword} applies only to string fields ${fieldText}`,
        });
      }
    }
  }
  if (type !== "number" && type !== "integer") {
    for (const keyword of NUMBER_KEYWORDS) {
      if (has(written, keyword)) {
        problems.push({
          suffix: `.${keyword}`,
          message: `${keyword} applies only to number and integer fields ${fieldText}`,
        });
      }
    }
  }
  if (type !== "array") {
    for (const keyword of ARRAY_KEYWORDS) {
      if (has(written, keyword)) {
        problems.push({
          suffix: `.${keyword}`,
          message: `${keyword} applies only to array fields ${fieldText}`,
        });
      }
    }
    return problems;
  }

  // Inside items, by the item type
  const items = isYamlMapping(written.items) ? written.items : null;
  const itemType = isYamlMapping(effective.items) ? effective.items.type : undefined;
  if (items === null || typeof itemType !== "string") return problems;
  const itemText = `(the item type of '${name}' is ${itemType})`;
  if (itemType !== "string") {
    for (const keyword of STRING_KEYWORDS) {
      if (has(items, keyword)) {
        problems.push({
          suffix: `.items.${keyword}`,
          message: `${keyword} applies only to string items ${itemText}`,
        });
      }
    }
  }
  if (itemType !== "number" && itemType !== "integer") {
    for (const keyword of NUMBER_KEYWORDS) {
      if (has(items, keyword)) {
        problems.push({
          suffix: `.items.${keyword}`,
          message: `${keyword} applies only to number and integer items ${itemText}`,
        });
      }
    }
  }
  return problems;
}

export interface PiiOptions extends ValueOptions {
  /** Check that `pii.kind`, `pii.masker` and pii meta fields marked required are present */
  required: boolean;
  /** Check the values of these keys only (default: every key) */
  keys?: ReadonlySet<string>;
}

/**
 * The problems of a field's `pii` against `spec.events.pii` (suffixes `.pii.<key>`): required keys,
 * `kind`/`masker` (strings, enum, dictionary, string constraints) and meta values (type, enum,
 * dictionary, constraints). Checks are run by the caller.
 */
export function piiProblems(
  pii: Record<string, unknown>,
  piiConfig: PiiConfig,
  options: PiiOptions,
): ValueProblem[] {
  const problems: ValueProblem[] = [];
  const checked = (key: string) => options.keys === undefined || options.keys.has(key);
  const kindConfig = isYamlMapping(piiConfig.kind) ? piiConfig.kind : undefined;
  const maskerConfig = isYamlMapping(piiConfig.masker) ? piiConfig.masker : undefined;

  if (options.required) {
    if (kindConfig?.required && typeof pii.kind !== "string") {
      problems.push({ suffix: ".pii.kind", message: "pii.kind is required" });
    }
    if (maskerConfig?.required && typeof pii.masker !== "string") {
      problems.push({ suffix: ".pii.masker", message: "pii.masker is required" });
    }
  }

  const reserved = (name: "kind" | "masker", config: PiiReservedFieldConfig | undefined) => {
    const value = pii[name];
    if (!config || value === undefined || !checked(name)) return;
    const suffix = `.pii.${name}`;
    if (typeof value !== "string") {
      problems.push({ suffix, message: `pii.${name} must be a string` });
      return;
    }
    if (Array.isArray(config.enum) && config.enum.length > 0 && !config.enum.includes(value)) {
      problems.push({ suffix, message: `Value '${value}' is not in allowed pii.${name} enum` });
    }
    if (typeof config.dict === "string") {
      const allowed = options.lookup?.(config.dict) ?? null;
      if (allowed && !allowed.includes(value)) {
        problems.push({
          suffix,
          message: `Value '${value}' is not in dictionary '${config.dict}'`,
          dictionary: true,
        });
      }
    }
    for (const message of stringConstraintProblems(value, config, { invalidPattern: "skip" })) {
      problems.push({ suffix, message });
    }
  };
  reserved("kind", kindConfig);
  reserved("masker", maskerConfig);

  if (isYamlMapping(piiConfig.schema)) {
    for (const [metaName, metaConfig] of Object.entries(piiConfig.schema)) {
      // A definition that is not a mapping is reported once against opentp.yaml
      if (!isYamlMapping(metaConfig)) continue;
      const metaValue = pii[metaName];
      const suffix = `.pii.${metaName}`;

      if (metaValue === undefined) {
        if (options.required && metaConfig.required) {
          problems.push({ suffix, message: `Required pii metadata '${metaName}' is missing` });
        }
        continue;
      }
      if (!checked(metaName)) continue;

      const typeOk =
        (metaConfig.type === "string" && typeof metaValue === "string") ||
        (metaConfig.type === "number" && isFiniteNumber(metaValue)) ||
        (metaConfig.type === "integer" && isInteger(metaValue)) ||
        (metaConfig.type === "boolean" && typeof metaValue === "boolean");
      if (!typeOk) {
        problems.push({ suffix, message: `Expected ${metaConfig.type}, got ${typeof metaValue}` });
        continue;
      }

      if (
        Array.isArray(metaConfig.enum) &&
        metaConfig.enum.length > 0 &&
        !metaConfig.enum.includes(metaValue as never)
      ) {
        problems.push({ suffix, message: `Value '${String(metaValue)}' is not in allowed enum` });
      }
      if (typeof metaConfig.dict === "string") {
        const allowed = options.lookup?.(metaConfig.dict) ?? null;
        if (allowed && !allowed.includes(metaValue)) {
          problems.push({
            suffix,
            message: `Value '${String(metaValue)}' is not in dictionary '${metaConfig.dict}'`,
            dictionary: true,
          });
        }
      }
      if (typeof metaValue === "string" || typeof metaValue === "number") {
        for (const message of constraintProblems(metaValue, metaConfig as Field)) {
          problems.push({ suffix, message });
        }
      }
    }
  }
  return problems;
}

/** The pii settings of opentp.yaml, when they are a mapping */
export function piiConfigOf(config: OpenTPConfig): PiiConfig | undefined {
  const pii: unknown = config.spec.events.pii;
  return isYamlMapping(pii) ? (pii as PiiConfig) : undefined;
}

/** The target ids of spec.events.payload.targets.all (strings only, each once) */
export function targetIds(config: OpenTPConfig): string[] {
  const all: unknown = config.spec.events.payload.targets?.all;
  if (!Array.isArray(all)) return [];
  return [...new Set(all.filter((target): target is string => typeof target === "string"))];
}

/** A field's code-facing name: its `name`, else its key */
export function codeName(key: string, field: Field): string {
  return typeof field.name === "string" && field.name !== "" ? field.name : key;
}

export function codeNameMessage(name: string, first: string, second: string): string {
  return `Code-facing name '${name}' is used by both '${first}' and '${second}'`;
}

/** The message for `required: false` on a field that is always present */
export function alwaysPresentMessage(field: string, reason: string): string {
  return `Field '${field}' is always present (${reason}); remove required: false`;
}

/**
 * Payload versions marked `meta.deprecated` are exempt from policy (they describe history), so a
 * restricted or fixed policy does not make their fields present
 */
export function isDeprecatedVersion(meta: PayloadMeta | undefined): boolean {
  if (!isYamlMapping(meta)) return false;
  const deprecated: unknown = meta.deprecated;
  return deprecated !== undefined && deprecated !== null && deprecated !== false;
}

/** Why a field with this definition is always present (a fixed value or a strict policy), or null */
export function presenceReason(field: Field, policyApplies = true): string | null {
  if (field.value !== undefined) return "it has a fixed value";
  if (policyApplies && (field.policy === "restricted" || field.policy === "fixed")) {
    return `its policy is '${field.policy}'`;
  }
  return null;
}

/** A problem of the base layers, reported once against opentp.yaml */
export interface BaseIssue {
  path: string;
  message: string;
  /** Needs the dictionaries: reported by validateEvents, not validateConfig */
  dictionary?: boolean;
}

/**
 * The problems of the base layers (catalog, spec.targets.all, spec.targets.<T>), each once, at the
 * path of the definition that causes it:
 * - conflicts and narrowing between the layers (type, fixed values, enum and dictionary subsets,
 *   weakened `required`, lowered `policy`);
 * - a field with no type (or an array field with no `items.type`) on some target;
 * - `required: false` next to a fixed value or a restricted/fixed policy; invalid policies;
 * - values, enum members, item enum members and examples against the field merged up to the layer
 *   that writes them; pii settings where they are written;
 * - keywords that the field's merged type does not allow (typedKeywordProblems), at the layer that
 *   writes them;
 * - code-facing names shared by two common fields of a target.
 * Without `lookup`, rules that need dictionary values are skipped (unknown dictionaries are
 * reported separately, where they are written).
 */
export function analyzeBaseLayers(config: OpenTPConfig, lookup?: DictionaryLookup): BaseIssue[] {
  const issues: BaseIssue[] = [];
  const seen = new Set<string>();
  const push = (issue: BaseIssue) => {
    const id = `${issue.path}\u0000${issue.message}`;
    if (seen.has(id)) return;
    seen.add(id);
    issues.push(issue);
  };
  const pushAll = (path: string, problems: ValueProblem[]) => {
    for (const problem of problems) {
      push({
        path: `${path}${problem.suffix}`,
        message: problem.message,
        ...(problem.dictionary ? { dictionary: true } : {}),
      });
    }
  };
  const piiConfig = piiConfigOf(config);
  const targets = targetIds(config);
  const checkedSites = new Set<string>();

  // "all" merges the catalog and spec.targets.all only; every target adds its own layer
  for (const targetId of ["all", ...targets.filter((target) => target !== "all")]) {
    const isTarget = targetId !== "all" || targets.length === 0;
    const result = mergeBaseLayers(config, targetId, lookup);

    for (const problem of result.problems) {
      push({
        path: problem.path,
        message: problem.message,
        ...(problem.dictionary ? { dictionary: true } : {}),
      });
    }

    for (const site of result.sites) {
      // Against the type of this target's merged field (a later layer may give the type)
      const final = result.fields.get(site.name)?.field;
      if (final) pushAll(site.path, typedKeywordProblems(site.name, site.written, final));

      if (checkedSites.has(site.path)) continue;
      checkedSites.add(site.path);
      const { written, merged, name } = site;

      if (written.policy !== undefined && !isPolicy(written.policy)) {
        push({
          path: `${site.path}.policy`,
          message: `Invalid policy '${String(written.policy)}': expected specified, restricted or fixed`,
        });
      }
      if (written.required === false) {
        const reason = presenceReason(written);
        if (reason) push({ path: site.path, message: alwaysPresentMessage(name, reason) });
      }
      if (written.value !== undefined) {
        pushAll(`${site.path}.value`, valueProblems(written.value, merged, { lookup }));
      }
      // A top-level enum on an array is reported as such (typedKeywordProblems)
      if (Array.isArray(written.enum) && merged.type !== "array") {
        written.enum.forEach((member, index) => {
          pushAll(`${site.path}.enum[${index}]`, valueProblems(member, merged, { lookup }));
        });
      }
      if (
        isYamlMapping(written.items) &&
        Array.isArray(written.items.enum) &&
        isYamlMapping(merged.items)
      ) {
        const items = merged.items as Field;
        written.items.enum.forEach((member, index) => {
          pushAll(`${site.path}.items.enum[${index}]`, valueProblems(member, items, { lookup }));
        });
      }
      if (written.example !== undefined) {
        pushAll(`${site.path}.example`, exampleProblems(written.example, merged, { lookup }));
      }
      if (piiConfig && isYamlMapping(written.pii) && isYamlMapping(merged.pii)) {
        pushAll(site.path, piiProblems(merged.pii, piiConfig, { required: true, lookup }));
      }
    }

    if (!isTarget) continue;

    const names = new Map<string, string>();
    for (const [name, base] of result.fields) {
      const definedAt = base.sites[0];
      if (base.field.type === undefined) {
        push({
          path: definedAt,
          message: `Field '${name}' has no type: give it a type in the catalog or in spec.targets`,
        });
      } else if (
        base.field.type === "array" &&
        !(isYamlMapping(base.field.items) && base.field.items.type !== undefined)
      ) {
        push({
          path: `${definedAt}.items`,
          message: `Field '${name}' has no items.type: give its items a type in the catalog or in spec.targets`,
        });
      }

      if (!base.common) continue;
      const code = codeName(name, base.field);
      const first = names.get(code);
      if (first === undefined) names.set(code, name);
      else push({ path: lastSite(base), message: codeNameMessage(code, first, name) });
    }
  }

  return issues;
}

function lastSite(base: BaseField): string {
  return base.sites[base.sites.length - 1];
}

// --- Field-name suggestions ----------------------------------------------------------------------

/**
 * Natural order: runs of digits compare as numbers (`dimension_2` before `dimension_10`), other
 * text by code point (no locale)
 */
export function naturalCompare(a: string, b: string): number {
  const chunks = (text: string) => text.match(/\d+|\D+/g) ?? [];
  const left = chunks(a);
  const right = chunks(b);
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    const x = left[i];
    const y = right[i];
    if (x === y) continue;
    const xDigits = /^\d/.test(x);
    const yDigits = /^\d/.test(y);
    if (xDigits && yDigits) {
      const difference = Number(x) - Number(y);
      if (difference !== 0) return difference < 0 ? -1 : 1;
      if (x.length !== y.length) return x.length < y.length ? -1 : 1;
      continue;
    }
    return x < y ? -1 : 1;
  }
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return 0;
}

/** Levenshtein distance between two strings (code points) */
export function editDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let previous = Array.from({ length: y.length + 1 }, (_, index) => index);
  for (let i = 1; i <= x.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= y.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[y.length];
}

/** At most this many names are suggested */
const MAX_SUGGESTIONS = 3;
/** Names further away than this are not suggested */
const MAX_SUGGESTION_DISTANCE = 2;

/**
 * The names to suggest for an unknown field: names equal to it ignoring case win; else the names
 * at the smallest edit distance (at most 2); natural-sorted, at most 3
 */
export function suggestNames(name: string, candidates: Iterable<string>): string[] {
  const unique = [...new Set(candidates)].filter((candidate) => candidate !== name);
  const lower = name.toLowerCase();
  let best = unique.filter((candidate) => candidate.toLowerCase() === lower);
  if (best.length === 0) {
    let minimum = MAX_SUGGESTION_DISTANCE + 1;
    for (const candidate of unique) {
      const distance = editDistance(name, candidate);
      if (distance < minimum) {
        minimum = distance;
        best = [candidate];
      } else if (distance === minimum) {
        best.push(candidate);
      }
    }
  }
  return best.sort(naturalCompare).slice(0, MAX_SUGGESTIONS);
}

/**
 * `. Did you mean 'a', 'b' or 'c'?` (empty without suggestions): ends the sentence before it and
 * asks the question
 */
export function didYouMean(names: string[]): string {
  if (names.length === 0) return "";
  const quoted = names.map((name) => `'${name}'`);
  const list =
    quoted.length === 1
      ? quoted[0]
      : `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
  return `. Did you mean ${list}?`;
}

/** The closed-vocabulary error for a field that is neither a catalog field nor a common field */
export function unknownFieldMessage(name: string, targetId: string, candidates: string[]): string {
  return `Unknown field '${name}': add it to the catalog (spec.events.payload.schema) or to spec.targets.all/${targetId}.schema${didYouMean(suggestNames(name, candidates))}`;
}
