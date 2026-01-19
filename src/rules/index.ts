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

import { contains } from "./contains";
import { endsWith } from "./ends-with";
import { maxLength } from "./max-length";
import { minLength } from "./min-length";
import { notEmpty } from "./not-empty";
// Import built-in rules
import { pattern } from "./pattern";
import { registerRule } from "./registry";
import { startsWith } from "./starts-with";
import { webhook } from "./webhook";

// Register built-in rules
registerRule(maxLength);
registerRule(minLength);
registerRule(pattern);
registerRule(contains);
registerRule(startsWith);
registerRule(endsWith);
registerRule(notEmpty);
registerRule(webhook);
