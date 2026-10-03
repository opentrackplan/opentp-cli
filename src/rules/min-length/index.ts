import { codePointLength } from "../../core/constraints";
import type { RuleDefinition } from "../types";

/**
 * Validates that a string value has at least minimum length
 *
 * The length is counted in Unicode code points (an emoji counts as 1).
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

    const length = codePointLength(value);
    if (length < minLen) {
      return {
        valid: false,
        error: `Length ${length} is less than minimum ${minLen}`,
        code: "MIN_LENGTH_NOT_MET",
      };
    }

    return { valid: true };
  },
};
