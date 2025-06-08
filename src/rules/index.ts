// Re-export registry functions
export {
  getRule,
  getRuleNames,
  hasRule,
  loadExternalRules,
  registerRule,
  validateWithRules,
} from "./registry";
export * from "./types";

// Re-export validation functions
export { validateFieldExclusivity } from "./validation";

// Import built-in rules
import { registerRule } from "./registry";
import { maxLength } from "./max-length";
import { regex } from "./regex";

// Register built-in rules
registerRule(maxLength);
registerRule(regex);