// Types for OpenTrackPlan CLI

// === Spec Version ===
// OpenTP spec version (format: YYYY-MM)
export type Version = string;

export type StringFormat = "date" | "date-time" | "email" | "uuid" | "uri" | "ipv4" | "ipv6";

// === Dictionary ===
export interface Dict {
  opentp?: Version;
  dict: {
    type: "string" | "number" | "integer" | "boolean";
    values: Array<string | number | boolean>;
  };
}

// === x-opentp Extensions ===
export interface XOpentpFieldExtensions {
  /** Field role hint for tooling (does not affect schema validation). */
  role?: "constant" | "attribute" | "shared";
  /** Tooling-defined validation checks (non-portable). */
  checks?: Record<string, unknown>;
}

export type ScalarType = "string" | "number" | "integer" | "boolean";

export interface ArrayItems {
  type: ScalarType;
  enum?: Array<string | number | boolean>;
  dict?: string;

  // String constraints
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: StringFormat;

  // Number constraints
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
}

// === Field ===
export interface Field {
  // Metadata
  title?: string;
  description?: string;
  pii?: Record<string, unknown> & {
    /** Reserved: PII kind identifier (tool-defined values) */
    kind?: string;
    /** Reserved: masker implementation id (tool-defined values; built-in: 'star') */
    masker?: string;
  };

  // Schema (for generators)
  type?: ScalarType | "array";
  enum?: Array<string | number | boolean>; // inline values
  dict?: string; // reference to dictionary file
  required?: boolean;
  valueRequired?: boolean;
  value?: string | number | boolean | Array<string | number | boolean>; // fixed value

  // String constraints
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: StringFormat;

  // Number constraints
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;

  // Array constraints (arrays of scalar items only)
  items?: ArrayItems;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;

  // Tooling extensions
  "x-opentp"?: XOpentpFieldExtensions;
}

// === Taxonomy Field (in opentp.yaml) ===
export interface TaxonomyField {
  title: string;
  description?: string;
  type: ScalarType;
  required?: boolean;

  // Composite fields
  template?: string;
  fragments?: Record<string, TaxonomyField>;

  // Inline values
  enum?: Array<string | number | boolean>; // inline values
  dict?: string; // reference to dictionary file

  // String constraints
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: StringFormat;

  // Number constraints
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;

  // Tooling extensions
  "x-opentp"?: XOpentpFieldExtensions;
}

// === Paths Config ===
export interface EventsPathConfig {
  root: string;
  template: string;
}

export interface DictionariesPathConfig {
  root: string;
}

// === Transforms (x-opentp keygen) ===
export type TransformStepConfig = string | Record<string, unknown>;
export type TransformPipelineConfig = TransformStepConfig[];

// === PII (opentp.yaml) ===
export interface PiiReservedFieldConfig {
  title?: string;
  description?: string;
  required?: boolean;
  enum?: string[];
  dict?: string;

  // String constraints
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: StringFormat;

  "x-opentp"?: XOpentpFieldExtensions;
}

export interface PiiMetaFieldConfig {
  title?: string;
  description?: string;
  type: ScalarType;
  required?: boolean;
  enum?: Array<string | number | boolean>;
  dict?: string;

  // String constraints
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: StringFormat;

  // Number constraints
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;

  "x-opentp"?: XOpentpFieldExtensions;
}

export interface PiiConfig {
  kind?: PiiReservedFieldConfig;
  masker?: PiiReservedFieldConfig;
  schema?: Record<string, PiiMetaFieldConfig>;
}

// === Event Key Constraints (opentp.yaml) ===
export interface EventKeyConstraints {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: StringFormat;
}

export interface XOpentpKeygenConfig {
  template: string;
  transforms?: Record<string, TransformPipelineConfig>;
}

export interface XOpentpEventsExtensions {
  keygen?: XOpentpKeygenConfig;
}

export interface TargetConfig {
  title?: string;
  description?: string;
  schema?: Record<string, Field>;
}

// === OpenTP Config (opentp.yaml) ===
export interface OpenTPConfig {
  opentp: Version;
  info: {
    title: string;
    description?: string;
    version: string;
    contact?: string[];
  };
  spec: {
    paths: {
      events: EventsPathConfig;
      dictionaries?: DictionariesPathConfig;
    };
    targets?: Record<string, TargetConfig>;
    events: {
      key?: EventKeyConstraints;
      "x-opentp"?: XOpentpEventsExtensions;
      taxonomy: Record<string, TaxonomyField>;
      payload: {
        targets: Record<string, string[]>;
        schema: Record<string, Field>;
      };
      pii?: PiiConfig;
    };
  };
}

// === Event Lifecycle ===
export interface EventLifecycle {
  status?: "active" | "deprecated" | "draft";
  deprecatedAt?: string;
  deprecatedReason?: string;
  replacedBy?: string;
}

// === Event Alias ===
export interface EventAlias {
  key: string;
  deprecated?: {
    reason?: string;
    date?: string;
  };
}

// === Ignore Check ===
export interface IgnoreCheck {
  path: string;
  reason: string;
}

// === Payload Version ===
export interface PayloadVersion {
  $ref?: string;
  meta?: PayloadMeta;
  schema: Record<string, Field>;
}

export interface PayloadMeta {
  changes?: string | string[];
  deprecated?: {
    reason: string;
    date?: string;
  };
}

export type VersionedTargetPayload = {
  current: string;
  [key: string]: PayloadVersion | string;
};

export type TargetPayload = PayloadVersion | VersionedTargetPayload;

export type EventPayload = TargetPayload | Record<string, TargetPayload>;

export interface ResolvedPayloadVersion {
  key: string;
  $ref?: string;
  meta?: PayloadMeta;
  schema: Record<string, Field>;
}

export interface ResolvedTargetPayload {
  target: string;
  current: string;
  aliases: Record<string, string>;
  versions: Record<string, ResolvedPayloadVersion>;
}

export interface ResolvedEventPayload {
  targets: Record<string, ResolvedTargetPayload>;
}

// === Event (from event.yaml) ===
export interface EventFile {
  opentp?: Version;
  event: {
    key: string;
    lifecycle?: EventLifecycle;
    taxonomy: Record<string, unknown>;
    aliases?: EventAlias[];
    ignore?: IgnoreCheck[];
    payload: EventPayload;
  };
}

// === Resolved Event (after parsing) ===
export interface ResolvedEvent {
  filePath: string;
  relativePath: string;
  opentp?: Version;
  key: string;
  expectedKey: string | null;
  taxonomy: Record<string, unknown>;
  lifecycle?: EventLifecycle;
  aliases?: EventAlias[];
  ignore: IgnoreCheck[];
  payload: EventPayload;
}

// === Validation Error ===
export interface ValidationError {
  event: string;
  path: string;
  message: string;
  severity: "error" | "warning";
}

// === Resolved Config (after $ref resolution) ===
export interface ResolvedConfig extends OpenTPConfig {
  resolvedDicts: Map<string, (string | number | boolean)[]>;
}
