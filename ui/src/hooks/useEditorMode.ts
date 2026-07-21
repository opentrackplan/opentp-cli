import { useState, useCallback } from "react";
import { Modes } from "../types";
import type { DataSource, UIMode, TrackingEvent, EventDraft, Field } from "../types";
import { Permissions } from "../types/platform";
import { useRole } from "../core/platform/useRole";

export interface UseEditorModeResult {
  mode: UIMode;
  setMode: (m: UIMode) => void;
  canEdit: boolean;
  draft: EventDraft | null;
  editEvent: (event: TrackingEvent) => void;
  newEvent: (baseSchema?: Record<string, Field>) => void;
  updateDraft: (partial: Partial<EventDraft>) => void;
  discardDraft: () => void;
  markSaved: (newKey: string) => void;
}

export function useEditorMode(
  initialMode: UIMode,
  source: DataSource,
): UseEditorModeResult {
  const { can } = useRole();
  const canEdit = source.type === "api" && can(Permissions.EDIT_EVENT);
  const [mode, setModeInternal] = useState<UIMode>(() => {
    if (!canEdit) return Modes.VIEWER;
    const saved = localStorage.getItem("opentp-mode") as UIMode | null;
    return saved === Modes.EDITOR || saved === Modes.VIEWER ? saved : initialMode;
  });
  const [draft, setDraft] = useState<EventDraft | null>(null);

  const setMode = useCallback(
    (m: UIMode) => {
      if (m === Modes.EDITOR && !canEdit) return;
      if (m === Modes.EDITOR && !can(Permissions.SWITCH_MODE)) return;
      setModeInternal(m);
      localStorage.setItem("opentp-mode", m);
      if (m === Modes.VIEWER) setDraft(null);
    },
    [canEdit, can],
  );

  const editEvent = useCallback(
    (event: TrackingEvent) => {
      if (mode !== Modes.EDITOR) return;
      setDraft({
        originalKey: event.key,
        key: event.key,
        taxonomy: { ...event.taxonomy },
        lifecycle: event.lifecycle ? { ...event.lifecycle } : undefined,
        aliases: event.aliases ? [...event.aliases] : undefined,
        payload: event.payload,
        isDirty: false,
      });
    },
    [mode],
  );

  const newEvent = useCallback(
    (baseSchema?: Record<string, Field>) => {
      if (mode !== Modes.EDITOR) return;
      // Auto-inject base fields that require a fixed value
      const schema: Record<string, Field> = {};
      if (baseSchema) {
        for (const [name, field] of Object.entries(baseSchema)) {
          if (field.valueRequired) {
            schema[name] = { ...field, value: "" };
          }
        }
      }
      setDraft({
        originalKey: null,
        key: "",
        taxonomy: {},
        payload: { schema },
        isDirty: false,
      });
    },
    [mode],
  );

  const updateDraft = useCallback((partial: Partial<EventDraft>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, ...partial, isDirty: true };
    });
  }, []);

  const discardDraft = useCallback(() => {
    setDraft(null);
  }, []);

  const markSaved = useCallback((newKey: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, originalKey: newKey, key: newKey, isDirty: false };
    });
  }, []);

  return {
    mode,
    setMode,
    canEdit,
    draft,
    editEvent,
    newEvent,
    updateDraft,
    discardDraft,
    markSaved,
  };
}
