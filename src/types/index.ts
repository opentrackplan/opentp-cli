// Types for OpenTrackPlan CLI

// === Version ===
export type Version = string; // X.Y.Z

// === Dictionary ===
export interface Dict {
  opentp: Version;
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
  // Schema (for generators)
  type?: "string" | "number" | "boolean";
  enum?: (string | number | boolean)[]; // inline values
  dict?: string; // reference to dictionary file
  required?: boolean;
  value?: string | number | boolean; // fixed value
  // Validation rules
  rules?: Record<string, unknown>;
}

// === Taxonomy Field (in opentp.yaml) ===
export interface TaxonomyField {
  title: string;
  description?: string;
  type: "string" | "number" | "boolean";
  required?: boolean;
  pattern?: string;
  enum?: string[]; // inline values
  dict?: string; // reference to dictionary file
  rules?: Record<string, unknown>;
  fragments?: Record<string, TaxonomyField>;
}

// === Path Config ===
export interface PathConfig {
  root: string;
  pattern: string;
}

// === Transform Step ===
// Uniform format: { step: 'name', params?: {...} }
export interface TransformStep {
  step: string;
  params?: Record<string, unknown>;
}

// === Transform ===
export interface Transform {
  steps: TransformStep[];
}

// === Validator (webhook) ===
export interface Validator {
  url?: string;
  timeout?: string;
}

// === External Resources ===
export interface ExternalConfig {
  rules?: string[]; // paths to directories with custom rules
  transforms?: string[]; // paths to directories with custom transforms
  generators?: string[]; // paths to directories with custom generators
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
    events: {
      key: {
        pattern: string;
      };
      paths: Record<string, PathConfig>;
      taxonomy: Record<string, TaxonomyField>;
      payload: {
        platforms: Record<string, string[]>;
        schema: Record<string, Field>;
      };
    };
    transforms?: Record<string, Transform>;
    validators?: Record<string, Validator>;
    generators?: object[];
    extensions?: Record<string, unknown>;
    external?: ExternalConfig;
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
  changes?: string[];
  schema: Record<string, Field>;
}

// === Platform Payload ===
export interface PlatformPayload {
  active: Version;
  history: Record<string, PayloadVersion>;
}

// === Event (from event.yaml) ===
export interface EventFile {
  opentp: Version;
  event: {
    key: string;
    lifecycle?: EventLifecycle;
    taxonomy: Record<string, unknown>;
    aliases?: EventAlias[];
    ignoreChecks?: IgnoreCheck[];
    payload: {
      platforms: Record<string, PlatformPayload>;
    };
  };
}

// === Resolved Event (after parsing) ===
export interface ResolvedEvent {
  filePath: string;
  relativePath: string;
  key: string;
  expectedKey: string;
  taxonomy: Record<string, string>;
  lifecycle?: EventLifecycle;
  aliases?: EventAlias[];
  ignoreChecks: IgnoreCheck[];
  payload: {
    platforms: Record<string, PlatformPayload>;
  };
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
