import type { StepDefinition } from "../types";

export interface ReplaceParams {
  from: string;
  to: string;
}

/**
 * Replace all occurrences of a literal string
 *
 * @example
 * { replace: { from: \" \", to: \"_\" } }
 */
export const replace: StepDefinition = {
  name: "replace",
  factory: (params?: unknown) => {
    const { from, to } = (params ?? {}) as unknown as ReplaceParams;

    if (typeof from !== "string" || from.length === 0) {
      return (value: string) => value;
    }

    return (value: string) => value.split(from).join(String(to ?? ""));
  },
};
