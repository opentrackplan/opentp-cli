import * as fs from "node:fs";
import * as path from "node:path";
import { parseYaml } from "./yaml";

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
 * Loads a YAML file (mappings keep their source key order, see keysInSourceOrder)
 */
export function loadYaml<T>(filePath: string): T {
  const content = fs.readFileSync(filePath, "utf-8");
  return parseYaml(content) as T;
}

/**
 * Returns true when a parsed YAML value is a mapping (a plain object, not an array or null)
 */
export function isYamlMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Formats an error thrown while reading or parsing a YAML file as a one-line message.
 * YAML syntax errors become "Invalid YAML at line L, column C: <reason>" (the code frame that the
 * yaml package appends to its messages is dropped).
 */
export function formatLoadError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const firstLine = raw.split("\n")[0].trim();

  const linePos = (error as { linePos?: Array<{ line: number; col: number }> } | null)?.linePos;
  if (error instanceof Error && error.name === "YAMLParseError") {
    const reason = firstLine.replace(/ at line \d+, column \d+:?$/, "");
    const start = Array.isArray(linePos) ? linePos[0] : undefined;
    return start
      ? `Invalid YAML at line ${start.line}, column ${start.col}: ${reason}`
      : `Invalid YAML: ${reason}`;
  }

  return firstLine;
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
