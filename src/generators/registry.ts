import type { GeneratorDefinition } from "./types";

/**
 * Registry of all available generators
 */
const generatorRegistry = new Map<string, GeneratorDefinition>();

/**
 * Register a generator in the registry
 */
export function registerGenerator(generator: GeneratorDefinition): void {
  generatorRegistry.set(generator.name, generator);
}

/**
 * Get a generator by name
 */
export function getGenerator(name: string): GeneratorDefinition | undefined {
  return generatorRegistry.get(name);
}

/**
 * Check if a generator exists
 */
export function hasGenerator(name: string): boolean {
  return generatorRegistry.has(name);
}

/**
 * Get all registered generator names
 */
export function getGeneratorNames(): string[] {
  return Array.from(generatorRegistry.keys());
}

/**
 * Load external generators from a directory
 * @param dirPath - Path to directory containing generator folders
 */
export async function loadExternalGenerators(dirPath: string): Promise<void> {
  const fs = await import("node:fs");
  const path = await import("node:path");

  if (!fs.existsSync(dirPath)) {
    throw new Error(`External generators directory not found: ${dirPath}`);
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const generatorPath = path.join(dirPath, entry.name, "index.js");
      if (fs.existsSync(generatorPath)) {
        try {
          const module = await import(generatorPath);
          const generator = module.default || module[entry.name];
          if (generator && typeof generator.generate === "function") {
            registerGenerator(generator);
          }
        } catch (err) {
          console.error(`Failed to load external generator from ${generatorPath}:`, err);
        }
      }
    }
  }
}
