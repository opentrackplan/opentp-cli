import type { StepDefinition } from "../types";

/**
 * Replace non-alphanumeric characters with dash (kebab-case)
 * Collapses multiple dashes and trims from edges
 *
 * @example
 * { step: 'to-kebab' }
 */
export const toKebab: StepDefinition = {
  name: "to-kebab",
  factory: () => (value: string) => {
    return value
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-+/g, "-");
  },
};
