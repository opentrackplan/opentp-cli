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
import { kotlinSdkGenerator } from "./kotlin-sdk";
// Import built-in generators
import { registerGenerator } from "./registry";
import { swiftSdkGenerator } from "./swift-sdk";
import { templateGenerator } from "./template";
import { tsSdkGenerator } from "./ts-sdk";
import { yamlGenerator } from "./yaml";

// Register built-in generators
registerGenerator(jsonGenerator);
registerGenerator(yamlGenerator);
registerGenerator(templateGenerator);
registerGenerator(tsSdkGenerator);
registerGenerator(swiftSdkGenerator);
registerGenerator(kotlinSdkGenerator);
