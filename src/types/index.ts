// Types for OpenTrackPlan CLI

// === Spec Version ===
// OpenTP spec version (format: YYYY-MM)
export type Version = string;

// === Dictionary ===
export interface Dict {
  opentp?: Version;
  dict: {
    type: "string" | "number" | "boolean";
    values: (string | number | boolean)[];
  };
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
  type?: "string" | "number" | "boolean";
  enum?: (string | number | boolean)[]; // inline values
  dict?: string; // reference to dictionary file
  required?: boolean;
  value?: string | number | boolean; // fixed value
  // Validation checks
  checks?: Record<string, unknown>;
}

// === Taxonomy Field (in opentp.yaml) ===
export interface TaxonomyField {
  title: string;
  description?: string;
  type: "string" | "number" | "boolean";
  required?: boolean;
  pattern?: string;
  enum?: (string | number | boolean)[]; // inline values
  dict?: string; // reference to dictionary file
  checks?: Record<string, unknown>;
  fragments?: Record<string, TaxonomyField>;
}

// === Paths Config ===
export interface EventsPathConfig {
  root: string;
  pattern: string;
}

export interface DictionariesPathConfig {
  root: string;
}

// === Transforms (opentp.yaml) ===
export type TransformStepConfig = string | Record<string, unknown>;
export type TransformPipelineConfig = TransformStepConfig[];

// === PII (opentp.yaml) ===
export interface PiiReservedFieldConfig {
  title?: string;
  description?: string;
  required?: boolean;
  enum?: string[];
  dict?: string;
  checks?: Record<string, unknown>;
}

export interface PiiMetaFieldConfig {
  title?: string;
  description?: string;
  type: "string" | "number" | "boolean";
  required?: boolean;
  enum?: (string | number | boolean)[];
  dict?: string;
  checks?: Record<string, unknown>;
}

export interface PiiConfig {
  kind?: PiiReservedFieldConfig;
  masker?: PiiReservedFieldConfig;
  schema?: Record<string, PiiMetaFieldConfig>;
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
    events: {
      key: {
        pattern: string;
      };
      taxonomy: Record<string, TaxonomyField>;
      payload: {
        targets: Record<string, string[]>;
        schema: Record<string, Field>;
      };
      pii?: PiiConfig;
    };
    transforms?: Record<string, TransformPipelineConfig>;
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
  expectedKey: string;
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
