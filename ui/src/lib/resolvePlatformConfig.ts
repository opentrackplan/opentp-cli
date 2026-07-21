import type { PlatformJsonConfig } from "../types/platform";

export interface ResolveConfigResult {
  config?: PlatformJsonConfig;
  error?: "unauthorized" | "fetch-error" | "parse-error";
  errorMessage?: string;
}

/**
 * Resolves platform configuration by merging a remote config URL response
 * with locally provided attribute overrides.
 *
 * Attributes always override config URL values.
 */
export async function resolvePlatformConfig(
  configUrl: string | null,
  attributes: Partial<PlatformJsonConfig>,
): Promise<ResolveConfigResult> {
  let remoteConfig: PlatformJsonConfig = {};

  if (configUrl) {
    try {
      const response = await fetch(configUrl, { credentials: "include" });

      if (response.status === 401) {
        return { error: "unauthorized", errorMessage: "Not authenticated" };
      }

      if (!response.ok) {
        return {
          error: "fetch-error",
          errorMessage: `Failed to fetch config: ${response.status} ${response.statusText}`,
        };
      }

      try {
        remoteConfig = await response.json();
      } catch {
        return {
          error: "parse-error",
          errorMessage: "Config URL returned invalid JSON",
        };
      }
    } catch (e) {
      return {
        error: "fetch-error",
        errorMessage: `Failed to fetch config: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  // Merge: attributes override remote config
  const merged: PlatformJsonConfig = { ...remoteConfig };

  if (attributes.role !== undefined) merged.role = attributes.role;
  if (attributes.apps !== undefined) merged.apps = attributes.apps;
  if (attributes.source !== undefined) merged.source = attributes.source;
  if (attributes.user !== undefined) merged.user = attributes.user;
  if (attributes.permissions !== undefined)
    merged.permissions = attributes.permissions;
  if (attributes.branding !== undefined) merged.branding = attributes.branding;
  if (attributes.defaultMode !== undefined)
    merged.defaultMode = attributes.defaultMode;
  if (attributes.options !== undefined) merged.options = attributes.options;

  return { config: merged };
}

/**
 * Safely parse a JSON string attribute value.
 * Returns undefined and warns on console if parsing fails.
 */
export function parseJsonAttr<T>(name: string, value: string | null): T | undefined {
  if (value === null || value === undefined) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    console.warn(`[opentp-platform] Invalid JSON for "${name}" attribute:`, value);
    return undefined;
  }
}
