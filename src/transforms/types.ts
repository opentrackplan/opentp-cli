/**
 * Transform step definition
 *
 * Uniform format: every step has `step` name and optional `params`
 *
 * @example
 * { step: 'lower' }
 * { step: 'replace', params: { pattern: '\\s+', with: '_' } }
 */
export interface TransformStep {
  step: string;
  params?: Record<string, unknown>;
}

/**
 * Transform configuration from opentp.yaml
 */
export interface TransformConfig {
  steps: TransformStep[];
}

/**
 * Transform function type
 */
export type TransformFn = (value: string) => string;

/**
 * Step factory - creates transform function from params
 */
export type StepFactory = (params?: Record<string, unknown>) => TransformFn;

/**
 * Step definition for registration
 */
export interface StepDefinition {
  name: string;
  factory: StepFactory;
}
