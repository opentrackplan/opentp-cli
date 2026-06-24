import { createContext, useContext, useMemo, useState, useCallback } from "react";
import type { ReactNode } from "react";
import {
  Roles,
  AccentColorNames,
} from "../../types/platform";
import type {
  UserRole,
  PermissionOverrides,
  AuthorizeCallback,
  PlatformUser,
  AppDefinition,
  AccentColor,
  BrandingConfig,
} from "../../types/platform";

// ── Context value types ─────────────────────────────────

export interface RoleContextValue {
  role: UserRole;
  permissions: PermissionOverrides | undefined;
  authorize: AuthorizeCallback | undefined;
  /** When false, no PlatformProvider exists (Mode A) — can() always returns true. */
  _hasProvider: boolean;
}

interface UserContextValue {
  user: PlatformUser | undefined;
  onLogout: (() => void) | undefined;
}

interface AppContextValue {
  apps: AppDefinition[];
  currentAppId: string | undefined;
  switchApp: (id: string) => void;
}

interface BrandingContextValue {
  title: string;
  logo: string | undefined;
  accentColor: AccentColor;
  favicon: string | undefined;
}

// ── Defaults (used when no provider exists — Mode A) ────

const DEFAULT_ROLE_VALUE: RoleContextValue = {
  role: Roles.EDITOR,
  permissions: undefined,
  authorize: undefined,
  _hasProvider: false,
};

const DEFAULT_USER_VALUE: UserContextValue = {
  user: undefined,
  onLogout: undefined,
};

const DEFAULT_APP_VALUE: AppContextValue = {
  apps: [],
  currentAppId: undefined,
  switchApp: () => {},
};

const DEFAULT_BRANDING_VALUE: BrandingContextValue = {
  title: "OpenTP",
  logo: undefined,
  accentColor: AccentColorNames[0],
  favicon: undefined,
};

// ── Contexts ────────────────────────────────────────────

export const RoleContext = createContext<RoleContextValue>(DEFAULT_ROLE_VALUE);
export const UserContext = createContext<UserContextValue>(DEFAULT_USER_VALUE);
export const AppContext = createContext<AppContextValue>(DEFAULT_APP_VALUE);
export const BrandingContext = createContext<BrandingContextValue>(DEFAULT_BRANDING_VALUE);

// ── Provider props ──────────────────────────────────────

interface PlatformProviderProps {
  role?: UserRole;
  permissions?: PermissionOverrides;
  authorize?: AuthorizeCallback;
  user?: PlatformUser;
  onLogout?: () => void;
  apps?: AppDefinition[];
  currentAppId?: string;
  onSwitchApp?: (id: string) => void;
  branding?: BrandingConfig;
  children: ReactNode;
}

// ── PlatformProvider ────────────────────────────────────

export function PlatformProvider({
  role = Roles.EDITOR,
  permissions,
  authorize,
  user,
  onLogout,
  apps = [],
  currentAppId: externalAppId,
  onSwitchApp,
  branding,
  children,
}: PlatformProviderProps) {
  const [internalAppId, setInternalAppId] = useState<string | undefined>(
    () => externalAppId ?? apps[0]?.id,
  );

  const currentAppId = externalAppId ?? internalAppId;

  const switchApp = useCallback(
    (id: string) => {
      const exists = apps.some((a) => a.id === id);
      if (!exists) {
        console.warn(`[OpenTP] switchApp: app "${id}" not found. Available: ${apps.map((a) => a.id).join(", ")}`);
        return;
      }
      if (onSwitchApp) {
        onSwitchApp(id);
      } else {
        setInternalAppId(id);
      }
    },
    [apps, onSwitchApp],
  );

  const roleValue = useMemo<RoleContextValue>(
    () => ({ role, permissions, authorize, _hasProvider: true }),
    [role, permissions, authorize],
  );

  const userValue = useMemo<UserContextValue>(
    () => ({ user, onLogout }),
    [user, onLogout],
  );

  const appValue = useMemo<AppContextValue>(
    () => ({ apps, currentAppId, switchApp }),
    [apps, currentAppId, switchApp],
  );

  const brandingValue = useMemo<BrandingContextValue>(
    () => ({
      title: branding?.title ?? "OpenTP",
      logo: branding?.logo,
      accentColor: branding?.accentColor ?? AccentColorNames[0],
      favicon: branding?.favicon,
    }),
    [branding?.title, branding?.logo, branding?.accentColor, branding?.favicon],
  );

  return (
    <RoleContext.Provider value={roleValue}>
      <UserContext.Provider value={userValue}>
        <AppContext.Provider value={appValue}>
          <BrandingContext.Provider value={brandingValue}>
            {children}
          </BrandingContext.Provider>
        </AppContext.Provider>
      </UserContext.Provider>
    </RoleContext.Provider>
  );
}

// ── Context hooks ───────────────────────────────────────

export function useRoleContext(): RoleContextValue {
  return useContext(RoleContext);
}

export function usePlatformUser(): UserContextValue {
  return useContext(UserContext);
}

export function useAppContext(): AppContextValue {
  return useContext(AppContext);
}

export function useBrandingContext(): BrandingContextValue {
  return useContext(BrandingContext);
}

// ── Convenience: merged access to all contexts ──────────

export function usePlatform() {
  const roleCtx = useRoleContext();
  const userCtx = usePlatformUser();
  const appCtx = useAppContext();
  const brandingCtx = useBrandingContext();
  return { ...roleCtx, ...userCtx, ...appCtx, ...brandingCtx };
}
