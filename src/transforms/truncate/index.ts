import type { StepDefinition } from "../types";

export interface TruncateParams {
  maxLen: number;
}

/**
 * Truncate string to maximum length
 *
 * @example
 * { step: 'truncate', params: { maxLen: 160 } }
 * { step: 'truncate', params: { maxLen: 50 } }
 */
export const truncate: StepDefinition = {
  name: "truncate",
  factory: (params?: unknown) => {
    const maxLen =
      typeof params === "number"
        ? params
        : typeof params === "object" && params !== null
          ? ((params as TruncateParams).maxLen as number)
          : undefined;

    if (!maxLen || maxLen <= 0) {
      return (value: string) => value;
    }

    return (value: string) => {
      if (value.length > maxLen) {
        return value.slice(0, maxLen);
      }
      return value;
    };
  },
};
