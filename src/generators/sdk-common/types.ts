/**
 * A resolved field ready for code generation (language-agnostic).
 *
 * Language-specific builders convert these fields into their own type strings.
 */
export interface ResolvedField {
  /** Original field name from YAML (e.g. "auth_method") */
  name: string;
  /** Base type: "string" | "number" | "integer" | "boolean" | "unknown" */
  baseType: string;
  /** Resolved enum or dict values (e.g. ["email", "google", "github"]) */
  enumValues?: (string | number | boolean)[];
  /** For arrays: the item's base scalar type */
  arrayItemType?: string;
  /** For arrays: the item's enum/dict values */
  arrayItemEnum?: (string | number | boolean)[];
  /** Is this field required? */
  required: boolean;
  /** Is this an array type? */
  isArray: boolean;
  /** Optional description */
  description?: string;
  /** PII kind if present */
  piiKind?: string;
}

/** A fully resolved event ready for code generation */
export interface MappedEvent {
  /** Original event key, e.g. "auth::login_button_click" */
  key: string;
  /** camelCase area name, e.g. "auth" */
  area: string;
  /** camelCase event name, e.g. "loginButtonClick" */
  eventName: string;
  /** PascalCase interface name, e.g. "AuthLoginButtonClickParams" */
  interfaceName: string;
  /** Fields the developer passes (no fixed value) */
  params: ResolvedField[];
  /** Fields with fixed values (auto-injected) */
  constants: Record<string, string | number | boolean>;
  /** Event lifecycle status */
  status?: "active" | "deprecated" | "draft";
}

/** Build options for SDK generators */
export interface BuildOptions {
  planTitle: string;
  planVersion: string;
  targetName: string;
  generatedAt: string;
  /** Generate standalone tracker without @opentp/sdk dependency (default: false) */
  standalone?: boolean;
}

/** Interface for language-specific SDK builders */
export interface SdkBuilder {
  /** File extension for the generated output (e.g. "ts", "py", "swift") */
  extension: string;
  /** Human-readable language name */
  language: string;
  /** Build the SDK output string from mapped events */
  build(events: MappedEvent[], options: BuildOptions): string;
}
