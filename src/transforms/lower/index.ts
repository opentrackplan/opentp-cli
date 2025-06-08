import type { StepDefinition } from "../types";

export const lower: StepDefinition = {
  name: "lower",
  factory: () => (value: string) => value.toLowerCase(),
};
