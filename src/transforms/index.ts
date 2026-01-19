// Re-export factory functions
export { createStepFn, createTransform, createTransforms } from "./factory";

// Re-export registry functions
export { getStep, getStepNames, hasStep, loadExternalTransforms, registerStep } from "./registry";
export type { StepDefinition, TransformConfig, TransformFn, TransformStepConfig } from "./types";

import { collapse } from "./collapse";
import { keep } from "./keep";
import { lower } from "./lower";
// Import built-in transform steps
import { registerStep } from "./registry";
import { replace } from "./replace";
import { toCamelCase } from "./to-camel-case";
import { toKebab } from "./to-kebab";
import { toSnakeCase } from "./to-snake-case";
import { toUnderscore } from "./to-underscore";
import { transliterate } from "./transliterate";
import { trim } from "./trim";
import { truncate } from "./truncate";
import { upper } from "./upper";

// Register built-in transform steps
registerStep(lower);
registerStep(upper);
registerStep(trim);
registerStep(replace);
registerStep(collapse);
registerStep(keep);
registerStep(toCamelCase);
registerStep(toKebab);
registerStep(toSnakeCase);
registerStep(toUnderscore);
registerStep(transliterate);
registerStep(truncate);
