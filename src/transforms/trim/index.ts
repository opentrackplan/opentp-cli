import type { StepDefinition } from "../types";

export interface TrimParams {
  chars: string;
}

/**
 * Trim specified characters from start and end
 *
 * @example
 * { step: 'trim', params: { chars: '_' } }
 * { step: 'trim', params: { chars: '-_' } }
 */
export const trim: StepDefinition = {
  name: "trim",
  factory: (params?: unknown) => {
    const { chars = "" } = (params ?? {}) as unknown as TrimParams;

    if (!chars) {
      // Default: trim whitespace
      return (value: string) => value.trim();
    }

    const regex = new RegExp(`^[${chars}]+|[${chars}]+$`, "g");

    return (value: string) => value.replace(regex, "");
  },
};
