// Types matching the CLI serve API responses.
// Source of truth: src/types/index.ts + src/serve/api.ts

// ── Shared field types ──────────────────────────────────

export type ScalarType = "string" | "number" | "integer" | "boolean";

export type StringFormat =
  | "date"
  | "date-time"
  | "email"
  | "uuid"
  | "uri"
  | "ipv4"
  | "ipv6";

export interface ArrayItems {
  type: ScalarType;
  enum?: Array<string | number | boolean>;
  dict?: string;
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

export interface Field {
  title?: string;
  description?: string;
  pii?: Record<string, unknown> & {
    kind?: string;
    masker?: string;
  };
  type?: ScalarType | "array";
  enum?: Array<string | number | boolean>;
  dict?: string;
  required?: boolean;
  valueRequired?: boolean;
  value?: string | number | boolean | Array<string | number | boolean>;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: StringFormat;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  items?: ArrayItems;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  "x-opentp"?: {
    role?: "constant" | "attribute" | "shared";
    checks?: Record<string, unknown>;
  };
}

// ── Taxonomy ─────────────────────────────────────────────

export interface TaxonomyField {
  title: string;
  description?: string;
  type: ScalarType;
  required?: boolean;
  template?: string;
  fragments?: Record<string, TaxonomyField>;
  enum?: Array<string | number | boolean>;
  dict?: string;
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

// ── Config (GET /api/config) ─────────────────────────────

export interface OpenTPConfig {
  opentp: string;
  info: {
    title: string;
    description?: string;
    version: string;
    contact?: string[];
  };
  spec: {
    paths: {
      events: { root: string; template: string };
      dictionaries?: { root: string };
    };
    targets?: Record<
      string,
      {
        title?: string;
        description?: string;
        schema?: Record<string, Field>;
      }
    >;
    events: {
      key?: {
        minLength?: number;
        maxLength?: number;
        pattern?: string;
        format?: StringFormat;
      };
      taxonomy: Record<string, TaxonomyField>;
      payload: {
        targets: Record<string, string[]>;
        schema: Record<string, Field>;
      };
      pii?: {
        kind?: { required?: boolean; enum?: string[]; dict?: string };
        masker?: { required?: boolean; enum?: string[]; dict?: string };
        schema?: Record<string, unknown>;
      };
    };
  };
}

// ── Events (GET /api/events) ─────────────────────────────

export interface EventLifecycle {
  status?: "active" | "deprecated" | "draft";
  deprecatedAt?: string;
  deprecatedReason?: string;
  replacedBy?: string;
}

export interface EventAlias {
  key: string;
  deprecated?: {
    reason?: string;
    date?: string;
  };
}

/** Event as returned by GET /api/events (list). Payload is raw (not resolved). */
export interface TrackingEvent {
  key: string;
  relativePath: string;
  taxonomy: Record<string, unknown>;
  lifecycle?: EventLifecycle;
  aliases?: EventAlias[];
  payload: unknown;
}

// ── Single event detail (GET /api/events/:key) ──────────

export interface PayloadMeta {
  changes?: string | string[];
  deprecated?: { reason: string; date?: string };
}

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

export interface PayloadIssue {
  path: string;
  message: string;
}

/** Event as returned by GET /api/events/:key (single). Includes resolved payload. */
export interface TrackingEventDetail extends TrackingEvent {
  resolvedPayload: ResolvedEventPayload;
  payloadIssues: PayloadIssue[];
}

// ── Dictionaries (GET /api/dictionaries) ─────────────────

export interface DictionaryEntry {
  type: ScalarType;
  values: Array<string | number | boolean>;
}

export interface DictionariesResponse {
  dictionaries: Record<string, DictionaryEntry>;
  issues: Array<{ file: string; path: string; message: string }>;
}

// ── UI data types ────────────────────────────────────────

/** Combined data the UI works with after loading. */
export interface TrackingPlanData {
  config: OpenTPConfig;
  events: TrackingEvent[];
  dictionaries: Record<string, Array<string | number | boolean>>;
  dictionaryMeta: Record<string, DictionaryEntry>;
}

/** How the UI gets its data. */
export type DataSource =
  | { type: "api"; baseUrl: string }
  | { type: "static"; data: TrackingPlanData }
  | { type: "json-url"; url: string };

// ── Editor types ──────────────────────────────────────────

/** Draft of an event being created or edited. */
export interface EventDraft {
  /** Original key if editing an existing event. null if creating new. */
  originalKey: string | null;
  key: string;
  taxonomy: Record<string, unknown>;
  lifecycle?: EventLifecycle;
  aliases?: EventAlias[];
  payload: unknown;
  isDirty: boolean;
}

/** Response from POST /api/validate. */
export interface ValidationResult {
  valid: boolean;
  eventCount: number;
  errorCount: number;
  warningCount: number;
  events: Record<
    string,
    {
      errors: Array<{ path: string; message: string }>;
      warnings: Array<{ path: string; message: string }>;
    }
  >;
}

/** Response from POST /api/events (create). */
export interface CreateEventResult {
  created: boolean;
  key: string;
  filePath: string;
}

/** Response from PUT /api/events/:key (update). */
export interface UpdateEventResult {
  updated: boolean;
  key: string;
  filePath: string;
}

/** Response from DELETE /api/events/:key. */
export interface DeleteEventResult {
  deleted: boolean;
  key: string;
}

/** Union for mutation results. */
export type MutationResult = CreateEventResult | UpdateEventResult;

// ── Dictionary editor types ──────────────────────────────

/** Draft of a dictionary being created or edited. */
export interface DictionaryDraft {
  /** Original key if editing. null if creating new. */
  originalKey: string | null;
  key: string;
  type: ScalarType;
  values: Array<string | number | boolean>;
  isDirty: boolean;
}

/** Response from POST /api/dictionaries (create). */
export interface CreateDictionaryResult {
  created: boolean;
  key: string;
  filePath: string;
}

/** Response from PUT /api/dictionaries/:key (update). */
export interface UpdateDictionaryResult {
  updated: boolean;
  key: string;
  filePath: string;
}

/** Response from DELETE /api/dictionaries/:key. */
export interface DeleteDictionaryResult {
  deleted: boolean;
  key: string;
}

// ── UI mode ──────────────────────────────────────────────

export const Modes = {
  VIEWER: "viewer",
  EDITOR: "editor",
} as const;
export type UIMode = (typeof Modes)[keyof typeof Modes];

// ── UI options ───────────────────────────────────────────

/** Configuration options for the opentp-ui component. */
export interface OpenTPUIOptions {
  /** Taxonomy field keys to use as tree grouping levels. Auto-detected if omitted. */
  treeLevels?: string[];
}
