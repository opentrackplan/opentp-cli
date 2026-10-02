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
 * Load external transform steps from a directory.
 *
 * Every first-level `<dir>/<name>/index.js` is imported (ESM or CommonJS, following the nearest
 * package.json). A relative `dirPath` is resolved against the current working directory.
 * @param dirPath - Path to directory containing step folders
 * @throws when the directory does not exist
 */
export async function loadExternalTransforms(dirPath: string): Promise<void> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { pathToFileURL } = await import("node:url");

  const dir = path.resolve(dirPath);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`External transforms directory not found: ${dir}`);
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const stepPath = path.resolve(dir, entry.name, "index.js");
      if (fs.existsSync(stepPath)) {
        try {
          // A file URL, not a path: bare paths are module specifiers (and break on Windows)
          const module = await import(pathToFileURL(stepPath).href);
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
