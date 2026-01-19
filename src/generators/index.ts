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

import { jsonGenerator } from "./json";
// Import built-in generators
import { registerGenerator } from "./registry";
import { templateGenerator } from "./template";
import { yamlGenerator } from "./yaml";

// Register built-in generators
registerGenerator(jsonGenerator);
registerGenerator(yamlGenerator);
registerGenerator(templateGenerator);
