import type { RuleDefinition } from "../types";

/**
 * Validates that a string value starts with a given prefix
 *
 * Params: string (prefix)
 *
 * Examples:
 *   starts-with: "app_"
 *   starts-with: "COMP-"
 */
export const startsWith: RuleDefinition = {
  name: "starts-with",
  validate: (value, params) => {
    const prefix = typeof params === "string" ? params : "";

    if (typeof value !== "string") {
      return {
        valid: false,
        error: `Expected string, got ${typeof value}`,
        code: "TYPE_MISMATCH",
      };
    }

    if (!value.startsWith(prefix)) {
      return {
        valid: false,
        error: `Value "${value}" does not start with "${prefix}"`,
        code: "STARTS_WITH_FAILED",
      };
    }

    return { valid: true };
  },
};
