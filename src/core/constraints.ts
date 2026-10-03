/**
 * Constraint keywords shared by every place that checks a value: payload fields, array items,
 * taxonomy fields and fragments, PII settings, event key constraints and portable checks
 * (`spec.checks`).
 *
 * 2026-09 rules: `minLength`/`maxLength` count Unicode code points, `pattern` is an unanchored
 * ECMA-262 regular expression with the `u` flag, and `format` has the meanings below.
 */

import type { StringFormat } from "../types";

/** The `format` values defined by the spec */
export const STRING_FORMATS: readonly StringFormat[] = [
  "date",
  "date-time",
  "email",
  "uuid",
  "uri",
  "ipv4",
  "ipv6",
];

/** The constraint keywords of a portable check (`spec.checks.<id>`) */
export const PORTABLE_CHECK_KEYWORDS = [
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
] as const;

export interface StringConstraints {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
}

export interface NumberConstraints {
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
}

/** The length of a string in Unicode code points (an emoji or a CJK character counts as 1) */
export function codePointLength(value: string): number {
  let length = 0;
  for (const _ of value) length += 1;
  return length;
}

const regexCache = new Map<string, RegExp | null>();

/** Compiles a `pattern` with the `u` flag; null when it is not a valid regular expression */
export function compilePattern(pattern: string): RegExp | null {
  if (regexCache.has(pattern)) return regexCache.get(pattern) ?? null;
  let compiled: RegExp | null;
  try {
    compiled = new RegExp(pattern, "u");
  } catch {
    compiled = null;
  }
  regexCache.set(pattern, compiled);
  return compiled;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

const FULL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;
const UUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
const URI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s\p{Cc}]*$/u;
/** Four decimal octets without leading zeros ("0" itself is allowed) */
const DOTTED_QUAD = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;
const HEX_GROUP = /^[0-9A-Fa-f]{1,4}$/;

/** RFC 3339 full-date */
function isDate(value: string): boolean {
  const match = FULL_DATE.exec(value);
  return match !== null && isValidDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** RFC 3339 date-time (a time offset is required; `T` and `Z` in either case) */
function isDateTime(value: string): boolean {
  const match = DATE_TIME.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  if (!isValidDate(Number(year), Number(month), Number(day))) return false;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 60) return false;
  if (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) {
    return false;
  }
  return true;
}

/**
 * Dotted quad: four decimal octets 0-255 without leading zeros ("0" itself is allowed), as Ajv and
 * the spec's validator read `ipv4` (`192.168.001.1` is not an address)
 */
function isIpv4(value: string): boolean {
  const match = DOTTED_QUAD.exec(value);
  if (!match) return false;
  return match.slice(1).every((part) => Number(part) <= 255);
}

/** RFC 4291 section 2.2 text forms: eight groups, one `::` at most, an optional IPv4 tail */
function isIpv6(value: string): boolean {
  let text = value;
  const lastColon = text.lastIndexOf(":");
  if (lastColon === -1) return false;
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (!isIpv4(tail)) return false;
    // The dotted quad stands for the last two groups
    text = `${text.slice(0, lastColon + 1)}0:0`;
  }

  const compressed = text.indexOf("::");
  if (compressed === -1) {
    const groups = text.split(":");
    return groups.length === 8 && groups.every((group) => HEX_GROUP.test(group));
  }
  if (text.indexOf("::", compressed + 1) !== -1) return false;
  const head = text.slice(0, compressed);
  const rest = text.slice(compressed + 2);
  const groups = [...(head === "" ? [] : head.split(":")), ...(rest === "" ? [] : rest.split(":"))];
  return groups.length <= 7 && groups.every((group) => HEX_GROUP.test(group));
}

/** One `@` with a non-empty local part and a non-empty domain */
function isEmail(value: string): boolean {
  const parts = value.split("@");
  return parts.length === 2 && parts[0] !== "" && parts[1] !== "";
}

const FORMAT_CHECKS: Record<StringFormat, (value: string) => boolean> = {
  date: isDate,
  "date-time": isDateTime,
  email: isEmail,
  uuid: (value) => UUID.test(value),
  uri: (value) => URI.test(value),
  ipv4: isIpv4,
  ipv6: isIpv6,
};

export function isStringFormat(format: unknown): format is StringFormat {
  return typeof format === "string" && Object.hasOwn(FORMAT_CHECKS, format);
}

/**
 * Whether `value` has the given format. Unknown formats are not checked (true): opentp.yaml and
 * event files are not schema-checked by the CLI.
 */
export function matchesFormat(format: unknown, value: string): boolean {
  return isStringFormat(format) ? FORMAT_CHECKS[format](value) : true;
}

export interface StringConstraintOptions {
  /**
   * What to do with a `pattern` that is not a valid regular expression: "report" it as a problem
   * of the value, or "skip" it (the pattern is reported once elsewhere, e.g. against opentp.yaml)
   */
  invalidPattern?: "report" | "skip";
}

/**
 * The problems of a string against `minLength`, `maxLength` (code points), `pattern` and `format`
 * (messages as reported by `opentp validate`)
 */
export function stringConstraintProblems(
  value: string,
  constraints: StringConstraints,
  options: StringConstraintOptions = {},
): string[] {
  const problems: string[] = [];
  const hasMin = typeof constraints.minLength === "number";
  const hasMax = typeof constraints.maxLength === "number";
  if (hasMin || hasMax) {
    const length = codePointLength(value);
    if (hasMin && length < (constraints.minLength as number)) {
      problems.push(`Expected length >= ${constraints.minLength}`);
    }
    if (hasMax && length > (constraints.maxLength as number)) {
      problems.push(`Expected length <= ${constraints.maxLength}`);
    }
  }
  if (typeof constraints.pattern === "string") {
    const regex = compilePattern(constraints.pattern);
    if (regex === null) {
      if (options.invalidPattern === "report") {
        let reason = "";
        try {
          new RegExp(constraints.pattern, "u");
        } catch (error) {
          reason = String(error);
        }
        problems.push(`Invalid regex pattern ${JSON.stringify(constraints.pattern)}: ${reason}`);
      }
    } else if (!regex.test(value)) {
      problems.push(`Value does not match pattern ${JSON.stringify(constraints.pattern)}`);
    }
  }
  if (constraints.format !== undefined && !matchesFormat(constraints.format, value)) {
    problems.push(`Value is not a valid ${constraints.format}`);
  }
  return problems;
}

/** The problems of a finite number against the numeric constraint keywords */
export function numberConstraintProblems(value: number, constraints: NumberConstraints): string[] {
  const problems: string[] = [];
  if (typeof constraints.minimum === "number" && value < constraints.minimum) {
    problems.push(`Expected >= ${constraints.minimum}`);
  }
  if (typeof constraints.maximum === "number" && value > constraints.maximum) {
    problems.push(`Expected <= ${constraints.maximum}`);
  }
  if (typeof constraints.exclusiveMinimum === "number" && value <= constraints.exclusiveMinimum) {
    problems.push(`Expected > ${constraints.exclusiveMinimum}`);
  }
  if (typeof constraints.exclusiveMaximum === "number" && value >= constraints.exclusiveMaximum) {
    problems.push(`Expected < ${constraints.exclusiveMaximum}`);
  }
  if (typeof constraints.multipleOf === "number" && Number.isFinite(constraints.multipleOf)) {
    const m = constraints.multipleOf;
    if (m > 0) {
      const q = value / m;
      if (!Number.isFinite(q) || Math.abs(q - Math.round(q)) > 1e-12) {
        problems.push(`Expected multipleOf ${m}`);
      }
    }
  }
  return problems;
}

/**
 * The problems of a value against a portable check: string keywords apply to strings, number
 * keywords to finite numbers, and nothing applies to other values. An invalid `pattern` is reported
 * once against opentp.yaml, so it is skipped here.
 */
export function portableCheckProblems(
  definition: StringConstraints & NumberConstraints,
  value: unknown,
): string[] {
  if (typeof value === "string") {
    return stringConstraintProblems(value, definition, { invalidPattern: "skip" });
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return numberConstraintProblems(value, definition);
  }
  return [];
}
