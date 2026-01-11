import type { StepDefinition } from "../types";

export interface KeepParams {
  chars: string;
}

/**
 * Keep only characters matching the pattern
 *
 * @example
 * { step: 'keep', params: { chars: 'a-z0-9' } }
 * { step: 'keep', params: { chars: 'a-zA-Z' } }
 */
export const keep: StepDefinition = {
  name: "keep",
  factory: (params?: Record<string, unknown>) => {
    const { chars = "" } = (params ?? {}) as unknown as KeepParams;

    if (!chars) {
      return (value: string) => value;
    }

    const regex = new RegExp(`[^${chars}]`, "g");

    return (value: string) => value.replace(regex, "");
  },
};
