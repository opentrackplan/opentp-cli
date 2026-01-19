// OpenTrackPlan CLI - Entry Point
// Run: node dist/index.js [command] [options]

import "./cli";

// Version info
export { SPEC_SCHEMAS_URL, SPEC_VERSION, VERSION } from "./meta";

export type { TransformConfig, TransformFn, TransformStepConfig } from "./transforms";
// Re-export for library usage
export { createTransform, createTransforms, getStep, getStepNames } from "./transforms";
