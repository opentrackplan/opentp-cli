import { getStep } from "./registry";
import type { TransformConfig, TransformFn, TransformStep } from "./types";

/**
 * Create a transform function from a single step
 */
export function createStepFn(step: TransformStep): TransformFn {
  const definition = getStep(step.step);

  if (!definition) {
    console.warn(`Unknown transform step: ${step.step}`);
    return (value: string) => value;
  }

  return definition.factory(step.params);
}

/**
 * Create a transform function from config
 */
export function createTransform(config: TransformConfig): TransformFn {
  const { steps = [] } = config;

  // Compile all steps into functions
  const stepFunctions = steps.map(createStepFn);

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
