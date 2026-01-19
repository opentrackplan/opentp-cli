/**
 * Transform step definition
 *
 * @example
 * "lower"
 * { transliterate: { map: { "ä": "ae" } } }
 * { replace: { from: " ", to: "_" } }
 * { truncate: 160 }
 */
export type TransformStepConfig = string | Record<string, unknown>;

/**
 * Transform configuration from opentp.yaml
 */
export type TransformConfig = TransformStepConfig[];

/**
 * Transform function type
 */
export type TransformFn = (value: string) => string;

/**
 * Step factory - creates transform function from params
 */
export type StepFactory = (params?: unknown) => TransformFn;

/**
 * Step definition for registration
 */
export interface StepDefinition {
  name: string;
  factory: StepFactory;
}
