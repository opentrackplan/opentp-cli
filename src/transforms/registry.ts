import type { StepDefinition } from "./types";

/**
 * Registry of all available transform steps
 */
const stepRegistry = new Map<string, StepDefinition>();

/**
 * Register a transform step in the registry
 */
export function registerStep(definition: StepDefinition): void {
  stepRegistry.set(definition.name, definition);
}

/**
 * Get a step definition by name
 */
export function getStep(name: string): StepDefinition | undefined {
  return stepRegistry.get(name);
}

/**
 * Check if a step exists
 */
export function hasStep(name: string): boolean {
  return stepRegistry.has(name);
}

/**
 * Get all registered step names
 */
export function getStepNames(): string[] {
  return Array.from(stepRegistry.keys());
}

/**
 * Load external transform steps from a directory
 * @param dirPath - Path to directory containing step folders
 */
export async function loadExternalTransforms(dirPath: string): Promise<void> {
  const fs = await import("node:fs");
  const path = await import("node:path");

  if (!fs.existsSync(dirPath)) {
    throw new Error(`External transforms directory not found: ${dirPath}`);
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const stepPath = path.join(dirPath, entry.name, "index.js");
      if (fs.existsSync(stepPath)) {
        try {
          const module = await import(stepPath);
          const step = module.default || module[entry.name];
          if (step && typeof step.factory === "function") {
            registerStep(step);
          }
        } catch (err) {
          console.error(`Failed to load external transform from ${stepPath}:`, err);
        }
      }
    }
  }
}
