import type { StepDefinition } from "../types";

export interface TransliterateParams {
  map: Record<string, string>;
}

/**
 * Transliterate characters based on a mapping
 *
 * @example
 * { step: 'transliterate', params: { map: { 'ä': 'ae', 'ö': 'oe' } } }
 */
export const transliterate: StepDefinition = {
  name: "transliterate",
  factory: (params?: unknown) => {
    const { map = {} } = (params ?? {}) as unknown as TransliterateParams;

    return (value: string) => {
      return value
        .split("")
        .map((char) => {
          const lower = char.toLowerCase();
          const mapped = map[lower];
          if (mapped !== undefined) {
            // Preserve case: if original was uppercase, capitalize only first char
            if (char !== lower && mapped.length > 0) {
              return mapped[0].toUpperCase() + mapped.slice(1);
            }
            return mapped;
          }
          return char;
        })
        .join("");
    };
  },
};
