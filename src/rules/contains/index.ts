import type { RuleDefinition } from "../types";

/**
 * Validates that a string value contains a given substring
 *
 * Params: string (substring)
 *
 * Examples:
 *   contains: "_click"
 *   contains: "user"
 */
export const contains: RuleDefinition = {
  name: "contains",
  validate: (value, params) => {
    const substring = typeof params === "string" ? params : "";

    if (typeof value !== "string") {
      return {
        valid: false,
        error: `Expected string, got ${typeof value}`,
        code: "TYPE_MISMATCH",
      };
    }

    if (!value.includes(substring)) {
      return {
        valid: false,
        error: `Value "${value}" does not contain "${substring}"`,
        code: "CONTAINS_FAILED",
      };
    }

    return { valid: true };
  },
};
