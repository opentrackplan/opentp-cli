import type { RuleDefinition } from "../types";

interface RegexParams {
  pattern: string;
  flags?: string;
}

/**
 * Validates that a string value matches a regular expression
 *
 * Params: string (pattern) or { pattern: string, flags?: string }
 *
 * Examples:
 *   regex: "^[a-z_]+$"
 *   regex: { pattern: "^[a-z]+$", flags: "i" }
 */
export const regex: RuleDefinition = {
  name: "regex",
  validate: (value, params) => {
    let pattern: string;
    let flags: string | undefined;

    if (typeof params === "string") {
      pattern = params;
    } else if (typeof params === "object" && params !== null) {
      const p = params as RegexParams;
      pattern = p.pattern;
      flags = p.flags;
    } else {
      return {
        valid: false,
        error: "Invalid regex params: expected string or { pattern, flags? }",
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
          code: "REGEX_NO_MATCH",
        };
      }
    } catch (_err) {
      return {
        valid: false,
        error: `Invalid regex pattern: ${pattern}`,
        code: "INVALID_REGEX",
      };
    }

    return { valid: true };
  },
};
