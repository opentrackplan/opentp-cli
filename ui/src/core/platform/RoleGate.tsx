import type { ReactNode } from "react";
import type { PermissionAction, ActionContext } from "../../types/platform";
import { useRole } from "./useRole";

interface RoleGateProps {
  action: PermissionAction;
  context?: ActionContext;
  fallback?: ReactNode;
  children: ReactNode;
}

export function RoleGate({ action, context, fallback = null, children }: RoleGateProps) {
  const { can } = useRole();

  if (can(action, context)) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}
