import { getStep } from "./registry";
import type { TransformConfig, TransformFn, TransformStepConfig } from "./types";

/**
 * Create a transform function from a single step
 */
export function createStepFn(step: TransformStepConfig): TransformFn {
  let stepName: string;
  let params: unknown;

  if (typeof step === "string") {
    stepName = step;
    params = undefined;
  } else if (typeof step === "object" && step !== null) {
    const keys = Object.keys(step);
    if (keys.length !== 1) {
      console.warn(`Invalid transform step (expected single key): ${JSON.stringify(step)}`);
      return (value: string) => value;
    }
    stepName = keys[0];
    params = (step as Record<string, unknown>)[stepName];
  } else {
    console.warn(`Invalid transform step type: ${typeof step}`);
    return (value: string) => value;
  }

  const definition = getStep(stepName);

  if (!definition) {
    console.warn(`Unknown transform step: ${stepName}`);
    return (value: string) => value;
  }

  return definition.factory(params);
}

/**
 * Create a transform function from config
 */
export function createTransform(config: TransformConfig): TransformFn {
  const steps = config ?? [];

  // Compile all steps into functions (unknown steps become identity)
  const stepFunctions = steps.map((s) => createStepFn(s));

  return (value: string) => {
    let result = value;

    // Apply all steps sequentially
    for (const fn of stepFunctions) {
      result = fn(result);
    }

    return result;
  };
}

/**
 * Create a map of named transforms from config
 */
export function createTransforms(
  transforms: Record<string, TransformConfig>,
): Record<string, TransformFn> {
  const result: Record<string, TransformFn> = {};

  for (const [name, config] of Object.entries(transforms)) {
    result[name] = createTransform(config);
  }

  return result;
}
