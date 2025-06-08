import type { StepDefinition } from "../types";

export const upper: StepDefinition = {
  name: "upper",
  factory: () => (value: string) => value.toUpperCase(),
};
