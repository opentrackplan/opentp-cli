import { describe, it, expect } from "vitest";
import { ROLE_HIERARCHY, DEFAULT_PERMISSIONS } from "./defaults";
import { Roles, Permissions } from "../types/platform";
import type { PermissionAction, UserRole } from "../types/platform";

describe("ROLE_HIERARCHY", () => {
  it("has correct ordering: viewer < editor < admin", () => {
    expect(ROLE_HIERARCHY[Roles.VIEWER]).toBeLessThan(ROLE_HIERARCHY[Roles.EDITOR]);
    expect(ROLE_HIERARCHY[Roles.EDITOR]).toBeLessThan(ROLE_HIERARCHY[Roles.ADMIN]);
  });
});

describe("DEFAULT_PERMISSIONS", () => {
  const allActions: PermissionAction[] = [
    Permissions.VIEW_EVENTS,
    Permissions.SEARCH,
    Permissions.EXPORT,
    Permissions.CREATE_EVENT,
    Permissions.EDIT_EVENT,
    Permissions.MANAGE_DICTS,
    Permissions.SWITCH_MODE,
    Permissions.DELETE_EVENT,
    Permissions.DELETE_DICTS,
  ];

  const validRoles: UserRole[] = [Roles.VIEWER, Roles.EDITOR, Roles.ADMIN];

  it("covers all PermissionAction values", () => {
    for (const action of allActions) {
      expect(DEFAULT_PERMISSIONS).toHaveProperty(action);
    }
  });

  it("every PermissionAction maps to a valid UserRole", () => {
    for (const action of allActions) {
      expect(validRoles).toContain(DEFAULT_PERMISSIONS[action]);
    }
  });
});
