import type { RuleDefinition } from "../types";

/**
 * Validates that a string value does not exceed maximum length
 *
 * Params: number (max length)
 *
 * Examples:
 *   max-length: 50
 *   max-length: 100
 */
export const maxLength: RuleDefinition = {
  name: "max-length",
  validate: (value, params) => {
    const maxLen = typeof params === "number" ? params : 0;

    if (typeof value !== "string") {
      return {
        valid: false,
        error: `Expected string, got ${typeof value}`,
        code: "TYPE_MISMATCH",
      };
    }

    if (value.length > maxLen) {
      return {
        valid: false,
        error: `Length ${value.length} exceeds maximum ${maxLen}`,
        code: "MAX_LENGTH_EXCEEDED",
      };
    }

    return { valid: true };
  },
};
