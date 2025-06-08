import {
  type FieldDefinition,
  loadExternalRules,
  type RuleContext,
  validateFieldExclusivity,
  validateWithRules,
} from "../rules";
import type { Field, OpenTPConfig, ResolvedEvent, TaxonomyField, ValidationError } from "../types";
import { getDictValues } from "./dict";

/**
 * Validates all events and returns list of errors
 * @param events - Resolved events to validate
 * @param config - OpenTP configuration
 * @param dictionaries - Loaded dictionaries
 * @param externalRulesPaths - Additional paths to external rules directories
 */
export async function validateEvents(
  events: ResolvedEvent[],
  config: OpenTPConfig,
  dictionaries: Map<string, (string | number | boolean)[]>,
  externalRulesPaths: string[] = [],
): Promise<ValidationError[]> {
  // Load external rules from config and CLI
  const allRulesPaths = [...(config.spec.external?.rules ?? []), ...externalRulesPaths];

  for (const rulePath of allRulesPaths) {
    try {
      await loadExternalRules(rulePath);
    } catch (err) {
      console.error(`Failed to load external rules from ${rulePath}:`, err);
    }
  }

  const errors: ValidationError[] = [];

  for (const event of events) {
    const eventErrors = await validateEvent(event, config, dictionaries);
    errors.push(...eventErrors);
  }

  return errors;
}

/**
 * Validates a single event
 */
export async function validateEvent(
  event: ResolvedEvent,
  config: OpenTPConfig,
  dictionaries: Map<string, (string | number | boolean)[]>,
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];
  const ignoreChecks = new Set(event.ignoreChecks.map((ic) => ic.path));

  // 1. Key validation
  if (!ignoreChecks.has("key")) {
    if (event.key !== event.expectedKey) {
      errors.push({
        event: event.relativePath,
        path: "event.key",
        message: `Key mismatch: got '${event.key}', expected '${event.expectedKey}'`,
        severity: "error",
      });
    }
  }

  // 2. Taxonomy validation
  const taxonomyErrors = await validateTaxonomy(
    event,
    config.spec.events.taxonomy,
    dictionaries,
    ignoreChecks,
  );
  errors.push(...taxonomyErrors);

  // 3. Payload validation
  const payloadErrors = await validatePayload(
    event,
    config.spec.events.payload.schema,
    dictionaries,
    ignoreChecks,
  );
  errors.push(...payloadErrors);

  return errors;
}

/**
 * Validates taxonomy fields of an event
 */
async function validateTaxonomy(
  event: ResolvedEvent,
  taxonomyConfig: Record<string, TaxonomyField>,
  dictionaries: Map<string, (string | number | boolean)[]>,
  ignoreChecks: Set<string>,
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  for (const [fieldName, fieldConfig] of Object.entries(taxonomyConfig)) {
    const checkPath = `taxonomy.${fieldName}`;
    if (ignoreChecks.has(checkPath)) continue;

    const value = event.taxonomy[fieldName];

    // Required check
    if (fieldConfig.required && (value === undefined || value === "")) {
      errors.push({
        event: event.relativePath,
        path: checkPath,
        message: `Required field '${fieldName}' is missing`,
        severity: "error",
      });
      continue;
    }

    if (value === undefined) continue;

    // Enum check (inline values)
    if (fieldConfig.enum && !fieldConfig.enum.includes(value)) {
      errors.push({
        event: event.relativePath,
        path: checkPath,
        message: `Value '${value}' is not in allowed values for '${fieldName}'`,
        severity: "error",
      });
    }

    // Dict check (reference to dictionary file)
    if (fieldConfig.dict) {
      const allowedValues = getDictValues(fieldConfig.dict, dictionaries);
      if (allowedValues && !allowedValues.includes(value)) {
        errors.push({
          event: event.relativePath,
          path: checkPath,
          message: `Value '${value}' is not in dictionary '${fieldConfig.dict}'`,
          severity: "error",
        });
      }
    }

    // Rules validation
    if (fieldConfig.rules) {
      const ctx: RuleContext = {
        fieldName,
        fieldPath: checkPath,
        eventKey: event.key,
      };
      const ruleErrors = await validateWithRules(value, fieldConfig.rules, ctx);
      for (const ruleError of ruleErrors) {
        errors.push({
          event: event.relativePath,
          path: checkPath,
          message: ruleError.error || "Validation failed",
          severity: "error",
        });
      }
    }

    // Recursive fragments check
    if (fieldConfig.fragments) {
      for (const [fragName, fragConfig] of Object.entries(fieldConfig.fragments)) {
        const fragCheckPath = `taxonomy.${fragName}`;
        if (ignoreChecks.has(fragCheckPath)) continue;

        const fragValue = event.taxonomy[fragName];

        if (fragConfig.required && (fragValue === undefined || fragValue === "")) {
          errors.push({
            event: event.relativePath,
            path: fragCheckPath,
            message: `Required fragment '${fragName}' is missing`,
            severity: "error",
          });
          continue;
        }

        // Enum check for fragments (inline values)
        if (fragValue && fragConfig.enum && !fragConfig.enum.includes(fragValue)) {
          errors.push({
            event: event.relativePath,
            path: fragCheckPath,
            message: `Value '${fragValue}' is not in allowed values for '${fragName}'`,
            severity: "error",
          });
        }

        // Dict check for fragments
        if (fragValue && fragConfig.dict) {
          const allowedValues = getDictValues(fragConfig.dict, dictionaries);
          if (allowedValues && !allowedValues.includes(fragValue)) {
            errors.push({
              event: event.relativePath,
              path: fragCheckPath,
              message: `Value '${fragValue}' is not in dictionary '${fragConfig.dict}'`,
              severity: "error",
            });
          }
        }

        // Rules validation for fragments
        if (fragValue && fragConfig.rules) {
          const ctx: RuleContext = {
            fieldName: fragName,
            fieldPath: fragCheckPath,
            eventKey: event.key,
          };
          const ruleErrors = await validateWithRules(fragValue, fragConfig.rules, ctx);
          for (const ruleError of ruleErrors) {
            errors.push({
              event: event.relativePath,
              path: fragCheckPath,
              message: ruleError.error || "Validation failed",
              severity: "error",
            });
          }
        }
      }
    }
  }

  return errors;
}

/**
 * Validates payload of an event
 */
async function validatePayload(
  event: ResolvedEvent,
  payloadSchema: Record<string, Field>,
  dictionaries: Map<string, (string | number | boolean)[]>,
  ignoreChecks: Set<string>,
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  // Iterate over all platforms
  for (const [platformName, platformPayload] of Object.entries(event.payload.platforms)) {
    // Iterate over all versions
    for (const [version, versionPayload] of Object.entries(platformPayload.history)) {
      const schema = versionPayload.schema;

      // Check required fields from payloadSchema
      for (const [fieldName, fieldConfig] of Object.entries(payloadSchema)) {
        const checkPath = `payload.${platformName}.${version}.${fieldName}`;
        if (ignoreChecks.has(checkPath) || ignoreChecks.has(`payload::${fieldName}`)) continue;

        const fieldValue = schema[fieldName];

        // Required check
        if (fieldConfig.required && !fieldValue) {
          errors.push({
            event: event.relativePath,
            path: checkPath,
            message: `Required payload field '${fieldName}' is missing`,
            severity: "error",
          });
          continue;
        }

        if (!fieldValue) continue;

        // Enum/dict/value exclusivity check
        const specField: FieldDefinition = {
          enum: fieldConfig.enum as unknown[],
          dict: fieldConfig.dict,
        };
        const eventField: FieldDefinition = {
          enum: fieldValue.enum as unknown[],
          dict: fieldValue.dict,
          value: fieldValue.value,
        };
        const exclusivityError = validateFieldExclusivity(eventField, specField);
        if (exclusivityError) {
          errors.push({
            event: event.relativePath,
            path: checkPath,
            message: exclusivityError.error || "Field exclusivity violation",
            severity: "error",
          });
        }

        // Dict check
        if (fieldConfig.dict && fieldValue.value !== undefined) {
          const allowedValues = getDictValues(fieldConfig.dict, dictionaries);
          if (allowedValues && !allowedValues.includes(fieldValue.value)) {
            errors.push({
              event: event.relativePath,
              path: `${checkPath}.value`,
              message: `Value '${fieldValue.value}' is not in dictionary '${fieldConfig.dict}'`,
              severity: "error",
            });
          }
        }

        // Enum check (inline values)
        if (fieldConfig.enum && fieldValue.value !== undefined) {
          if (!fieldConfig.enum.includes(fieldValue.value)) {
            errors.push({
              event: event.relativePath,
              path: `${checkPath}.value`,
              message: `Value '${fieldValue.value}' is not in allowed enum`,
              severity: "error",
            });
          }
        }

        // Rules validation
        if (fieldConfig.rules && fieldValue.value !== undefined) {
          const ctx: RuleContext = {
            fieldName,
            fieldPath: checkPath,
            eventKey: event.key,
            specField: specField,
          };
          const ruleErrors = await validateWithRules(fieldValue.value, fieldConfig.rules, ctx);
          for (const ruleError of ruleErrors) {
            errors.push({
              event: event.relativePath,
              path: `${checkPath}.value`,
              message: ruleError.error || "Validation failed",
              severity: "error",
            });
          }
        }
      }

      // Check dimension_* fields
      for (const [fieldName, fieldValue] of Object.entries(schema)) {
        if (!fieldName.startsWith("dimension_")) continue;

        const checkPath = `payload.${platformName}.${version}.${fieldName}`;
        if (ignoreChecks.has(checkPath)) continue;

        // Dimension must have title
        if (!fieldValue.title) {
          errors.push({
            event: event.relativePath,
            path: `${checkPath}.title`,
            message: `Dimension '${fieldName}' must have a title`,
            severity: "error",
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Groups errors by event for pretty output
 */
export function groupErrorsByEvent(errors: ValidationError[]): Map<string, ValidationError[]> {
  const grouped = new Map<string, ValidationError[]>();

  for (const error of errors) {
    const existing = grouped.get(error.event) ?? [];
    existing.push(error);
    grouped.set(error.event, existing);
  }

  return grouped;
}

/**
 * Formats errors for console output
 */
export function formatErrors(errors: ValidationError[]): string {
  const grouped = groupErrorsByEvent(errors);
  const lines: string[] = [];

  for (const [event, eventErrors] of grouped) {
    lines.push(`\n[${event}]`);
    for (const error of eventErrors) {
      const prefix = error.severity === "error" ? "✗" : "⚠";
      lines.push(`  ${prefix} ${error.path}: ${error.message}`);
    }
  }

  return lines.join("\n");
}
