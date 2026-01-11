import type { StepDefinition } from "../types";

/**
 * Convert camelCase or PascalCase to snake_case
 *
 * @example
 * { step: 'to-snake-case' }
 */
export const toSnakeCase: StepDefinition = {
  name: "to-snake-case",
  factory: () => (value: string) => {
    return (
      value
        // Insert underscore before uppercase letters
        .replace(/([A-Z])/g, "_$1")
        .toLowerCase()
        // Remove leading underscore
        .replace(/^_/, "")
        // Replace non-alphanumeric with underscore
        .replace(/[^a-z0-9]+/g, "_")
        // Collapse multiple underscores
        .replace(/_+/g, "_")
        // Trim underscores from edges
        .replace(/^_+|_+$/g, "")
    );
  },
};
