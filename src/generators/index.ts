// Re-export registry functions
export {
  getGenerator,
  getGeneratorNames,
  hasGenerator,
  loadExternalGenerators,
  registerGenerator,
} from "./registry";
export type {
  GeneratedFile,
  GeneratorContext,
  GeneratorDefinition,
  GeneratorOptions,
  GeneratorResult,
} from "./types";

// Import built-in generators
import { registerGenerator } from "./registry";
import { jsonGenerator } from "./json";

// Register built-in generators
registerGenerator(jsonGenerator);
