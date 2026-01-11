import type { RuleDefinition } from "../types";

/**
 * Validates that a string value has at least minimum length
 *
 * Params: number (min length)
 *
 * Examples:
 *   min-length: 3
 *   min-length: 1
 */
export const minLength: RuleDefinition = {
  name: "min-length",
  validate: (value, params) => {
    const minLen = typeof params === "number" ? params : 0;

    if (typeof value !== "string") {
      return {
        valid: false,
        error: `Expected string, got ${typeof value}`,
        code: "TYPE_MISMATCH",
      };
    }

    if (value.length < minLen) {
      return {
        valid: false,
        error: `Length ${value.length} is less than minimum ${minLen}`,
        code: "MIN_LENGTH_NOT_MET",
      };
    }

    return { valid: true };
  },
};
