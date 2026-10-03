import { getStep, hasStep } from "./registry";
import type { TransformConfig, TransformFn, TransformStepConfig } from "./types";

/**
 * Returns the name of a well-formed step (a string, or a mapping with exactly one key), or null.
 */
function getStepName(step: unknown): string | null {
  if (typeof step === "string") return step;
  if (typeof step === "object" && step !== null && !Array.isArray(step)) {
    const keys = Object.keys(step);
    if (keys.length === 1) return keys[0];
  }
  return null;
}

/**
 * Returns why a pipeline step cannot be used, or null when it can: the step must be a step name or
 * a single-key mapping `{ <step>: <params> }`, and the step must be registered (built-in, or loaded
 * with --external-transforms).
 */
export function getStepProblem(step: unknown): string | null {
  const stepName = getStepName(step);
  if (stepName === null) {
    return `Invalid transform step ${JSON.stringify(step) ?? String(step)}: expected a step name or a single-key mapping { <step>: <params> }`;
  }
  if (!hasStep(stepName)) {
    return `Unknown transform step '${stepName}' (custom steps: keygen.plugins in opentp.cli.yaml, or --external-transforms)`;
  }
  return null;
}

/**
 * Create a transform function from a single step
 * @throws when the step is malformed or unknown (see getStepProblem)
 */
export function createStepFn(step: TransformStepConfig): TransformFn {
  const problem = getStepProblem(step);
  if (problem) {
    throw new Error(problem);
  }

  const stepName = getStepName(step) as string;
  const params = typeof step === "string" ? undefined : (step as Record<string, unknown>)[stepName];
  const definition = getStep(stepName);
  if (!definition) {
    throw new Error(`Unknown transform step '${stepName}'`);
  }

  return definition.factory(params);
}

/**
 * Create a transform function from config
 * @throws when a step is malformed or unknown
 */
export function createTransform(config: TransformConfig): TransformFn {
  const steps = config ?? [];

  // Compile all steps into functions
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
 * @throws when a step is malformed or unknown
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
