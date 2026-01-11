import type { RuleDefinition } from "../types";

/**
 * Validates that a value is not empty
 * - Strings: must have length > 0 (after trim if params.trim is true)
 * - Arrays: must have length > 0
 * - Objects: must have at least one key
 * - null/undefined: invalid
 *
 * Params: boolean (true to enable) or { trim?: boolean }
 *
 * Examples:
 *   not-empty: true
 *   not-empty: { trim: true }
 */
export const notEmpty: RuleDefinition = {
  name: "not-empty",
  validate: (value, params) => {
    const shouldTrim =
      typeof params === "object" && params !== null ? (params as { trim?: boolean }).trim : false;

    if (value === null || value === undefined) {
      return {
        valid: false,
        error: "Value is null or undefined",
        code: "EMPTY_VALUE",
      };
    }

    if (typeof value === "string") {
      const checkValue = shouldTrim ? value.trim() : value;
      if (checkValue.length === 0) {
        return {
          valid: false,
          error: "String is empty",
          code: "EMPTY_STRING",
        };
      }
    }

    if (Array.isArray(value) && value.length === 0) {
      return {
        valid: false,
        error: "Array is empty",
        code: "EMPTY_ARRAY",
      };
    }

    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
      return {
        valid: false,
        error: "Object is empty",
        code: "EMPTY_OBJECT",
      };
    }

    return { valid: true };
  },
};
