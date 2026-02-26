import type { ResolvedField } from "./types";

/**
 * Language-specific type mapping interface.
 * Each language provides a simple lookup table via this interface.
 */
export interface TypeMapper {
  /** Map a base type string (e.g. "string", "integer") to the language type */
  baseType(type: string): string;
  /** Render a single enum literal value */
  enumLiteral(value: string | number | boolean): string;
  /** Render a union of enum values as a type */
  enumUnion(values: (string | number | boolean)[]): string;
  /** Wrap an inner type as an array type */
  arrayOf(innerType: string): string;
  /** Wrap a type as optional */
  optional(type: string): string;
}

/**
 * Resolve a ResolvedField into a language-specific type string.
 *
 * Contains the structural logic (enum detection, array wrapping, boolean collapse)
 * shared across all language generators. Each language just provides a TypeMapper.
 */
export function resolveFieldType(field: ResolvedField, mapper: TypeMapper): string {
  // Array with enum items
  if (field.isArray && field.arrayItemEnum && field.arrayItemEnum.length > 0) {
    const allBooleans = field.arrayItemEnum.every((v) => typeof v === "boolean");
    if (allBooleans && field.arrayItemEnum.includes(true) && field.arrayItemEnum.includes(false)) {
      return mapper.arrayOf(mapper.baseType("boolean"));
    }
    return mapper.arrayOf(mapper.enumUnion(field.arrayItemEnum));
  }

  // Array with plain item type
  if (field.isArray && field.arrayItemType) {
    return mapper.arrayOf(mapper.baseType(field.arrayItemType));
  }

  // Array with no items info
  if (field.isArray) {
    return mapper.arrayOf(mapper.baseType("unknown"));
  }

  // Non-array with enum values
  if (field.enumValues && field.enumValues.length > 0) {
    const allBooleans = field.enumValues.every((v) => typeof v === "boolean");
    if (allBooleans && field.enumValues.includes(true) && field.enumValues.includes(false)) {
      return mapper.baseType("boolean");
    }
    return mapper.enumUnion(field.enumValues);
  }

  // Scalar base type
  return mapper.baseType(field.baseType);
}
