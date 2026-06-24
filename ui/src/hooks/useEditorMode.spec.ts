import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEditorMode } from "./useEditorMode";
import type { DataSource, TrackingEvent } from "../types";
import { createTestWrapper, createBareWrapper } from "../test-utils";

const apiSource: DataSource = { type: "api", baseUrl: "" };
const staticSource: DataSource = {
  type: "static",
  data: {
    config: {} as any,
    events: [],
    dictionaries: {},
    dictionaryMeta: {},
  },
};

function makeEvent(key: string): TrackingEvent {
  return {
    key,
    relativePath: `events/${key}.yaml`,
    taxonomy: { area: "test", event: key },
    payload: { schema: { field1: { type: "string" } } },
  };
}

describe("useEditorMode", () => {
  beforeEach(() => {
    localStorage.removeItem("opentp-mode");
  });

  it("starts in viewer mode when source is static", () => {
    const { result } = renderHook(() => useEditorMode("editor", staticSource));
    expect(result.current.mode).toBe("viewer");
    expect(result.current.canEdit).toBe(false);
  });

  it("allows editor mode when source is api", () => {
    const { result } = renderHook(() => useEditorMode("editor", apiSource));
    expect(result.current.mode).toBe("editor");
    expect(result.current.canEdit).toBe(true);
  });

  it("creates a draft when editEvent is called in editor mode", () => {
    const { result } = renderHook(() => useEditorMode("editor", apiSource));
    const event = makeEvent("test::event");

    act(() => {
      result.current.editEvent(event);
    });

    expect(result.current.draft).not.toBeNull();
    expect(result.current.draft?.key).toBe("test::event");
    expect(result.current.draft?.originalKey).toBe("test::event");
    expect(result.current.draft?.isDirty).toBe(false);
  });

  it("does not create draft when editEvent is called in viewer mode", () => {
    const { result } = renderHook(() => useEditorMode("viewer", apiSource));
    const event = makeEvent("test::event");

    act(() => {
      result.current.editEvent(event);
    });

    expect(result.current.draft).toBeNull();
  });

  it("switching from viewer to editor mode requires re-calling editEvent", () => {
    const { result } = renderHook(() => useEditorMode("viewer", apiSource));

    act(() => {
      result.current.setMode("editor");
    });
    expect(result.current.mode).toBe("editor");

    expect(result.current.draft).toBeNull();

    const event = makeEvent("test::event");
    act(() => {
      result.current.editEvent(event);
    });

    expect(result.current.draft).not.toBeNull();
    expect(result.current.draft?.key).toBe("test::event");
  });

  it("switching back to viewer mode clears the draft", () => {
    const { result } = renderHook(() => useEditorMode("editor", apiSource));
    const event = makeEvent("test::event");

    act(() => {
      result.current.editEvent(event);
    });

    expect(result.current.draft).not.toBeNull();

    act(() => {
      result.current.setMode("viewer");
    });

    expect(result.current.draft).toBeNull();
  });

  it("persists mode to localStorage on change", () => {
    const { result } = renderHook(() => useEditorMode("viewer", apiSource));

    act(() => {
      result.current.setMode("editor");
    });

    expect(localStorage.getItem("opentp-mode")).toBe("editor");

    act(() => {
      result.current.setMode("viewer");
    });

    expect(localStorage.getItem("opentp-mode")).toBe("viewer");
  });

  it("restores saved mode from localStorage", () => {
    localStorage.setItem("opentp-mode", "editor");

    const { result } = renderHook(() => useEditorMode("viewer", apiSource));
    expect(result.current.mode).toBe("editor");
  });

  it("ignores saved mode when source is static", () => {
    localStorage.setItem("opentp-mode", "editor");

    const { result } = renderHook(() => useEditorMode("viewer", staticSource));
    expect(result.current.mode).toBe("viewer");
  });

  it("markSaved updates originalKey and key, clears isDirty", () => {
    const { result } = renderHook(() => useEditorMode("editor", apiSource));
    const event = makeEvent("old_key");

    act(() => {
      result.current.editEvent(event);
    });

    act(() => {
      result.current.updateDraft({ key: "new_key" });
    });

    expect(result.current.draft?.isDirty).toBe(true);

    act(() => {
      result.current.markSaved("new_key");
    });

    expect(result.current.draft?.key).toBe("new_key");
    expect(result.current.draft?.originalKey).toBe("new_key");
    expect(result.current.draft?.isDirty).toBe(false);
  });

  // ── Phase 3: Role-aware tests ─────────────────────────────

  it("canEdit is false when role is viewer (API source)", () => {
    const wrapper = createTestWrapper({ role: "viewer" });
    const { result } = renderHook(
      () => useEditorMode("editor", apiSource),
      { wrapper },
    );
    expect(result.current.canEdit).toBe(false);
    expect(result.current.mode).toBe("viewer");
  });

  it("canEdit is true when role is editor (API source)", () => {
    const wrapper = createTestWrapper({ role: "editor" });
    const { result } = renderHook(
      () => useEditorMode("editor", apiSource),
      { wrapper },
    );
    expect(result.current.canEdit).toBe(true);
  });

  it("canEdit is false for static source regardless of role", () => {
    const wrapper = createTestWrapper({ role: "admin" });
    const { result } = renderHook(
      () => useEditorMode("editor", staticSource),
      { wrapper },
    );
    expect(result.current.canEdit).toBe(false);
  });

  it("setMode to editor is rejected when can('switchMode') is false", () => {
    const wrapper = createTestWrapper({ role: "viewer" });
    const { result } = renderHook(
      () => useEditorMode("viewer", apiSource),
      { wrapper },
    );

    act(() => {
      result.current.setMode("editor");
    });

    expect(result.current.mode).toBe("viewer");
  });

  it("existing tests still pass without PlatformProvider (backward compat)", () => {
    const wrapper = createBareWrapper();
    const { result } = renderHook(
      () => useEditorMode("editor", apiSource),
      { wrapper },
    );
    // No PlatformProvider → useRole defaults to editor with all permissions
    expect(result.current.canEdit).toBe(true);
    expect(result.current.mode).toBe("editor");
  });
});
