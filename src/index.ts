// OpenTrackPlan CLI - Entry Point
// Run: node dist/index.js [command] [options]

import "./cli";

export type { TransformConfig, TransformFn, TransformStep } from "./transforms";
// Re-export for library usage
export { createTransform, createTransforms, getStep, getStepNames } from "./transforms";
export type { Transform } from "./types";
