import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { createTestWrapper, createBareWrapper } from "../../test-utils";
import { useRole } from "./useRole";
import { Roles, Permissions } from "../../types/platform";
import type { PermissionAction } from "../../types/platform";

const ALL_ACTIONS: PermissionAction[] = [
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

describe("useRole", () => {
  it("viewer cannot create events", () => {
    const wrapper = createTestWrapper({ role: Roles.VIEWER });
    const { result } = renderHook(() => useRole(), { wrapper });
    expect(result.current.can(Permissions.CREATE_EVENT)).toBe(false);
  });

  it("editor can create events", () => {
    const wrapper = createTestWrapper({ role: Roles.EDITOR });
    const { result } = renderHook(() => useRole(), { wrapper });
    expect(result.current.can(Permissions.CREATE_EVENT)).toBe(true);
  });

  it("editor cannot delete events (default)", () => {
    const wrapper = createTestWrapper({ role: Roles.EDITOR });
    const { result } = renderHook(() => useRole(), { wrapper });
    expect(result.current.can(Permissions.DELETE_EVENT)).toBe(false);
  });

  it("admin can do everything", () => {
    const wrapper = createTestWrapper({ role: Roles.ADMIN });
    const { result } = renderHook(() => useRole(), { wrapper });
    for (const action of ALL_ACTIONS) {
      expect(result.current.can(action)).toBe(true);
    }
  });

  it("permissions override: deleteEvent lowered to editor", () => {
    const wrapper = createTestWrapper({
      role: Roles.EDITOR,
      permissions: { [Permissions.DELETE_EVENT]: Roles.EDITOR },
    });
    const { result } = renderHook(() => useRole(), { wrapper });
    expect(result.current.can(Permissions.DELETE_EVENT)).toBe(true);
  });

  it("authorize callback takes priority over permissions", () => {
    const wrapper = createTestWrapper({
      role: Roles.ADMIN,
      permissions: { [Permissions.DELETE_EVENT]: Roles.VIEWER },
      authorize: () => false,
    });
    const { result } = renderHook(() => useRole(), { wrapper });
    expect(result.current.can(Permissions.DELETE_EVENT)).toBe(false);
  });

  it("authorize receives context", () => {
    const authorize = vi.fn().mockReturnValue(true);
    const wrapper = createTestWrapper({ role: Roles.EDITOR, authorize });
    const { result } = renderHook(() => useRole(), { wrapper });

    result.current.can(Permissions.EDIT_EVENT, { appId: "web", eventKey: "auth::login" });

    expect(authorize).toHaveBeenCalledWith(Roles.EDITOR, Permissions.EDIT_EVENT, {
      appId: "web",
      eventKey: "auth::login",
    });
  });

  it("no provider → role is editor, all actions allowed", () => {
    const wrapper = createBareWrapper();
    const { result } = renderHook(() => useRole(), { wrapper });
    expect(result.current.role).toBe(Roles.EDITOR);
    for (const action of ALL_ACTIONS) {
      expect(result.current.can(action)).toBe(true);
    }
  });

  it("unknown permission action defaults to admin-required", () => {
    const editorWrapper = createTestWrapper({ role: Roles.EDITOR });
    const { result: editorResult } = renderHook(() => useRole(), { wrapper: editorWrapper });
    expect(editorResult.current.can("unknownAction" as PermissionAction)).toBe(false);

    const adminWrapper = createTestWrapper({ role: Roles.ADMIN });
    const { result: adminResult } = renderHook(() => useRole(), { wrapper: adminWrapper });
    expect(adminResult.current.can("unknownAction" as PermissionAction)).toBe(true);
  });
});
