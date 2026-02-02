/**
 * Pattern matching for paths like '{application}/{category}/{functional}/{name}.yaml'
 * and keys like '{application | slug}::{category | slug}::{name | slug}'
 */

export interface PatternPart {
  type: "literal" | "variable";
  value: string;
  transforms?: string[];
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

      // Variables optionally support a transform pipeline: {name | slug | truncate160}
      const tokens = content.split("|").map((t) => t.trim());
      const varName = tokens[0]?.trim() ?? "";
      if (!varName) {
        throw new Error(`Empty variable in pattern: ${pattern}`);
      }

      const transforms = tokens.slice(1).filter(Boolean);
      parts.push({
        type: "variable",
        value: varName,
        transforms: transforms.length > 0 ? transforms : undefined,
      });

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
  return patternToRegexWithVars(pattern, { segment: false });
}

export function templateToRegex(template: string): RegExp {
  return patternToRegexWithVars(template, { segment: true });
}

function patternToRegexWithVars(pattern: string, opts: { segment: boolean }): RegExp {
  const parts = parsePattern(pattern);
  let regexStr = "^";

  for (const part of parts) {
    if (part.type === "literal") {
      // Escape regex special characters
      regexStr += escapeRegex(part.value);
    } else {
      // Named capture group for variable
      regexStr += opts.segment ? `(?<${part.value}>[^/]+?)` : `(?<${part.value}>.+?)`;
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
 * Extracts variables from a path using a spec template.
 *
 * Differences vs extractVariables():
 * - placeholders must not have transforms
 * - each placeholder matches a single path segment (does not span '/')
 */
export function extractTemplateVariables(
  path: string,
  template: string,
): Record<string, string> | null {
  const parts = parsePattern(template);
  for (const part of parts) {
    if (part.type === "variable" && part.transforms && part.transforms.length > 0) {
      throw new Error(`Transforms are not allowed in templates: ${template}`);
    }
  }

  const regex = templateToRegex(template);
  const match = path.match(regex);

  if (!match?.groups) return null;
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

      // Apply transforms (pipeline) if configured
      if (part.transforms) {
        for (const transformId of part.transforms) {
          const fn = transforms[transformId];
          if (!fn) {
            throw new Error(`Unknown transform '${transformId}' in pattern: ${pattern}`);
          }
          value = fn(value);
        }
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
