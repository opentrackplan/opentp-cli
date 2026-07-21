import { Roles, Permissions } from "../types/platform";
import type { PermissionAction, UserRole } from "../types/platform";

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  [Roles.VIEWER]: 0,
  [Roles.EDITOR]: 1,
  [Roles.ADMIN]: 2,
};

export const DEFAULT_PERMISSIONS: Record<PermissionAction, UserRole> = {
  [Permissions.VIEW_EVENTS]: Roles.VIEWER,
  [Permissions.SEARCH]: Roles.VIEWER,
  [Permissions.EXPORT]: Roles.VIEWER,
  [Permissions.CREATE_EVENT]: Roles.EDITOR,
  [Permissions.EDIT_EVENT]: Roles.EDITOR,
  [Permissions.MANAGE_DICTS]: Roles.EDITOR,
  [Permissions.SWITCH_MODE]: Roles.EDITOR,
  [Permissions.DELETE_EVENT]: Roles.ADMIN,
  [Permissions.DELETE_DICTS]: Roles.ADMIN,
};
