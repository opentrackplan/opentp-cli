import type { StepDefinition } from "../types";

/**
 * Convert snake_case or kebab-case to camelCase
 *
 * @example
 * { step: 'to-camel-case' }
 */
export const toCamelCase: StepDefinition = {
  name: "to-camel-case",
  factory: () => (value: string) => {
    return (
      value
        .toLowerCase()
        // Replace separator + letter with uppercase letter
        .replace(/[-_\s]+(.)/g, (_, char) => char.toUpperCase())
        // Remove any remaining separators
        .replace(/[-_\s]+/g, "")
    );
  },
};
