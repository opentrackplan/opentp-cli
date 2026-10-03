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

// === Extensions and checks ===
/**
 * Open `x-*` extension keys (2026-09). Tools ignore them, except `x-opentp`: it was removed in
 * 2026-09 and is reported wherever it appears.
 */
export type Extensions = { [key: `x-${string}`]: unknown };

/**
 * A `checks` map: check id -> params. Ids name a portable check from `spec.checks` (params true or
 * false), a built-in or plugin rule, or a binding in opentp.cli.yaml. Params `false` disable a check.
 */
export type ChecksMap = Record<string, unknown>;

/** Field policy (catalog and common fields only) */
export type FieldPolicy = "specified" | "restricted" | "fixed";

export type ScalarType = "string" | "number" | "integer" | "boolean";
export type ScalarValue = string | number | boolean;
export type FieldValue = ScalarValue | ScalarValue[];

export interface ArrayItems extends Extensions {
  type?: ScalarType;
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

  checks?: ChecksMap;
}

// === Field ===
export interface Field extends Extensions {
  // Metadata
  name?: string;
  title?: string;
  description?: string;
  example?: FieldValue;
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
  /** Catalog and common fields only (opentp.yaml) */
  policy?: FieldPolicy;
  value?: FieldValue; // fixed value

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

  checks?: ChecksMap;
}

// === Taxonomy Field (in opentp.yaml) ===
export interface TaxonomyField extends Extensions {
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

  checks?: ChecksMap;
}

// === Paths Config ===
export interface EventsPathConfig {
  root: string;
  template: string;
}

export interface DictionariesPathConfig {
  root: string;
}

// === Transforms (keygen in opentp.cli.yaml) ===
export type TransformStepConfig = string | Record<string, unknown>;
export type TransformPipelineConfig = TransformStepConfig[];

// === PII (opentp.yaml) ===
export interface PiiReservedFieldConfig extends Extensions {
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

  checks?: ChecksMap;
}

export interface PiiMetaFieldConfig extends Extensions {
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

  checks?: ChecksMap;
}

export interface PiiConfig extends Extensions {
  kind?: PiiReservedFieldConfig;
  masker?: PiiReservedFieldConfig;
  schema?: Record<string, PiiMetaFieldConfig>;
}

// === Event Key Constraints (opentp.yaml) ===
export interface EventKeyConstraints extends Extensions {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: StringFormat;
}

/**
 * Key generation (tool setting): `keygen` in opentp.cli.yaml. Until 2026-01 it was
 * `spec.events.x-opentp.keygen` in opentp.yaml.
 */
export interface KeygenConfig {
  template: string;
  transforms?: Record<string, TransformPipelineConfig>;
  /** Directories with custom transform steps (loaded only with --allow-plugins) */
  plugins?: string[];
}

/** `spec.targets.<id>` (`all` applies to every target) */
export interface TargetConfig extends Extensions {
  title?: string;
  description?: string;
  schema?: Record<string, Field>;
}

/** `spec.checks.<id>`: a named check that every tool can apply (at least one keyword) */
export interface PortableCheck extends Extensions {
  title?: string;
  description?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: StringFormat;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
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
    /** Keys: `all` or target ids from spec.events.payload.targets.all */
    targets?: Record<string, TargetConfig>;
    checks?: Record<string, PortableCheck>;
    events: {
      key?: EventKeyConstraints;
      taxonomy: Record<string, TaxonomyField>;
      payload: {
        targets: Record<string, string[]>;
        /** Optional since 2026-09 (default: no fields) */
        schema?: Record<string, Field>;
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
  /** Optional since 2026-09, but recommended */
  reason?: string;
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
  /** The schema after `$ref` (the event layer) */
  schema: Record<string, Field>;
  /** The fields this version writes itself (before `$ref`): where an `example` is checked */
  ownSchema?: Record<string, Field>;
  /**
   * Where the version's schema is written in the event file, with the selector as written:
   * `payload.schema`, `payload.<version>.schema`, `payload.<selector>[.<version>].schema`
   */
  writtenPath?: string;
}

export interface ResolvedTargetPayload {
  target: string;
  current: string;
  aliases: Record<string, string>;
  versions: Record<string, ResolvedPayloadVersion>;
  /** The keys of `versions` in file order (object key order puts integer-like keys first) */
  versionOrder: string[];
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
  /** Key generated by keygen (opentp.cli.yaml); null when keygen is not configured or failed */
  expectedKey: string | null;
  /** Why keygen failed for this event (e.g. a missing variable); reported as an event.key error */
  keygenError?: string;
  taxonomy: Record<string, unknown>;
  lifecycle?: EventLifecycle;
  aliases?: EventAlias[];
  ignore: IgnoreCheck[];
  payload: EventPayload;
  /**
   * Problems found by one walk of the raw document while loading it (removed keywords, field
   * definitions that are not mappings), at the path written in the file. Never ignorable; the
   * event is still loaded and validated.
   */
  fileIssues?: DocumentIssue[];
  /** Every `checks` entry written in the file (classified against the known check ids later) */
  checkRefs?: CheckRef[];
  /** Every `dict` reference written in the file (unknown dictionaries are reported once there) */
  dictRefs?: DictRef[];
}

/** A problem at a path of one YAML document */
export interface DocumentIssue {
  path: string;
  message: string;
}

/** One `dict` reference of a document: `<path>` is the path of the `dict` keyword */
export interface DictRef {
  path: string;
  dict: unknown;
  /** The key of the payload field it is written in (event files), for `ignore: payload::<f>` */
  field?: string;
}

/** One `checks` entry of a document: `<path>` is the path of the checks map */
export interface CheckRef {
  path: string;
  id: string;
  params: unknown;
  /** The key of the payload field it is written in (event files), for `ignore: payload::<f>` */
  field?: string;
}

// === Validation Error ===
export interface ValidationError {
  event: string;
  path: string;
  message: string;
  /** Only errors fail a run (exit code 1); warnings are reported and never change the exit code */
  severity: "error" | "warning";
  /** The configurable tool rule that produced it (`overlap`, `unknownCheck`) */
  rule?: string;
}

// === Resolved Config (after $ref resolution) ===
export interface ResolvedConfig extends OpenTPConfig {
  resolvedDicts: Map<string, (string | number | boolean)[]>;
}
