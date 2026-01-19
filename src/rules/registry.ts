import type { RuleContext, RuleDefinition, RuleResult } from "./types";

/**
 * Registry of all available rules
 */
const ruleRegistry = new Map<string, RuleDefinition>();

/**
 * Register a rule in the registry
 */
export function registerRule(rule: RuleDefinition): void {
  ruleRegistry.set(rule.name, rule);
}

/**
 * Get a rule by name
 */
export function getRule(name: string): RuleDefinition | undefined {
  return ruleRegistry.get(name);
}

/**
 * Get all registered rule names
 */
export function getRuleNames(): string[] {
  return Array.from(ruleRegistry.keys());
}

/**
 * Check if a rule exists
 */
export function hasRule(name: string): boolean {
  return ruleRegistry.has(name);
}

/**
 * Load external rules from a directory
 * @param dirPath - Path to directory containing rule folders
 */
export async function loadExternalRules(dirPath: string): Promise<void> {
  const fs = await import("node:fs");
  const path = await import("node:path");

  if (!fs.existsSync(dirPath)) {
    throw new Error(`External rules directory not found: ${dirPath}`);
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const rulePath = path.join(dirPath, entry.name, "index.js");
      if (fs.existsSync(rulePath)) {
        try {
          const module = await import(rulePath);
          const rule = module.default || module[entry.name];
          if (rule && typeof rule.validate === "function") {
            registerRule(rule);
          }
        } catch (err) {
          console.error(`Failed to load external rule from ${rulePath}:`, err);
        }
      }
    }
  }
}

/**
 * Validate a value against a set of rules
 * @param value - The value to validate
 * @param rules - Rules configuration { ruleName: params }
 * @param context - Validation context
 * @returns Array of validation errors (empty if all valid)
 */
export async function validateWithRules(
  value: unknown,
  rules: Record<string, unknown>,
  context: RuleContext,
): Promise<RuleResult[]> {
  const errors: RuleResult[] = [];

  for (const [ruleName, params] of Object.entries(rules)) {
    const rule = getRule(ruleName);
    if (!rule) {
      errors.push({
        valid: false,
        error: `Unknown check: ${ruleName}`,
        code: "UNKNOWN_CHECK",
      });
      continue;
    }

    const result = await rule.validate(value, params, context);
    if (!result.valid) {
      errors.push(result);
    }
  }

  return errors;
}
