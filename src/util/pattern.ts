/**
 * Pattern matching for paths like '{application}/{category}/{functional}/{name}.yaml'
 * and keys like '{application | slug}::{category | slug}::{name | slug}'
 */

export interface PatternPart {
  type: "literal" | "variable";
  value: string;
  transform?: string;
}

/**
 * Parses pattern into parts: literals and variables
 * '{application}/{category}/{name}.yaml' ->
 * [{type: 'variable', value: 'application'}, {type: 'literal', value: '/'}, ...]
 */
export function parsePattern(pattern: string): PatternPart[] {
  const parts: PatternPart[] = [];
  let i = 0;

  while (i < pattern.length) {
    if (pattern[i] === "{") {
      // Find closing bracket
      const end = pattern.indexOf("}", i);
      if (end === -1) {
        throw new Error(`Unclosed bracket in pattern: ${pattern}`);
      }

      const content = pattern.slice(i + 1, end);

      // Check for transform: {name | slug}
      const pipeIndex = content.indexOf("|");
      if (pipeIndex !== -1) {
        const varName = content.slice(0, pipeIndex).trim();
        const transform = content.slice(pipeIndex + 1).trim();
        parts.push({ type: "variable", value: varName, transform });
      } else {
        parts.push({ type: "variable", value: content.trim() });
      }

      i = end + 1;
    } else {
      // Collect literal until next {
      let end = pattern.indexOf("{", i);
      if (end === -1) end = pattern.length;

      const literal = pattern.slice(i, end);
      if (literal) {
        parts.push({ type: "literal", value: literal });
      }
      i = end;
    }
  }

  return parts;
}

/**
 * Converts pattern to regex for variable extraction
 * '{application}/{category}/{name}.yaml' -> regex with named groups
 */
export function patternToRegex(pattern: string): RegExp {
  const parts = parsePattern(pattern);
  let regexStr = "^";

  for (const part of parts) {
    if (part.type === "literal") {
      // Escape regex special characters
      regexStr += escapeRegex(part.value);
    } else {
      // Named capture group for variable
      regexStr += `(?<${part.value}>.+?)`;
    }
  }

  regexStr += "$";
  return new RegExp(regexStr, "u");
}

/**
 * Extracts variables from path using pattern
 */
export function extractVariables(path: string, pattern: string): Record<string, string> | null {
  const regex = patternToRegex(pattern);
  const match = path.match(regex);

  if (!match?.groups) {
    return null;
  }

  return { ...match.groups };
}

/**
 * Applies pattern to generate string from variables
 * pattern: '{application | slug}::{name | slug}'
 * variables: {application: 'My App', name: 'Click - Button'}
 * transforms: Map of transform functions
 */
export function applyPattern(
  pattern: string,
  variables: Record<string, string>,
  transforms: Record<string, (value: string) => string>,
): string {
  const parts = parsePattern(pattern);
  let result = "";

  for (const part of parts) {
    if (part.type === "literal") {
      result += part.value;
    } else {
      let value = variables[part.value];
      if (value === undefined) {
        throw new Error(`Variable '${part.value}' not found in variables`);
      }

      // Apply transform if exists
      if (part.transform && transforms[part.transform]) {
        value = transforms[part.transform](value);
      }

      result += value;
    }
  }

  return result;
}

/**
 * Gets list of variables from pattern
 */
export function getPatternVariables(pattern: string): string[] {
  const parts = parsePattern(pattern);
  return parts.filter((p) => p.type === "variable").map((p) => p.value);
}

/**
 * Escapes special characters for regex
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
