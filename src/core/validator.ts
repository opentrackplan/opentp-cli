import {
  type FieldDefinition,
  loadExternalRules,
  type RuleContext,
  validateFieldExclusivity,
  validateWithRules,
} from "../rules";
import type { Field, OpenTPConfig, ResolvedEvent, TaxonomyField, ValidationError } from "../types";
import { parsePattern, patternToRegex } from "../util";
import { getDictValues } from "./dict";
import { mergeSchemaMaps, resolveEventPayload, UNVERSIONED_VERSION_KEY } from "./payload";

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

  // 0. Unique event keys across the tracking plan
  const seenKeys = new Map<string, string>();
  for (const event of events) {
    const prev = seenKeys.get(event.key);
    if (prev) {
      errors.push({
        event: event.relativePath,
        path: "event.key",
        message: `Duplicate event key '${event.key}' (already used in '${prev}')`,
        severity: "error",
      });
    } else {
      seenKeys.set(event.key, event.relativePath);
    }
  }

  // 1. Target base schema conflicts against global base schema
  const globalBaseSchema = config.spec.events.payload.schema;

  // Spec-level validation: valueRequired implies required=true
  for (const [fieldName, field] of Object.entries(globalBaseSchema)) {
    if (field.valueRequired === true && field.required === false) {
      errors.push({
        event: "opentp.yaml",
        path: `spec.events.payload.schema.${fieldName}`,
        message:
          "Invalid field: valueRequired=true implies required=true (required=false is not allowed)",
        severity: "error",
      });
    }
  }

  for (const [targetId, targetConfig] of Object.entries(config.spec.targets ?? {})) {
    const targetSchema = targetConfig.schema;
    if (!targetSchema) continue;

    for (const [fieldName, targetField] of Object.entries(targetSchema)) {
      const baseField = globalBaseSchema[fieldName];

      if (targetField.valueRequired === true && targetField.required === false) {
        errors.push({
          event: "opentp.yaml",
          path: `spec.targets.${targetId}.schema.${fieldName}`,
          message:
            "Invalid field: valueRequired=true implies required=true (required=false is not allowed)",
          severity: "error",
        });
      }

      if (!baseField) continue;

      if (baseField.type && targetField.type && baseField.type !== targetField.type) {
        errors.push({
          event: "opentp.yaml",
          path: `spec.targets.${targetId}.schema.${fieldName}`,
          message: `Field type conflict: base '${baseField.type}' vs target '${targetField.type}'`,
          severity: "error",
        });
      }

      if (baseField.required === true && targetField.required === false) {
        errors.push({
          event: "opentp.yaml",
          path: `spec.targets.${targetId}.schema.${fieldName}`,
          message:
            "Cannot weaken required field in target schema (base required=true, target required=false)",
          severity: "error",
        });
      }

      if (baseField.valueRequired === true && targetField.valueRequired === false) {
        errors.push({
          event: "opentp.yaml",
          path: `spec.targets.${targetId}.schema.${fieldName}`,
          message:
            "Cannot weaken valueRequired field in target schema (base valueRequired=true, target valueRequired=false)",
          severity: "error",
        });
      }

      if (baseField.valueRequired === true && targetField.required === false) {
        errors.push({
          event: "opentp.yaml",
          path: `spec.targets.${targetId}.schema.${fieldName}`,
          message:
            "Cannot set required=false when base valueRequired=true (valueRequired implies required=true)",
          severity: "error",
        });
      }
    }
  }

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
    const key = event.key;
    const constraints = config.spec.events.key;

    if (typeof constraints?.minLength === "number" && key.length < constraints.minLength) {
      errors.push({
        event: event.relativePath,
        path: "event.key",
        message: `Key length must be >= ${constraints.minLength}`,
        severity: "error",
      });
    }

    if (typeof constraints?.maxLength === "number" && key.length > constraints.maxLength) {
      errors.push({
        event: event.relativePath,
        path: "event.key",
        message: `Key length must be <= ${constraints.maxLength}`,
        severity: "error",
      });
    }

    if (typeof constraints?.pattern === "string") {
      try {
        const re = new RegExp(constraints.pattern, "u");
        if (!re.test(key)) {
          errors.push({
            event: event.relativePath,
            path: "event.key",
            message: `Key does not match pattern ${JSON.stringify(constraints.pattern)}`,
            severity: "error",
          });
        }
      } catch (e) {
        errors.push({
          event: "opentp.yaml",
          path: "spec.events.key.pattern",
          message: `Invalid regex in spec.events.key.pattern: ${String(e)}`,
          severity: "error",
        });
      }
    }

    // Optional tooling-defined keygen: enforce generated key equality when configured
    if (config.spec.events["x-opentp"]?.keygen) {
      if (typeof event.expectedKey !== "string") {
        errors.push({
          event: event.relativePath,
          path: "event.key",
          message:
            "spec.events.x-opentp.keygen is configured but the expected key could not be generated",
          severity: "error",
        });
      } else if (event.key !== event.expectedKey) {
        errors.push({
          event: event.relativePath,
          path: "event.key",
          message: `Key mismatch: got '${event.key}', expected '${event.expectedKey}'`,
          severity: "error",
        });
      }
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
  const payloadErrors = await validatePayload(event, config, dictionaries, ignore);
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
    return (
      value === undefined || value === null || (typeof value === "string" && value.trim() === "")
    );
  }

  function parseTypedValue(raw: string, type: TaxonomyField["type"]): string | number | boolean {
    if (type === "string") return raw;

    if (type === "integer") {
      const num = Number(raw);
      if (!Number.isFinite(num) || !Number.isInteger(num)) return raw;
      return num;
    }

    if (type === "number") {
      const num = Number(raw);
      return Number.isFinite(num) ? num : raw;
    }

    const normalized = raw.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    return raw;
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

    if (expectedType === "integer") {
      if (typeof value !== "number") {
        return { ok: false, message: `Expected integer, got ${typeof value}` };
      }
      if (!Number.isFinite(value) || !Number.isInteger(value)) {
        return { ok: false, message: "Expected integer" };
      }
      return { ok: true };
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

  function validateStringConstraints(
    value: string,
    fieldConfig: TaxonomyField,
    checkPath: string,
  ): void {
    if (typeof fieldConfig.minLength === "number" && value.length < fieldConfig.minLength) {
      errors.push({
        event: event.relativePath,
        path: checkPath,
        message: `Expected length >= ${fieldConfig.minLength}`,
        severity: "error",
      });
    }
    if (typeof fieldConfig.maxLength === "number" && value.length > fieldConfig.maxLength) {
      errors.push({
        event: event.relativePath,
        path: checkPath,
        message: `Expected length <= ${fieldConfig.maxLength}`,
        severity: "error",
      });
    }
    if (typeof fieldConfig.pattern === "string") {
      try {
        const re = new RegExp(fieldConfig.pattern, "u");
        if (!re.test(value)) {
          errors.push({
            event: event.relativePath,
            path: checkPath,
            message: `Value does not match pattern ${JSON.stringify(fieldConfig.pattern)}`,
            severity: "error",
          });
        }
      } catch (e) {
        const taxonomyKey = checkPath.startsWith("taxonomy.")
          ? checkPath.slice("taxonomy.".length)
          : checkPath;
        errors.push({
          event: "opentp.yaml",
          path: `spec.events.taxonomy.${taxonomyKey}.pattern`,
          message: `Invalid regex in taxonomy field pattern: ${String(e)}`,
          severity: "error",
        });
      }
    }
  }

  function validateNumberConstraints(
    value: number,
    fieldConfig: TaxonomyField,
    checkPath: string,
  ): void {
    if (typeof fieldConfig.minimum === "number" && value < fieldConfig.minimum) {
      errors.push({
        event: event.relativePath,
        path: checkPath,
        message: `Expected >= ${fieldConfig.minimum}`,
        severity: "error",
      });
    }
    if (typeof fieldConfig.maximum === "number" && value > fieldConfig.maximum) {
      errors.push({
        event: event.relativePath,
        path: checkPath,
        message: `Expected <= ${fieldConfig.maximum}`,
        severity: "error",
      });
    }
    if (typeof fieldConfig.exclusiveMinimum === "number" && value <= fieldConfig.exclusiveMinimum) {
      errors.push({
        event: event.relativePath,
        path: checkPath,
        message: `Expected > ${fieldConfig.exclusiveMinimum}`,
        severity: "error",
      });
    }
    if (typeof fieldConfig.exclusiveMaximum === "number" && value >= fieldConfig.exclusiveMaximum) {
      errors.push({
        event: event.relativePath,
        path: checkPath,
        message: `Expected < ${fieldConfig.exclusiveMaximum}`,
        severity: "error",
      });
    }
    if (typeof fieldConfig.multipleOf === "number" && Number.isFinite(fieldConfig.multipleOf)) {
      const m = fieldConfig.multipleOf;
      if (m > 0) {
        const q = value / m;
        const rounded = Math.round(q);
        if (!Number.isFinite(q) || Math.abs(q - rounded) > 1e-12) {
          errors.push({
            event: event.relativePath,
            path: checkPath,
            message: `Expected multipleOf ${m}`,
            severity: "error",
          });
        }
      }
    }
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

    // JSON-Schema-like constraints
    if (fieldConfig.type === "string" && typeof typedValue === "string") {
      validateStringConstraints(typedValue, fieldConfig, checkPath);
    } else if (
      (fieldConfig.type === "number" || fieldConfig.type === "integer") &&
      typeof typedValue === "number"
    ) {
      validateNumberConstraints(typedValue, fieldConfig, checkPath);
    }

    // Tooling-defined checks (x-opentp)
    const checks = fieldConfig["x-opentp"]?.checks;
    if (checks) {
      const ctx: RuleContext = {
        fieldName,
        fieldPath: checkPath,
        eventKey: event.key,
      };
      const ruleErrors = await validateWithRules(typedValue, checks, ctx);
      for (const ruleError of ruleErrors) {
        errors.push({
          event: event.relativePath,
          path: checkPath,
          message: ruleError.error || "Validation failed",
          severity: "error",
        });
      }
    }

    // Composite fragments check (template + fragments)
    if (fieldConfig.template && fieldConfig.fragments && typeof typedValue === "string") {
      const parts = parsePattern(fieldConfig.template);
      for (const part of parts) {
        if (part.type === "variable" && part.transforms && part.transforms.length > 0) {
          errors.push({
            event: "opentp.yaml",
            path: `spec.events.taxonomy.${fieldName}.template`,
            message: "Transforms are not allowed in taxonomy composite templates",
            severity: "error",
          });
          break;
        }
      }

      const re = patternToRegex(fieldConfig.template);
      const match = typedValue.match(re);
      if (!match?.groups) {
        errors.push({
          event: event.relativePath,
          path: checkPath,
          message: `Value does not match template ${JSON.stringify(fieldConfig.template)}`,
          severity: "error",
        });
        continue;
      }

      for (const [fragName, fragConfig] of Object.entries(fieldConfig.fragments)) {
        const fragCheckPath = `taxonomy.${fragName}`;
        if (ignore.has(fragCheckPath)) continue;

        const rawFrag = match.groups[fragName];

        if (fragConfig.required && isEmpty(rawFrag)) {
          errors.push({
            event: event.relativePath,
            path: fragCheckPath,
            message: `Required fragment '${fragName}' is missing`,
            severity: "error",
          });
          continue;
        }

        if (rawFrag === undefined) continue;

        const fragValue = parseTypedValue(rawFrag, fragConfig.type);

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

        if (fragConfig.enum && !fragConfig.enum.includes(typedFragValue)) {
          errors.push({
            event: event.relativePath,
            path: fragCheckPath,
            message: `Value '${typedFragValue}' is not in allowed values for '${fragName}'`,
            severity: "error",
          });
        }

        if (fragConfig.dict) {
          const allowedValues = getDictValues(fragConfig.dict, dictionaries);
          if (allowedValues && !allowedValues.includes(typedFragValue)) {
            errors.push({
              event: event.relativePath,
              path: fragCheckPath,
              message: `Value '${typedFragValue}' is not in dictionary '${fragConfig.dict}'`,
              severity: "error",
            });
          }
        }

        if (fragConfig.type === "string" && typeof typedFragValue === "string") {
          validateStringConstraints(typedFragValue, fragConfig, fragCheckPath);
        } else if (
          (fragConfig.type === "number" || fragConfig.type === "integer") &&
          typeof typedFragValue === "number"
        ) {
          validateNumberConstraints(typedFragValue, fragConfig, fragCheckPath);
        }

        const fragChecks = fragConfig["x-opentp"]?.checks;
        if (fragChecks) {
          const ctx: RuleContext = {
            fieldName: fragName,
            fieldPath: fragCheckPath,
            eventKey: event.key,
          };
          const ruleErrors = await validateWithRules(typedFragValue, fragChecks, ctx);
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

  const baseSchema = config.spec.events.payload.schema;
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

  function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
  }

  function isInteger(value: unknown): value is number {
    return isFiniteNumber(value) && Number.isInteger(value);
  }

  function validateStringConstraints(value: string, field: Field, path: string): void {
    if (typeof field.minLength === "number" && value.length < field.minLength) {
      errors.push({
        event: event.relativePath,
        path,
        message: `Expected length >= ${field.minLength}`,
        severity: "error",
      });
    }
    if (typeof field.maxLength === "number" && value.length > field.maxLength) {
      errors.push({
        event: event.relativePath,
        path,
        message: `Expected length <= ${field.maxLength}`,
        severity: "error",
      });
    }
    if (typeof field.pattern === "string") {
      try {
        const re = new RegExp(field.pattern, "u");
        if (!re.test(value)) {
          errors.push({
            event: event.relativePath,
            path,
            message: `Value does not match pattern ${JSON.stringify(field.pattern)}`,
            severity: "error",
          });
        }
      } catch (e) {
        errors.push({
          event: event.relativePath,
          path,
          message: `Invalid regex pattern ${JSON.stringify(field.pattern)}: ${String(e)}`,
          severity: "error",
        });
      }
    }
  }

  function validateNumberConstraints(
    value: number,
    field: Field,
    path: string,
    isInt: boolean,
  ): void {
    if (!Number.isFinite(value)) {
      errors.push({
        event: event.relativePath,
        path,
        message: "Expected finite number",
        severity: "error",
      });
      return;
    }

    if (isInt && !Number.isInteger(value)) {
      errors.push({
        event: event.relativePath,
        path,
        message: "Expected integer",
        severity: "error",
      });
    }

    if (typeof field.minimum === "number" && value < field.minimum) {
      errors.push({
        event: event.relativePath,
        path,
        message: `Expected >= ${field.minimum}`,
        severity: "error",
      });
    }
    if (typeof field.maximum === "number" && value > field.maximum) {
      errors.push({
        event: event.relativePath,
        path,
        message: `Expected <= ${field.maximum}`,
        severity: "error",
      });
    }
    if (typeof field.exclusiveMinimum === "number" && value <= field.exclusiveMinimum) {
      errors.push({
        event: event.relativePath,
        path,
        message: `Expected > ${field.exclusiveMinimum}`,
        severity: "error",
      });
    }
    if (typeof field.exclusiveMaximum === "number" && value >= field.exclusiveMaximum) {
      errors.push({
        event: event.relativePath,
        path,
        message: `Expected < ${field.exclusiveMaximum}`,
        severity: "error",
      });
    }

    if (typeof field.multipleOf === "number" && Number.isFinite(field.multipleOf)) {
      const m = field.multipleOf;
      if (m > 0) {
        const q = value / m;
        const rounded = Math.round(q);
        if (!Number.isFinite(q) || Math.abs(q - rounded) > 1e-12) {
          errors.push({
            event: event.relativePath,
            path,
            message: `Expected multipleOf ${m}`,
            severity: "error",
          });
        }
      }
    }
  }

  function validateArrayItems(value: unknown, itemSchema: Field["items"], path: string): void {
    if (!itemSchema) return;

    const type = itemSchema.type;

    if (type === "string") {
      if (typeof value !== "string") {
        errors.push({
          event: event.relativePath,
          path,
          message: `Expected string item, got ${typeof value}`,
          severity: "error",
        });
        return;
      }
      validateStringConstraints(value, itemSchema as unknown as Field, path);
    } else if (type === "number") {
      if (!isFiniteNumber(value)) {
        errors.push({
          event: event.relativePath,
          path,
          message: `Expected number item, got ${typeof value}`,
          severity: "error",
        });
        return;
      }
      validateNumberConstraints(value, itemSchema as unknown as Field, path, false);
    } else if (type === "integer") {
      if (!isInteger(value)) {
        errors.push({
          event: event.relativePath,
          path,
          message: `Expected integer item, got ${typeof value}`,
          severity: "error",
        });
        return;
      }
      validateNumberConstraints(value, itemSchema as unknown as Field, path, true);
    } else if (type === "boolean") {
      if (typeof value !== "boolean") {
        errors.push({
          event: event.relativePath,
          path,
          message: `Expected boolean item, got ${typeof value}`,
          severity: "error",
        });
        return;
      }
    }

    if (itemSchema.enum && !itemSchema.enum.includes(value as never)) {
      errors.push({
        event: event.relativePath,
        path,
        message: `Item value '${String(value)}' is not in allowed enum`,
        severity: "error",
      });
    }

    if (itemSchema.dict) {
      const allowed = getDictValues(itemSchema.dict, dictionaries);
      if (!allowed) {
        errors.push({
          event: event.relativePath,
          path,
          message: `Unknown dictionary '${itemSchema.dict}'`,
          severity: "error",
        });
      } else if (!allowed.includes(value as never)) {
        errors.push({
          event: event.relativePath,
          path,
          message: `Item value '${String(value)}' is not in dictionary '${itemSchema.dict}'`,
          severity: "error",
        });
      }
    }
  }

  function validateArrayConstraints(value: unknown[], field: Field, path: string): void {
    if (typeof field.minItems === "number" && value.length < field.minItems) {
      errors.push({
        event: event.relativePath,
        path,
        message: `Expected minItems ${field.minItems}`,
        severity: "error",
      });
    }
    if (typeof field.maxItems === "number" && value.length > field.maxItems) {
      errors.push({
        event: event.relativePath,
        path,
        message: `Expected maxItems ${field.maxItems}`,
        severity: "error",
      });
    }
    if (field.uniqueItems) {
      const seen = new Set<string>();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) {
          errors.push({
            event: event.relativePath,
            path,
            message: "Expected uniqueItems",
            severity: "error",
          });
          break;
        }
        seen.add(key);
      }
    }
  }

  function validateEffectiveValue(value: unknown, field: Field, valuePath: string): void {
    const type = field.type;

    if (Array.isArray(value)) {
      if (type && type !== "array") {
        errors.push({
          event: event.relativePath,
          path: valuePath,
          message: `Expected ${type} value, got array`,
          severity: "error",
        });
        return;
      }

      validateArrayConstraints(value, field, valuePath);

      for (let i = 0; i < value.length; i += 1) {
        const item = value[i];
        const itemPath = `${valuePath}[${i}]`;
        if (item === null) {
          errors.push({
            event: event.relativePath,
            path: itemPath,
            message: "Array items must be scalar (null is not allowed)",
            severity: "error",
          });
          continue;
        }
        if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") {
          errors.push({
            event: event.relativePath,
            path: itemPath,
            message: `Array items must be scalar, got ${typeof item}`,
            severity: "error",
          });
          continue;
        }
        if (typeof item === "number" && !Number.isFinite(item)) {
          errors.push({
            event: event.relativePath,
            path: itemPath,
            message: "Array items must be finite numbers",
            severity: "error",
          });
          continue;
        }
        validateArrayItems(item, field.items, itemPath);
      }

      return;
    }

    if (
      value === null ||
      (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
    ) {
      errors.push({
        event: event.relativePath,
        path: valuePath,
        message: `Expected scalar value, got ${value === null ? "null" : typeof value}`,
        severity: "error",
      });
      return;
    }

    if (type === "string") {
      if (typeof value !== "string") {
        errors.push({
          event: event.relativePath,
          path: valuePath,
          message: `Expected string value, got ${typeof value}`,
          severity: "error",
        });
        return;
      }
      validateStringConstraints(value, field, valuePath);
    } else if (type === "number") {
      if (!isFiniteNumber(value)) {
        errors.push({
          event: event.relativePath,
          path: valuePath,
          message: `Expected number value, got ${typeof value}`,
          severity: "error",
        });
        return;
      }
      validateNumberConstraints(value, field, valuePath, false);
    } else if (type === "integer") {
      if (!isInteger(value)) {
        errors.push({
          event: event.relativePath,
          path: valuePath,
          message: `Expected integer value, got ${typeof value}`,
          severity: "error",
        });
        return;
      }
      validateNumberConstraints(value, field, valuePath, true);
    } else if (type === "boolean") {
      if (typeof value !== "boolean") {
        errors.push({
          event: event.relativePath,
          path: valuePath,
          message: `Expected boolean value, got ${typeof value}`,
          severity: "error",
        });
        return;
      }
    } else if (type === "array") {
      errors.push({
        event: event.relativePath,
        path: valuePath,
        message: "Expected array value",
        severity: "error",
      });
    } else {
      // Untyped value: validate constraints opportunistically
      if (typeof value === "string") validateStringConstraints(value, field, valuePath);
      if (typeof value === "number") validateNumberConstraints(value, field, valuePath, false);
    }
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

    async function validateReservedString(
      value: unknown,
      configField: NonNullable<typeof piiConfig.kind>,
      valuePath: string,
      name: string,
    ): Promise<void> {
      if (value === undefined) return;
      if (typeof value !== "string") {
        errors.push({
          event: event.relativePath,
          path: valuePath,
          message: `${name} must be a string`,
          severity: "error",
        });
        return;
      }

      if (configField.enum && !configField.enum.includes(value)) {
        errors.push({
          event: event.relativePath,
          path: valuePath,
          message: `Value '${value}' is not in allowed ${name} enum`,
          severity: "error",
        });
      }

      if (configField.dict) {
        const allowed = getDictValues(configField.dict, dictionaries);
        if (!allowed) {
          errors.push({
            event: event.relativePath,
            path: valuePath,
            message: `Unknown dictionary '${configField.dict}'`,
            severity: "error",
          });
        } else if (!allowed.includes(value)) {
          errors.push({
            event: event.relativePath,
            path: valuePath,
            message: `Value '${value}' is not in dictionary '${configField.dict}'`,
            severity: "error",
          });
        }
      }

      validateStringConstraints(value, configField as unknown as Field, valuePath);

      const checks = configField["x-opentp"]?.checks;
      if (checks) {
        const ctx: RuleContext = {
          fieldName: `${fieldName}.${name}`,
          fieldPath: valuePath,
          eventKey: event.key,
        };
        const ruleErrors = await validateWithRules(value, checks, ctx);
        for (const ruleError of ruleErrors) {
          errors.push({
            event: event.relativePath,
            path: valuePath,
            message: ruleError.error || "Validation failed",
            severity: "error",
          });
        }
      }
    }

    if (piiConfig.kind) {
      await validateReservedString(kind, piiConfig.kind, `${schemaFieldPath}.pii.kind`, "pii.kind");
    }
    if (piiConfig.masker) {
      await validateReservedString(
        masker,
        piiConfig.masker,
        `${schemaFieldPath}.pii.masker`,
        "pii.masker",
      );
    }

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
          (metaConfig.type === "number" &&
            typeof metaValue === "number" &&
            Number.isFinite(metaValue)) ||
          (metaConfig.type === "integer" &&
            typeof metaValue === "number" &&
            Number.isInteger(metaValue)) ||
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
          if (!allowed) {
            errors.push({
              event: event.relativePath,
              path: metaPath,
              message: `Unknown dictionary '${metaConfig.dict}'`,
              severity: "error",
            });
          } else if (!allowed.includes(metaValue as never)) {
            errors.push({
              event: event.relativePath,
              path: metaPath,
              message: `Value '${String(metaValue)}' is not in dictionary '${metaConfig.dict}'`,
              severity: "error",
            });
          }
        }

        if (metaConfig.type === "string" && typeof metaValue === "string") {
          validateStringConstraints(metaValue, metaConfig as unknown as Field, metaPath);
        } else if (
          (metaConfig.type === "number" || metaConfig.type === "integer") &&
          typeof metaValue === "number"
        ) {
          validateNumberConstraints(
            metaValue,
            metaConfig as unknown as Field,
            metaPath,
            metaConfig.type === "integer",
          );
        }

        const metaChecks = metaConfig["x-opentp"]?.checks;
        if (metaChecks) {
          const ctx: RuleContext = {
            fieldName: `${fieldName}.pii.${metaName}`,
            fieldPath: metaPath,
            eventKey: event.key,
          };
          const ruleErrors = await validateWithRules(metaValue, metaChecks, ctx);
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

  for (const [targetId, targetPayload] of Object.entries(resolvedPayload.targets)) {
    const targetBase = config.spec.targets?.[targetId]?.schema ?? {};
    const baseForTarget = mergeSchemaMaps(baseSchema, targetBase);

    for (const [versionKey, versionPayload] of Object.entries(targetPayload.versions)) {
      const eventSchema = versionPayload.schema;

      const isUnversioned = versionKey === UNVERSIONED_VERSION_KEY;
      const schemaPrefix = isUnversioned
        ? `payload.${targetId}.schema`
        : `payload.${targetId}.${versionKey}.schema`;

      // Conflict checks against base layers (type/required)
      for (const [fieldName, fieldValue] of Object.entries(eventSchema)) {
        const baseField = baseForTarget[fieldName];
        if (!baseField) continue;

        if (baseField.type && fieldValue.type && baseField.type !== fieldValue.type) {
          errors.push({
            event: event.relativePath,
            path: `${schemaPrefix}.${fieldName}`,
            message: `Field type conflict: base '${baseField.type}' vs override '${fieldValue.type}'`,
            severity: "error",
          });
        }

        if (baseField.required === true && fieldValue.required === false) {
          errors.push({
            event: event.relativePath,
            path: `${schemaPrefix}.${fieldName}`,
            message: "Cannot weaken required field (base required=true, override required=false)",
            severity: "error",
          });
        }

        if (baseField.valueRequired === true && fieldValue.valueRequired === false) {
          errors.push({
            event: event.relativePath,
            path: `${schemaPrefix}.${fieldName}`,
            message:
              "Cannot weaken valueRequired field (base valueRequired=true, override valueRequired=false)",
            severity: "error",
          });
        }

        if (baseField.valueRequired === true && fieldValue.required === false) {
          errors.push({
            event: event.relativePath,
            path: `${schemaPrefix}.${fieldName}`,
            message:
              "Cannot set required=false when base valueRequired=true (valueRequired implies required=true)",
            severity: "error",
          });
        }

        if (fieldValue.valueRequired === true && fieldValue.required === false) {
          errors.push({
            event: event.relativePath,
            path: `${schemaPrefix}.${fieldName}`,
            message:
              "Invalid field: valueRequired=true implies required=true (required=false is not allowed)",
            severity: "error",
          });
        }
      }

      // Effective schema for this target+version
      const effectiveSchema = mergeSchemaMaps(baseForTarget, eventSchema);

      // Validate event-defined fields (exclusivity and allowed-values compatibility)
      for (const [fieldName, fieldValue] of Object.entries(eventSchema)) {
        const fieldPath = `${schemaPrefix}.${fieldName}`;
        const targetWidePath = `payload.${targetId}.schema.${fieldName}`;
        const implicitSchemaPath = `payload.schema.${fieldName}`;
        if (
          ignore.has(fieldPath) ||
          ignore.has(targetWidePath) ||
          ignore.has(implicitSchemaPath) ||
          ignore.has(`payload::${fieldName}`)
        ) {
          continue;
        }

        const specFieldConfig = baseForTarget[fieldName];

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

        // Dict/enum constraints from base schema applied to fixed values and enums
        if (specFieldConfig?.dict) {
          const allowedValues = getDictValues(specFieldConfig.dict, dictionaries);
          if (!allowedValues) {
            errors.push({
              event: event.relativePath,
              path: fieldPath,
              message: `Unknown dictionary '${specFieldConfig.dict}'`,
              severity: "error",
            });
          } else {
            if (
              fieldValue.value !== undefined &&
              !allowedValues.includes(fieldValue.value as never)
            ) {
              errors.push({
                event: event.relativePath,
                path: `${fieldPath}.value`,
                message: `Value '${String(fieldValue.value)}' is not in dictionary '${specFieldConfig.dict}'`,
                severity: "error",
              });
            }
            if (fieldValue.enum) {
              const invalid = fieldValue.enum.filter((v) => !allowedValues.includes(v as never));
              if (invalid.length > 0) {
                errors.push({
                  event: event.relativePath,
                  path: `${fieldPath}.enum`,
                  message: `Enum values [${invalid.map(String).join(", ")}] are not in dictionary '${specFieldConfig.dict}'`,
                  severity: "error",
                });
              }
            }
          }
        }
      }

      // Validate effective fields (fixed values, constraints, x-opentp checks, pii)
      for (const [fieldName, effectiveField] of Object.entries(effectiveSchema)) {
        const fieldPath = `${schemaPrefix}.${fieldName}`;
        const targetWidePath = `payload.${targetId}.schema.${fieldName}`;
        const implicitSchemaPath = `payload.schema.${fieldName}`;
        if (
          ignore.has(fieldPath) ||
          ignore.has(targetWidePath) ||
          ignore.has(implicitSchemaPath) ||
          ignore.has(`payload::${fieldName}`)
        ) {
          continue;
        }

        if (effectiveField.valueRequired === true) {
          if (effectiveField.required === false) {
            errors.push({
              event: event.relativePath,
              path: fieldPath,
              message:
                "Invalid field: valueRequired=true implies required=true (required=false is not allowed)",
              severity: "error",
            });
          }

          if (effectiveField.value === undefined) {
            errors.push({
              event: event.relativePath,
              path: `${fieldPath}.value`,
              message: "Missing required fixed value: valueRequired=true requires a fixed 'value'",
              severity: "error",
            });
          }
        }

        if (effectiveField.dict) {
          const allowed = getDictValues(effectiveField.dict, dictionaries);
          if (!allowed) {
            errors.push({
              event: event.relativePath,
              path: fieldPath,
              message: `Unknown dictionary '${effectiveField.dict}'`,
              severity: "error",
            });
          }
        }

        if (effectiveField.enum) {
          for (let i = 0; i < effectiveField.enum.length; i += 1) {
            const v = effectiveField.enum[i];
            validateEffectiveValue(v, effectiveField, `${fieldPath}.enum[${i}]`);
          }
        }

        if (effectiveField.value !== undefined) {
          validateEffectiveValue(effectiveField.value, effectiveField, `${fieldPath}.value`);
        }

        const checks = effectiveField["x-opentp"]?.checks;
        if (checks && effectiveField.value !== undefined) {
          const fixed = effectiveField.value;
          if (
            typeof fixed === "string" ||
            typeof fixed === "number" ||
            typeof fixed === "boolean"
          ) {
            const ctx: RuleContext = {
              fieldName,
              fieldPath: fieldPath,
              eventKey: event.key,
            };
            const ruleErrors = await validateWithRules(fixed, checks, ctx);
            for (const ruleError of ruleErrors) {
              errors.push({
                event: event.relativePath,
                path: `${fieldPath}.value`,
                message: ruleError.error || "Validation failed",
                severity: "error",
              });
            }
          }
        }

        if (
          effectiveField.pii &&
          typeof effectiveField.pii === "object" &&
          effectiveField.pii !== null
        ) {
          await validatePii(fieldName, fieldPath, effectiveField.pii as Record<string, unknown>);
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
