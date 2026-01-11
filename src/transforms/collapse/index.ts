import type { StepDefinition } from "../types";

/**
 * Remove all non-alphanumeric characters
 *
 * @example
 * { step: 'collapse' }
 */
export const collapse: StepDefinition = {
  name: "collapse",
  factory: () => (value: string) => {
    return value.replace(/[^a-zA-Z0-9]/g, "");
  },
};
