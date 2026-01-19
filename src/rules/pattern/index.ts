import type { RuleDefinition } from "../types";

interface PatternParams {
  pattern: string;
  flags?: string;
}

/**
 * Validates that a string value matches a regular expression
 *
 * Params: string (pattern) or { pattern: string, flags?: string }
 *
 * Examples:
 *   pattern: "^[a-z_]+$"
 *   pattern: { pattern: "^[a-z]+$", flags: "i" }
 */
export const pattern: RuleDefinition = {
  name: "pattern",
  validate: (value, params) => {
    let pattern: string;
    let flags: string | undefined;

    if (typeof params === "string") {
      pattern = params;
    } else if (typeof params === "object" && params !== null) {
      const p = params as PatternParams;
      pattern = p.pattern;
      flags = p.flags;
    } else {
      return {
        valid: false,
        error: "Invalid pattern params: expected string or { pattern, flags? }",
        code: "INVALID_PARAMS",
      };
    }

    if (typeof value !== "string") {
      return {
        valid: false,
        error: `Expected string, got ${typeof value}`,
        code: "TYPE_MISMATCH",
      };
    }

    try {
      const re = new RegExp(pattern, flags);
      if (!re.test(value)) {
        return {
          valid: false,
          error: `Value "${value}" does not match pattern /${pattern}/${flags || ""}`,
          code: "PATTERN_NO_MATCH",
        };
      }
    } catch (_err) {
      return {
        valid: false,
        error: `Invalid pattern: ${pattern}`,
        code: "INVALID_REGEX",
      };
    }

    return { valid: true };
  },
};
