import type { FieldDefinition, RuleResult } from "./types";

/**
 * Validate enum/dict/value exclusivity
 * A field can have only one of: enum, dict, or value at the same level.
 * But if spec has enum/dict, event can override with value or a subset enum/dict.
 */
export function validateFieldExclusivity(
  field: FieldDefinition,
  specField?: FieldDefinition,
): RuleResult | null {
  const hasEnum = field.enum !== undefined && Array.isArray(field.enum);
  const hasDict = field.dict !== undefined;
  const hasValue = field.value !== undefined;

  const count = [hasEnum, hasDict, hasValue].filter(Boolean).length;

  // At the same level, only one is allowed
  if (count > 1) {
    return {
      valid: false,
      error: "Field can have only one of: enum, dict, or value",
      code: "EXCLUSIVE_FIELD_VIOLATION",
    };
  }

  // If spec has enum/dict, event can have value (as a fixed selection)
  // or a subset enum/dict
  if (specField) {
    const specHasEnum = specField.enum !== undefined && Array.isArray(specField.enum);
    const _specHasDict = specField.dict !== undefined;

    // Event has value, spec has enum - validate value is in enum
    if (hasValue && specHasEnum && specField.enum) {
      if (!specField.enum.includes(field.value)) {
        return {
          valid: false,
          error: `Value "${field.value}" is not in allowed enum: [${specField.enum.join(", ")}]`,
          code: "VALUE_NOT_IN_ENUM",
        };
      }
    }

    // Event has enum, spec has enum - validate subset
    if (hasEnum && specHasEnum && specField.enum && field.enum) {
      const invalidValues = field.enum.filter((v) => !specField.enum!.includes(v));
      if (invalidValues.length > 0) {
        return {
          valid: false,
          error: `Enum values [${invalidValues.join(", ")}] are not in spec enum: [${specField.enum.join(", ")}]`,
          code: "ENUM_NOT_SUBSET",
        };
      }
    }
  }

  return null;
}
