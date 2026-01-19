import {
  type FieldDefinition,
  loadExternalRules,
  type RuleContext,
  validateFieldExclusivity,
  validateWithRules,
} from "../rules";
import type { Field, OpenTPConfig, ResolvedEvent, TaxonomyField, ValidationError } from "../types";
import { getDictValues } from "./dict";
import { UNVERSIONED_VERSION_KEY, resolveEventPayload } from "./payload";

function buildIgnoreSet(ignoreChecks: Array<{ path: string }>): Set<string> {
  const ignore = new Set<string>();

  for (const { path } of ignoreChecks) {
    ignore.add(path);

    if (path === "key") ignore.add("event.key");
    if (path === "event.key") ignore.add("key");

    const payloadSchemaMatch = /^payload\.schema\.([^.]+)$/.exec(path);
    if (payloadSchemaMatch) {
      ignore.add(`payload::${payloadSchemaMatch[1]}`);
    }
  }

  return ignore;
}

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
  // Load external rules from CLI only (spec does not define external loading)
  const allRulesPaths = [...externalRulesPaths];

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
  const ignore = buildIgnoreSet(event.ignore);

  // 0. Spec version validation (event file)
  if (!ignore.has("opentp")) {
    const eventVersion = event.opentp;
    if (typeof eventVersion !== "string") {
      errors.push({
        event: event.relativePath,
        path: "opentp",
        message: "Missing required field: opentp",
        severity: "error",
      });
    } else if (eventVersion !== config.opentp) {
      errors.push({
        event: event.relativePath,
        path: "opentp",
        message: `Unsupported OpenTrackPlan schema version '${eventVersion}'. Expected '${config.opentp}'.`,
        severity: "error",
      });
    }
  }

  // 1. Key validation
  if (!ignore.has("key")) {
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
    ignore,
  );
  errors.push(...taxonomyErrors);

  // 3. Payload validation
  const payloadErrors = await validatePayload(
    event,
    config,
    dictionaries,
    ignore,
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
  ignore: Set<string>,
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  function isEmpty(value: unknown): boolean {
    return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
  }

  function validateType(
    value: unknown,
    expectedType: TaxonomyField["type"],
  ): { ok: boolean; message?: string } {
    if (expectedType === "string") {
      return typeof value === "string"
        ? { ok: true }
        : { ok: false, message: `Expected string, got ${typeof value}` };
    }

    if (expectedType === "number") {
      if (typeof value !== "number") {
        return { ok: false, message: `Expected number, got ${typeof value}` };
      }
      if (!Number.isFinite(value)) {
        return { ok: false, message: "Expected finite number" };
      }
      return { ok: true };
    }

    return typeof value === "boolean"
      ? { ok: true }
      : { ok: false, message: `Expected boolean, got ${typeof value}` };
  }

  for (const [fieldName, fieldConfig] of Object.entries(taxonomyConfig)) {
    const checkPath = `taxonomy.${fieldName}`;
    if (ignore.has(checkPath)) continue;

    const value = event.taxonomy[fieldName];

    // Required check
    if (fieldConfig.required && isEmpty(value)) {
      errors.push({
        event: event.relativePath,
        path: checkPath,
        message: `Required field '${fieldName}' is missing`,
        severity: "error",
      });
      continue;
    }

    if (value === undefined) continue;

    // Type validation
    const typeResult = validateType(value, fieldConfig.type);
    if (!typeResult.ok) {
      errors.push({
        event: event.relativePath,
        path: checkPath,
        message: typeResult.message ?? "Type mismatch",
        severity: "error",
      });
      continue;
    }

    const typedValue = value as string | number | boolean;

    // Enum check (inline values)
    if (fieldConfig.enum && !fieldConfig.enum.includes(typedValue)) {
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
      if (allowedValues && !allowedValues.includes(typedValue)) {
        errors.push({
          event: event.relativePath,
          path: checkPath,
          message: `Value '${value}' is not in dictionary '${fieldConfig.dict}'`,
          severity: "error",
        });
      }
    }

    // Checks validation
    if (fieldConfig.checks) {
      const ctx: RuleContext = {
        fieldName,
        fieldPath: checkPath,
        eventKey: event.key,
      };
      const ruleErrors = await validateWithRules(typedValue, fieldConfig.checks, ctx);
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
        if (ignore.has(fragCheckPath)) continue;

        const fragValue = event.taxonomy[fragName];

        if (fragConfig.required && isEmpty(fragValue)) {
          errors.push({
            event: event.relativePath,
            path: fragCheckPath,
            message: `Required fragment '${fragName}' is missing`,
            severity: "error",
          });
          continue;
        }

        if (fragValue === undefined) continue;

        // Type validation for fragments
        const fragTypeResult = validateType(fragValue, fragConfig.type);
        if (!fragTypeResult.ok) {
          errors.push({
            event: event.relativePath,
            path: fragCheckPath,
            message: fragTypeResult.message ?? "Type mismatch",
            severity: "error",
          });
          continue;
        }

        const typedFragValue = fragValue as string | number | boolean;

        // Enum check for fragments (inline values)
        if (fragConfig.enum && !fragConfig.enum.includes(typedFragValue)) {
          errors.push({
            event: event.relativePath,
            path: fragCheckPath,
            message: `Value '${fragValue}' is not in allowed values for '${fragName}'`,
            severity: "error",
          });
        }

        // Dict check for fragments
        if (fragConfig.dict) {
          const allowedValues = getDictValues(fragConfig.dict, dictionaries);
          if (allowedValues && !allowedValues.includes(typedFragValue)) {
            errors.push({
              event: event.relativePath,
              path: fragCheckPath,
              message: `Value '${fragValue}' is not in dictionary '${fragConfig.dict}'`,
              severity: "error",
            });
          }
        }

        // Checks validation for fragments
        if (fragConfig.checks) {
          const ctx: RuleContext = {
            fieldName: fragName,
            fieldPath: fragCheckPath,
            eventKey: event.key,
          };
          const ruleErrors = await validateWithRules(typedFragValue, fragConfig.checks, ctx);
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
  config: OpenTPConfig,
  dictionaries: Map<string, (string | number | boolean)[]>,
  ignore: Set<string>,
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  const payloadSchema = config.spec.events.payload.schema;
  const piiConfig = config.spec.events.pii;

  const { payload: resolvedPayload, issues } = resolveEventPayload(event.payload, config);

  for (const issue of issues) {
    errors.push({
      event: event.relativePath,
      path: issue.path,
      message: issue.message,
      severity: "error",
    });
  }

  async function validatePii(
    fieldName: string,
    schemaFieldPath: string,
    pii: Record<string, unknown>,
  ): Promise<void> {
    if (!piiConfig) return;

    const kind = pii.kind;
    const masker = pii.masker;

    if (piiConfig.kind?.required && typeof kind !== "string") {
      errors.push({
        event: event.relativePath,
        path: `${schemaFieldPath}.pii.kind`,
        message: "pii.kind is required",
        severity: "error",
      });
    }

    if (piiConfig.masker?.required && typeof masker !== "string") {
      errors.push({
        event: event.relativePath,
        path: `${schemaFieldPath}.pii.masker`,
        message: "pii.masker is required",
        severity: "error",
      });
    }

    // Reserved kind
    if (kind !== undefined) {
      if (typeof kind !== "string") {
        errors.push({
          event: event.relativePath,
          path: `${schemaFieldPath}.pii.kind`,
          message: "pii.kind must be a string",
          severity: "error",
        });
      } else {
        if (piiConfig.kind?.enum && !piiConfig.kind.enum.includes(kind)) {
          errors.push({
            event: event.relativePath,
            path: `${schemaFieldPath}.pii.kind`,
            message: `Value '${kind}' is not in allowed pii.kind enum`,
            severity: "error",
          });
        }
        if (piiConfig.kind?.dict) {
          const allowed = getDictValues(piiConfig.kind.dict, dictionaries);
          if (allowed && !allowed.includes(kind)) {
            errors.push({
              event: event.relativePath,
              path: `${schemaFieldPath}.pii.kind`,
              message: `Value '${kind}' is not in dictionary '${piiConfig.kind.dict}'`,
              severity: "error",
            });
          }
        }
        if (piiConfig.kind?.checks) {
          const ctx: RuleContext = {
            fieldName: `${fieldName}.pii.kind`,
            fieldPath: `${schemaFieldPath}.pii.kind`,
            eventKey: event.key,
          };
          const ruleErrors = await validateWithRules(kind, piiConfig.kind.checks, ctx);
          for (const ruleError of ruleErrors) {
            errors.push({
              event: event.relativePath,
              path: `${schemaFieldPath}.pii.kind`,
              message: ruleError.error || "Validation failed",
              severity: "error",
            });
          }
        }
      }
    }

    // Reserved masker
    if (masker !== undefined) {
      if (typeof masker !== "string") {
        errors.push({
          event: event.relativePath,
          path: `${schemaFieldPath}.pii.masker`,
          message: "pii.masker must be a string",
          severity: "error",
        });
      } else {
        if (piiConfig.masker?.enum && !piiConfig.masker.enum.includes(masker)) {
          errors.push({
            event: event.relativePath,
            path: `${schemaFieldPath}.pii.masker`,
            message: `Value '${masker}' is not in allowed pii.masker enum`,
            severity: "error",
          });
        }
        if (piiConfig.masker?.dict) {
          const allowed = getDictValues(piiConfig.masker.dict, dictionaries);
          if (allowed && !allowed.includes(masker)) {
            errors.push({
              event: event.relativePath,
              path: `${schemaFieldPath}.pii.masker`,
              message: `Value '${masker}' is not in dictionary '${piiConfig.masker.dict}'`,
              severity: "error",
            });
          }
        }
        if (piiConfig.masker?.checks) {
          const ctx: RuleContext = {
            fieldName: `${fieldName}.pii.masker`,
            fieldPath: `${schemaFieldPath}.pii.masker`,
            eventKey: event.key,
          };
          const ruleErrors = await validateWithRules(masker, piiConfig.masker.checks, ctx);
          for (const ruleError of ruleErrors) {
            errors.push({
              event: event.relativePath,
              path: `${schemaFieldPath}.pii.masker`,
              message: ruleError.error || "Validation failed",
              severity: "error",
            });
          }
        }
      }
    }

    // Extra PII metadata fields
    if (piiConfig.schema) {
      for (const [metaName, metaConfig] of Object.entries(piiConfig.schema)) {
        const metaValue = pii[metaName];
        const metaPath = `${schemaFieldPath}.pii.${metaName}`;

        if (metaConfig.required && metaValue === undefined) {
          errors.push({
            event: event.relativePath,
            path: metaPath,
            message: `Required pii metadata '${metaName}' is missing`,
            severity: "error",
          });
          continue;
        }

        if (metaValue === undefined) continue;

        const typeOk =
          (metaConfig.type === "string" && typeof metaValue === "string") ||
          (metaConfig.type === "number" && typeof metaValue === "number") ||
          (metaConfig.type === "boolean" && typeof metaValue === "boolean");

        if (!typeOk) {
          errors.push({
            event: event.relativePath,
            path: metaPath,
            message: `Expected ${metaConfig.type}, got ${typeof metaValue}`,
            severity: "error",
          });
          continue;
        }

        if (metaConfig.enum && !metaConfig.enum.includes(metaValue as never)) {
          errors.push({
            event: event.relativePath,
            path: metaPath,
            message: `Value '${String(metaValue)}' is not in allowed enum`,
            severity: "error",
          });
        }

        if (metaConfig.dict) {
          const allowed = getDictValues(metaConfig.dict, dictionaries);
          if (allowed && !allowed.includes(metaValue as never)) {
            errors.push({
              event: event.relativePath,
              path: metaPath,
              message: `Value '${String(metaValue)}' is not in dictionary '${metaConfig.dict}'`,
              severity: "error",
            });
          }
        }

        if (metaConfig.checks) {
          const ctx: RuleContext = {
            fieldName: `${fieldName}.pii.${metaName}`,
            fieldPath: metaPath,
            eventKey: event.key,
          };
          const ruleErrors = await validateWithRules(metaValue, metaConfig.checks, ctx);
          for (const ruleError of ruleErrors) {
            errors.push({
              event: event.relativePath,
              path: metaPath,
              message: ruleError.error || "Validation failed",
              severity: "error",
            });
          }
        }
      }
    }
  }

  for (const [targetName, targetPayload] of Object.entries(resolvedPayload.targets)) {
    for (const [versionKey, versionPayload] of Object.entries(targetPayload.versions)) {
      const schema = versionPayload.schema;

      const isUnversioned = versionKey === UNVERSIONED_VERSION_KEY;
      const schemaPrefix = isUnversioned
        ? `payload.${targetName}.schema`
        : `payload.${targetName}.${versionKey}.schema`;

      // Required fields from opentp.yaml payload schema
      for (const [fieldName, specField] of Object.entries(payloadSchema)) {
        if (!specField.required) continue;
        const fieldPath = `${schemaPrefix}.${fieldName}`;
        const targetWidePath = `payload.${targetName}.schema.${fieldName}`;
        const implicitSchemaPath = `payload.schema.${fieldName}`;
        if (
          ignore.has(fieldPath) ||
          ignore.has(targetWidePath) ||
          ignore.has(implicitSchemaPath) ||
          ignore.has(`payload::${fieldName}`)
        ) {
          continue;
        }
        if (schema[fieldName] === undefined) {
          errors.push({
            event: event.relativePath,
            path: fieldPath,
            message: `Required payload field '${fieldName}' is missing`,
            severity: "error",
          });
        }
      }

      // Validate fields present in schema
      for (const [fieldName, fieldValue] of Object.entries(schema)) {
        const fieldPath = `${schemaPrefix}.${fieldName}`;
        const targetWidePath = `payload.${targetName}.schema.${fieldName}`;
        const implicitSchemaPath = `payload.schema.${fieldName}`;
        if (
          ignore.has(fieldPath) ||
          ignore.has(targetWidePath) ||
          ignore.has(implicitSchemaPath) ||
          ignore.has(`payload::${fieldName}`)
        ) {
          continue;
        }

        const specFieldConfig = payloadSchema[fieldName];

        // Exclusivity (event field itself) + compat with spec enum constraints
        const specDef: FieldDefinition | undefined = specFieldConfig
          ? { enum: specFieldConfig.enum as unknown[], dict: specFieldConfig.dict }
          : undefined;
        const eventDef: FieldDefinition = {
          enum: fieldValue.enum as unknown[],
          dict: fieldValue.dict,
          value: fieldValue.value,
        };
        const exclusivityError = validateFieldExclusivity(eventDef, specDef);
        if (exclusivityError) {
          errors.push({
            event: event.relativePath,
            path: fieldPath,
            message: exclusivityError.error || "Field exclusivity violation",
            severity: "error",
          });
        }

        // Type check for fixed values
        let fixedValueTypeOk = true;
        if (fieldValue.value !== undefined) {
          const valueType = typeof fieldValue.value;
          if (
            fieldValue.value === null ||
            (valueType !== "string" && valueType !== "number" && valueType !== "boolean")
          ) {
            fixedValueTypeOk = false;
            errors.push({
              event: event.relativePath,
              path: `${fieldPath}.value`,
              message: `Expected string | number | boolean value, got ${fieldValue.value === null ? "null" : valueType}`,
              severity: "error",
            });
          }

          if (fixedValueTypeOk) {
            const effectiveType = fieldValue.type ?? specFieldConfig?.type;
            if (effectiveType === "string" && typeof fieldValue.value !== "string") {
              errors.push({
                event: event.relativePath,
                path: `${fieldPath}.value`,
                message: `Expected string value, got ${typeof fieldValue.value}`,
                severity: "error",
              });
            }
            if (effectiveType === "number" && typeof fieldValue.value !== "number") {
              errors.push({
                event: event.relativePath,
                path: `${fieldPath}.value`,
                message: `Expected number value, got ${typeof fieldValue.value}`,
                severity: "error",
              });
            }
            if (effectiveType === "boolean" && typeof fieldValue.value !== "boolean") {
              errors.push({
                event: event.relativePath,
                path: `${fieldPath}.value`,
                message: `Expected boolean value, got ${typeof fieldValue.value}`,
                severity: "error",
              });
            }
          }
        }

        // Dict/enum constraints from spec schema applied to fixed values and enums
        if (specFieldConfig?.dict) {
          const allowedValues = getDictValues(specFieldConfig.dict, dictionaries);
          if (
            fixedValueTypeOk &&
            allowedValues &&
            fieldValue.value !== undefined &&
            !allowedValues.includes(fieldValue.value)
          ) {
            errors.push({
              event: event.relativePath,
              path: `${fieldPath}.value`,
              message: `Value '${fieldValue.value}' is not in dictionary '${specFieldConfig.dict}'`,
              severity: "error",
            });
          }
          if (allowedValues && fieldValue.enum) {
            const invalid = fieldValue.enum.filter((v) => !allowedValues.includes(v));
            if (invalid.length > 0) {
              errors.push({
                event: event.relativePath,
                path: `${fieldPath}.enum`,
                message: `Enum values [${invalid.join(", ")}] are not in dictionary '${specFieldConfig.dict}'`,
                severity: "error",
              });
            }
          }
        }

        if (fixedValueTypeOk && specFieldConfig?.enum && fieldValue.value !== undefined) {
          if (!specFieldConfig.enum.includes(fieldValue.value)) {
            errors.push({
              event: event.relativePath,
              path: `${fieldPath}.value`,
              message: `Value '${fieldValue.value}' is not in allowed enum`,
              severity: "error",
            });
          }
        }

        // Checks validation for fixed values
        const mergedChecks =
          specFieldConfig?.checks || fieldValue.checks
            ? { ...(specFieldConfig?.checks ?? {}), ...(fieldValue.checks ?? {}) }
            : undefined;

        if (fixedValueTypeOk && mergedChecks && fieldValue.value !== undefined) {
          const ctx: RuleContext = {
            fieldName,
            fieldPath: fieldPath,
            eventKey: event.key,
            specField: specDef,
          };
          const ruleErrors = await validateWithRules(fieldValue.value, mergedChecks, ctx);
          for (const ruleError of ruleErrors) {
            errors.push({
              event: event.relativePath,
              path: `${fieldPath}.value`,
              message: ruleError.error || "Validation failed",
              severity: "error",
            });
          }
        }

        // PII validation (metadata only)
        if (fieldValue.pii && typeof fieldValue.pii === "object" && fieldValue.pii !== null) {
          await validatePii(fieldName, fieldPath, fieldValue.pii as Record<string, unknown>);
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
