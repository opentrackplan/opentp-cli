import type { DataSource, OpenTPUIOptions, UIMode } from "./index";

// ── Roles & Permissions ─────────────────────────────────

export const Roles = {
  VIEWER: "viewer",
  EDITOR: "editor",
  ADMIN: "admin",
} as const;
export type UserRole = (typeof Roles)[keyof typeof Roles];

export const Permissions = {
  VIEW_EVENTS: "viewEvents",
  SEARCH: "search",
  EXPORT: "export",
  CREATE_EVENT: "createEvent",
  EDIT_EVENT: "editEvent",
  MANAGE_DICTS: "manageDicts",
  SWITCH_MODE: "switchMode",
  DELETE_EVENT: "deleteEvent",
  DELETE_DICTS: "deleteDicts",
} as const;
export type PermissionAction = (typeof Permissions)[keyof typeof Permissions];

export type PermissionOverrides = Partial<Record<PermissionAction, UserRole>>;

export interface ActionContext {
  appId?: string;
  eventKey?: string;
}

export type AuthorizeCallback = (
  role: UserRole,
  action: PermissionAction,
  context?: ActionContext,
) => boolean;

// ── User ────────────────────────────────────────────────

export interface PlatformUser {
  name: string;
  avatar?: string;
}

// ── Apps ────────────────────────────────────────────────

export interface AppDefinition {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  source: DataSource;
}

// ── Branding ────────────────────────────────────────────

export const AccentColorNames = [
  "blue", "indigo", "violet", "emerald", "teal",
  "amber", "rose", "red", "orange", "cyan",
] as const;
export type AccentColor = (typeof AccentColorNames)[number];

export interface BrandingConfig {
  title?: string;
  logo?: string;
  accentColor?: AccentColor;
  favicon?: string;
}

// ── Platform Props ──────────────────────────────────────

export interface OpenTPPlatformProps {
  /** Single-app source (Mode B). Mutually exclusive with `apps`. */
  source?: DataSource;
  /** Multi-app definitions (Mode C). Mutually exclusive with `source`. */
  apps?: AppDefinition[];
  /** User role. Defaults to "editor" when absent. */
  role?: UserRole;
  /** Display-only user info. When absent, UserMenu is hidden. */
  user?: PlatformUser;
  /** Logout callback. When absent, logout button is hidden. */
  onLogout?: () => void;
  /** Override default permission matrix for specific actions. */
  permissions?: PermissionOverrides;
  /** Full-control authorization callback. Takes priority over `permissions`. */
  authorize?: AuthorizeCallback;
  /** Branding customization (logo, title, accent color). */
  branding?: BrandingConfig;
  /** Default UI mode. Defaults to "viewer". */
  defaultMode?: UIMode;
  /** UI options passed through to App. */
  options?: OpenTPUIOptions;
  /** Called when the active app changes (Mode C). Useful for URL/router sync. */
  onAppChange?: (appId: string) => void;
}

// ── Web Component Config ────────────────────────────────

/** Serializable config for the `<opentp-platform>` web component `config` attribute. */
export interface PlatformJsonConfig {
  source?: DataSource;
  apps?: AppDefinition[];
  role?: UserRole;
  user?: PlatformUser;
  permissions?: PermissionOverrides;
  branding?: BrandingConfig;
  defaultMode?: UIMode;
  options?: OpenTPUIOptions;
}
