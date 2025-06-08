/**
 * Context provided to rules during validation
 */
export interface RuleContext {
  /** Field name being validated */
  fieldName: string;
  /** Full path to the field, e.g., "payload.schema.application_id" */
  fieldPath: string;
  /** Event key, e.g., "app::auth::login::click" */
  eventKey: string;
  /** Full field definition from spec (for checking against spec rules) */
  specField?: FieldDefinition;
}

/**
 * Result of rule validation
 */
export interface RuleResult {
  /** Whether validation passed */
  valid: boolean;
  /** Human-readable error message */
  error?: string;
  /** Machine-readable error code, e.g., "MAX_LENGTH_EXCEEDED" */
  code?: string;
}

/**
 * Definition of a validation rule
 */
export interface RuleDefinition {
  /** Rule name, e.g., "max-length" */
  name: string;
  /**
   * Validate a value against this rule
   * @param value - The value to validate
   * @param params - Rule parameters (can be any type: boolean, number, string, array, object)
   * @param context - Validation context
   * @returns Validation result (can be async for webhook rules)
   */
  validate: (
    value: unknown,
    params: unknown,
    context: RuleContext,
  ) => RuleResult | Promise<RuleResult>;
}

/**
 * Field definition in spec or event
 */
export interface FieldDefinition {
  title?: string;
  description?: string;
  type?: "string" | "number" | "boolean";
  enum?: unknown[];
  dict?: string;
  value?: unknown;
  required?: boolean;
  rules?: Record<string, unknown>;
}

/**
 * Factory function type for creating rule definitions
 */
export type RuleFactory = () => RuleDefinition;
