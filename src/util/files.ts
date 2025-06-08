import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "yaml";

/**
 * Recursively scans a directory and returns Map<relativePath, absolutePath>
 */
export function scanDirectory(dir: string): Map<string, string> {
  const results = new Map<string, string>();

  if (!fs.existsSync(dir)) {
    return results;
  }

  const scan = (currentDir: string, baseDir: string): void => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        scan(fullPath, baseDir);
      } else {
        const relativePath = path.relative(baseDir, fullPath);
        const normalizedPath = relativePath.split(path.sep).join("/");
        results.set(normalizedPath, fullPath);
      }
    }
  };

  scan(dir, dir);
  return results;
}

/**
 * Filters files by extension
 */
export function filterByExtension(
  files: Map<string, string>,
  extensions: string[],
): Map<string, string> {
  const result = new Map<string, string>();
  const exts = extensions.map((e) => e.toLowerCase());

  for (const [relativePath, absolutePath] of files) {
    const ext = path.extname(relativePath).toLowerCase();
    if (exts.includes(ext)) {
      result.set(relativePath, absolutePath);
    }
  }

  return result;
}

/**
 * Loads a YAML file
 */
export function loadYaml<T>(filePath: string): T {
  const content = fs.readFileSync(filePath, "utf-8");
  return parse(content) as T;
}

/**
 * Saves data to a YAML file
 */
export function saveYaml(filePath: string, data: unknown): void {
  const { stringify } = require("yaml");
  fs.writeFileSync(filePath, stringify(data), "utf-8");
}

/**
 * Checks if a file exists
 */
export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * Creates directory if it doesn't exist
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}
