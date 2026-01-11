import type { RuleDefinition } from "../types";

/**
 * Validates that a string value ends with a given suffix
 *
 * Params: string (suffix)
 *
 * Examples:
 *   ends-with: "_id"
 *   ends-with: ".yaml"
 */
export const endsWith: RuleDefinition = {
  name: "ends-with",
  validate: (value, params) => {
    const suffix = typeof params === "string" ? params : "";

    if (typeof value !== "string") {
      return {
        valid: false,
        error: `Expected string, got ${typeof value}`,
        code: "TYPE_MISMATCH",
      };
    }

    if (!value.endsWith(suffix)) {
      return {
        valid: false,
        error: `Value "${value}" does not end with "${suffix}"`,
        code: "ENDS_WITH_FAILED",
      };
    }

    return { valid: true };
  },
};
