import type { StepDefinition } from "../types";

/**
 * Replace non-alphanumeric characters with underscore
 * Collapses multiple underscores and trims from edges
 *
 * @example
 * { step: 'to-underscore' }
 */
export const toUnderscore: StepDefinition = {
  name: "to-underscore",
  factory: () => (value: string) => {
    return value
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/_+/g, "_");
  },
};
