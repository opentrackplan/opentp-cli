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
 * Load external rules from a directory.
 *
 * Every first-level `<dir>/<name>/index.js` is imported (ESM or CommonJS, following the nearest
 * package.json). A relative `dirPath` is resolved against the current working directory.
 * @param dirPath - Path to directory containing rule folders
 * @throws when the directory does not exist
 */
export async function loadExternalRules(dirPath: string): Promise<void> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { pathToFileURL } = await import("node:url");

  const dir = path.resolve(dirPath);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`External rules directory not found: ${dir}`);
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const rulePath = path.resolve(dir, entry.name, "index.js");
      if (fs.existsSync(rulePath)) {
        try {
          // A file URL, not a path: bare paths are module specifiers (and break on Windows)
          const module = await import(pathToFileURL(rulePath).href);
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
 *
 * A rule that throws (or rejects, or returns something that is not a result object) does not abort
 * the run: it produces a `CHECK_FAILED` error "check <name> failed: <message>" for this value.
 *
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

    let result: RuleResult;
    try {
      result = await rule.validate(value, params, context);
    } catch (err) {
      errors.push({
        valid: false,
        error: `check ${ruleName} failed: ${err instanceof Error ? err.message : String(err)}`,
        code: "CHECK_FAILED",
      });
      continue;
    }

    if (typeof result !== "object" || result === null) {
      errors.push({
        valid: false,
        error: `check ${ruleName} failed: expected a result object, got ${result === null ? "null" : typeof result}`,
        code: "CHECK_FAILED",
      });
      continue;
    }

    if (!result.valid) {
      errors.push(result);
    }
  }

  return errors;
}
