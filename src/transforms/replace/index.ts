import type { StepDefinition } from "../types";

export interface ReplaceParams {
  pattern: string;
  with: string;
  flags?: string;
}

/**
 * Replace text matching a regex pattern
 *
 * @example
 * { step: 'replace', params: { pattern: '\\s+', with: '_' } }
 * { step: 'replace', params: { pattern: '[0-9]', with: '', flags: 'g' } }
 */
export const replace: StepDefinition = {
  name: "replace",
  factory: (params?: Record<string, unknown>) => {
    const {
      pattern,
      with: replacement = "",
      flags = "g",
    } = (params ?? {}) as unknown as ReplaceParams;

    if (!pattern) {
      return (value: string) => value;
    }

    const regex = new RegExp(pattern, flags);

    return (value: string) => value.replace(regex, replacement);
  },
};
