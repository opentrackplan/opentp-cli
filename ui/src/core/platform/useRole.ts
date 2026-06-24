import { Roles } from "../../types/platform";
import type { PermissionAction, ActionContext, UserRole } from "../../types/platform";
import { ROLE_HIERARCHY, DEFAULT_PERMISSIONS } from "../defaults";
import { useRoleContext } from "./PlatformProvider";

export function useRole(): {
  role: UserRole;
  can: (action: PermissionAction, context?: ActionContext) => boolean;
} {
  const { role, permissions, authorize, _hasProvider } = useRoleContext();

  function can(action: PermissionAction, context?: ActionContext): boolean {
    // Mode A (no PlatformProvider): no restrictions — backward compat
    if (!_hasProvider) {
      return true;
    }

    // authorize callback takes full priority
    if (authorize) {
      return authorize(role, action, context);
    }

    // Merge default permissions with overrides
    const merged = { ...DEFAULT_PERMISSIONS, ...permissions };
    const requiredRole = merged[action];

    // Unknown action → fail closed (require admin)
    if (!requiredRole) {
      return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[Roles.ADMIN];
    }

    return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[requiredRole];
  }

  return { role, can };
}
