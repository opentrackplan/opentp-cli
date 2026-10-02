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
 * Load external generators from a directory.
 *
 * Every first-level `<dir>/<name>/index.js` is imported (ESM or CommonJS, following the nearest
 * package.json). A relative `dirPath` is resolved against the current working directory.
 * @param dirPath - Path to directory containing generator folders
 * @throws when the directory does not exist
 */
export async function loadExternalGenerators(dirPath: string): Promise<void> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { pathToFileURL } = await import("node:url");

  const dir = path.resolve(dirPath);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`External generators directory not found: ${dir}`);
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const generatorPath = path.resolve(dir, entry.name, "index.js");
      if (fs.existsSync(generatorPath)) {
        try {
          // A file URL, not a path: bare paths are module specifiers (and break on Windows)
          const module = await import(pathToFileURL(generatorPath).href);
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
