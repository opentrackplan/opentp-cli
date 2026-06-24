import { useState, useEffect, useCallback } from "react";
import { App } from "./App";
import { PlatformProvider } from "./core/platform/PlatformProvider";
import { ThemeProvider } from "./hooks/useTheme";
import { I18nProvider } from "./i18n";
import { AppErrorBoundary } from "./components/common/AppErrorBoundary";
import { Roles } from "./types/platform";
import type { OpenTPPlatformProps } from "./types/platform";
import { Modes } from "./types";
import type { UIMode } from "./types";

export function OpenTPPlatform({
  source,
  apps,
  role = Roles.EDITOR,
  user,
  onLogout,
  permissions,
  authorize,
  branding,
  defaultMode = Modes.VIEWER,
  options,
  onAppChange,
}: OpenTPPlatformProps) {
  const hasSource = source !== undefined;
  const hasApps = apps !== undefined && apps.length > 0;

  // Validate props
  if (hasSource && hasApps) {
    console.warn("[OpenTP] Both `source` and `apps` provided. `source` takes priority (Mode B).");
  }
  if (!hasSource && !hasApps) {
    console.warn("[OpenTP] Neither `source` nor `apps` provided. Pass a `source` prop (Mode B) or `apps` array (Mode C) to render.");
  }

  // Mode B: single source
  if (hasSource) {
    return (
      <PlatformProvider
        role={role}
        user={user}
        onLogout={onLogout}
        permissions={permissions}
        authorize={authorize}
        branding={branding}
      >
        <ThemeProvider>
          <I18nProvider>
            <AppErrorBoundary>
              <App source={source} mode={defaultMode} options={options} />
            </AppErrorBoundary>
          </I18nProvider>
        </ThemeProvider>
      </PlatformProvider>
    );
  }

  // Mode C: multi-app
  if (hasApps) {
    return (
      <MultiAppPlatform
        apps={apps}
        role={role}
        user={user}
        onLogout={onLogout}
        permissions={permissions}
        authorize={authorize}
        branding={branding}
        defaultMode={defaultMode}
        options={options}
        onAppChange={onAppChange}
      />
    );
  }

  // Nothing to render
  return null;
}

/** Internal component that manages multi-app state */
function MultiAppPlatform({
  apps,
  role,
  user,
  onLogout,
  permissions,
  authorize,
  branding,
  defaultMode,
  options,
  onAppChange,
}: Required<Pick<OpenTPPlatformProps, "apps">> &
  Omit<OpenTPPlatformProps, "source" | "apps"> & {
    defaultMode: UIMode;
    role: NonNullable<OpenTPPlatformProps["role"]>;
  }) {
  const [currentAppId, setCurrentAppId] = useState<string>(
    () => apps[0]?.id ?? "",
  );

  // If apps prop changes and current app is no longer in the list, fall back to first
  useEffect(() => {
    if (apps.length > 0 && !apps.some((a) => a.id === currentAppId)) {
      setCurrentAppId(apps[0].id);
    }
  }, [apps, currentAppId]);

  const handleSwitchApp = useCallback(
    (id: string) => {
      setCurrentAppId(id);
      onAppChange?.(id);
    },
    [onAppChange],
  );

  const currentApp = apps.find((a) => a.id === currentAppId) ?? apps[0];
  if (!currentApp) return null;

  return (
    <PlatformProvider
      role={role}
      user={user}
      onLogout={onLogout}
      permissions={permissions}
      authorize={authorize}
      branding={branding}
      apps={apps}
      currentAppId={currentAppId}
      onSwitchApp={handleSwitchApp}
    >
      <ThemeProvider>
        <I18nProvider>
          <AppErrorBoundary key={currentApp.id}>
            <App
              source={currentApp.source}
              mode={defaultMode}
              options={options}
              key={currentApp.id}
            />
          </AppErrorBoundary>
        </I18nProvider>
      </ThemeProvider>
    </PlatformProvider>
  );
}
