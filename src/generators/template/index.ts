import * as fs from "node:fs";
import * as path from "node:path";
import type { GeneratorContext, GeneratorDefinition, GeneratorResult } from "../types";

/**
 * Simple template engine with mustache-like syntax
 *
 * Supports:
 *   {{variable}}           - Variable interpolation
 *   {{object.property}}    - Nested property access
 *   {{#each items}}...{{/each}} - Loop over arrays
 *   {{#if condition}}...{{/if}} - Conditionals
 *   {{@index}}             - Current index in loop
 *   {{@key}}               - Current key in object iteration
 */

type TemplateData = Record<string, unknown>;

/**
 * Get nested property from object
 */
function getProperty(obj: TemplateData, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = (current as TemplateData)[part];
  }

  return current;
}

/**
 * Render a template string with data
 */
function render(template: string, data: TemplateData): string {
  let result = template;

  // Process {{#each}}...{{/each}} blocks
  result = result.replace(
    /\{\{#each\s+(\w+(?:\.\w+)*)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_, arrayPath, content) => {
      const items = getProperty(data, arrayPath);
      if (!Array.isArray(items)) {
        return "";
      }
      return items
        .map((item, index) => {
          const itemData =
            typeof item === "object" && item !== null
              ? { ...data, ...item, "@index": index, "@item": item }
              : { ...data, "@index": index, "@item": item };
          return render(content, itemData as TemplateData);
        })
        .join("");
    },
  );

  // Process {{#if}}...{{/if}} blocks
  result = result.replace(
    /\{\{#if\s+(\w+(?:\.\w+)*)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, conditionPath, content) => {
      const condition = getProperty(data, conditionPath);
      return condition ? render(content, data) : "";
    },
  );

  // Process {{variable}} interpolation
  result = result.replace(/\{\{(\w+(?:\.\w+)*|@\w+)\}\}/g, (_, varPath) => {
    const value = getProperty(data, varPath);
    if (value === undefined || value === null) {
      return "";
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return String(value);
  });

  return result;
}

/**
 * Build template data from context
 */
function buildTemplateData(context: GeneratorContext): TemplateData {
  const { config, events, dictionaries } = context;

  return {
    opentp: config.opentp,
    info: config.info,
    events: events.map((e) => ({
      key: e.key,
      taxonomy: e.taxonomy,
      lifecycle: e.lifecycle,
      payload: e.payload,
    })),
    dictionaries: Object.fromEntries(dictionaries),
    config,
  };
}

/**
 * Template generator
 *
 * Renders a template file with event data.
 *
 * Options:
 *   --file <path>    Template file path (required)
 *   --output <path>  Output file path (default: stdout)
 *
 * Template syntax:
 *   {{variable}}                 - Variable interpolation
 *   {{object.property}}          - Nested property
 *   {{#each events}}...{{/each}} - Loop
 *   {{#if lifecycle}}...{{/if}}  - Conditional
 */
export const templateGenerator: GeneratorDefinition = {
  name: "template",
  description: "Render a template file with event data",

  generate(context: GeneratorContext): GeneratorResult {
    const templatePath = context.options.file as string | undefined;

    if (!templatePath) {
      throw new Error("Template generator requires --file option");
    }

    const absolutePath = path.isAbsolute(templatePath)
      ? templatePath
      : path.resolve(process.cwd(), templatePath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Template file not found: ${absolutePath}`);
    }

    const template = fs.readFileSync(absolutePath, "utf-8");
    const data = buildTemplateData(context);
    const content = render(template, data);

    if (context.options.output) {
      return {
        files: [
          {
            path: context.options.output as string,
            content,
          },
        ],
      };
    }

    return { stdout: content };
  },
};
