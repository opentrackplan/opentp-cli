// Re-export factory functions
export { createStepFn, createTransform, createTransforms } from "./factory";

// Re-export registry functions
export { getStep, getStepNames, hasStep, loadExternalTransforms, registerStep } from "./registry";
export type { StepDefinition, TransformConfig, TransformFn, TransformStep } from "./types";

// Import built-in transform steps
import { registerStep } from "./registry";
import { lower } from "./lower";
import { replace } from "./replace";
import { trim } from "./trim";
import { upper } from "./upper";

// Register built-in transform steps
registerStep(lower);
registerStep(upper);
registerStep(replace);
registerStep(trim);
