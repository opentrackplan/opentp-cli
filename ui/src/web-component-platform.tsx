import { createRoot, type Root } from "react-dom/client";
import { OpenTPPlatform } from "./Platform";
import type {
  AppDefinition,
  BrandingConfig,
  PlatformJsonConfig,
  PermissionOverrides,
  PlatformUser,
  UserRole,
} from "./types/platform";
import { Modes } from "./types";
import type { OpenTPUIOptions } from "./types";
import {
  resolvePlatformConfig,
  parseJsonAttr,
  type ResolveConfigResult,
} from "./lib/resolvePlatformConfig";
import { setupShadowDom } from "./lib/web-component-utils";

// Import Tailwind styles as a string for Shadow DOM injection
import styles from "./styles/index.css?inline";

const OBSERVED_ATTRIBUTES = [
  "config",
  "role",
  "apps",
  "branding",
  "permissions",
  "options",
  "source",
  "user",
  "default-mode",
] as const;

class OpenTPPlatformElement extends HTMLElement {
  private _root: Root | null = null;
  private _mountPoint: HTMLDivElement | null = null;
  private _pendingRender: boolean = false;
  private _lastConfigUrl: string | null = null;
  private _cachedRemoteConfig: PlatformJsonConfig | null = null;

  static get observedAttributes() {
    return [...OBSERVED_ATTRIBUTES];
  }

  connectedCallback() {
    const { mountPoint } = setupShadowDom(this, styles);
    this._mountPoint = mountPoint;
    this._root = createRoot(mountPoint);
    this._loadAndRender();
  }

  disconnectedCallback() {
    this._root?.unmount();
    this._root = null;
    this._mountPoint = null;
  }

  attributeChangedCallback(name: string) {
    if (!this._root) return;

    // If the config URL changed, invalidate cache
    if (name === "config") {
      const newConfigUrl = this.getAttribute("config");
      if (newConfigUrl !== this._lastConfigUrl) {
        this._cachedRemoteConfig = null;
      }
    }

    // Debounce with microtask to batch multiple attribute changes
    if (!this._pendingRender) {
      this._pendingRender = true;
      queueMicrotask(() => {
        this._pendingRender = false;
        this._loadAndRender();
      });
    }
  }

  private async _loadAndRender() {
    if (!this._root || !this._mountPoint) return;

    const configUrl = this.getAttribute("config");

    // Show loading state only when fetching remote config
    if (configUrl && !this._cachedRemoteConfig) {
      this._root.render(
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "#888",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          Loading…
        </div>,
      );
    }

    // Gather attributes as overrides
    const attributes = this._gatherAttributes();

    // If we have a cached remote config and the URL hasn't changed, use it
    if (configUrl && this._cachedRemoteConfig && configUrl === this._lastConfigUrl) {
      const merged: PlatformJsonConfig = { ...this._cachedRemoteConfig };
      if (attributes.role !== undefined) merged.role = attributes.role;
      if (attributes.apps !== undefined) merged.apps = attributes.apps;
      if (attributes.source !== undefined) merged.source = attributes.source;
      if (attributes.user !== undefined) merged.user = attributes.user;
      if (attributes.permissions !== undefined) merged.permissions = attributes.permissions;
      if (attributes.branding !== undefined) merged.branding = attributes.branding;
      if (attributes.defaultMode !== undefined) merged.defaultMode = attributes.defaultMode;
      if (attributes.options !== undefined) merged.options = attributes.options;
      this._renderPlatform({ config: merged });
      return;
    }

    const result = await resolvePlatformConfig(configUrl, attributes);

    // Cache remote config for subsequent attribute-only changes
    if (configUrl && result.config && !result.error) {
      this._lastConfigUrl = configUrl;
      // Store the base remote config (before attribute overrides)
      // Re-fetch to get the raw remote — we already have the merged result
      // Actually, just store the merged result minus attribute overrides:
      // Simpler: cache the full resolved config and re-merge attributes on next render
      this._cachedRemoteConfig = result.config;
    }

    this._renderPlatform(result);
  }

  private _renderPlatform(result: ResolveConfigResult) {
    if (!this._root) return;

    if (result.error) {
      this._root.render(
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            gap: "12px",
            color: "#888",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <p style={{ margin: 0 }}>
            {result.error === "unauthorized"
              ? "Not authenticated"
              : result.errorMessage ?? "Failed to load configuration"}
          </p>
          {result.error !== "unauthorized" && (
            <button
              type="button"
              onClick={() => {
                this._cachedRemoteConfig = null;
                this._loadAndRender();
              }}
              style={{
                padding: "6px 16px",
                borderRadius: "4px",
                border: "1px solid #ccc",
                background: "transparent",
                cursor: "pointer",
                color: "inherit",
              }}
            >
              Retry
            </button>
          )}
        </div>,
      );
      return;
    }

    const config = result.config ?? {};

    this._root.render(
      <OpenTPPlatform
        source={config.source}
        apps={config.apps}
        role={config.role}
        user={config.user}
        permissions={config.permissions}
        branding={config.branding}
        defaultMode={config.defaultMode}
        options={config.options}
      />,
    );
  }

  private _gatherAttributes(): Partial<PlatformJsonConfig> {
    const attrs: Partial<PlatformJsonConfig> = {};

    const role = this.getAttribute("role");
    if (role) attrs.role = role as UserRole;

    const apps = parseJsonAttr<AppDefinition[]>("apps", this.getAttribute("apps"));
    if (apps) attrs.apps = apps;

    const branding = parseJsonAttr<BrandingConfig>(
      "branding",
      this.getAttribute("branding"),
    );
    if (branding) attrs.branding = branding;

    const permissions = parseJsonAttr<PermissionOverrides>(
      "permissions",
      this.getAttribute("permissions"),
    );
    if (permissions) attrs.permissions = permissions;

    const options = parseJsonAttr<OpenTPUIOptions>(
      "options",
      this.getAttribute("options"),
    );
    if (options) attrs.options = options;

    const source = parseJsonAttr<PlatformJsonConfig["source"]>(
      "source",
      this.getAttribute("source"),
    );
    if (source) attrs.source = source;

    const user = parseJsonAttr<PlatformUser>("user", this.getAttribute("user"));
    if (user) attrs.user = user;

    const defaultMode = this.getAttribute("default-mode");
    if (defaultMode === Modes.VIEWER || defaultMode === Modes.EDITOR) {
      attrs.defaultMode = defaultMode;
    }

    return attrs;
  }
}

if (!customElements.get("opentp-platform")) {
  customElements.define("opentp-platform", OpenTPPlatformElement);
}
