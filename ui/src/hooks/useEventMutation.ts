import { useState, useCallback } from "react";
import type { EventDraft, ValidationResult, MutationResult, DeleteEventResult } from "../types";
import {
  createEvent,
  updateEvent,
  deleteEvent,
  validateDraft,
  eventDraftToYaml,
} from "../api/mutations";

export interface UseEventMutationResult {
  saving: boolean;
  validating: boolean;
  error: string | null;
  validationResult: ValidationResult | null;
  save: (draft: EventDraft) => Promise<MutationResult | null>;
  remove: (key: string) => Promise<DeleteEventResult | null>;
  validate: (draft: EventDraft) => Promise<ValidationResult | null>;
  download: (draft: EventDraft) => void;
  clearError: () => void;
  clearValidation: () => void;
}

export function useEventMutation(baseUrl: string): UseEventMutationResult {
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationResult, setValidationResult] =
    useState<ValidationResult | null>(null);

  const save = useCallback(
    async (draft: EventDraft): Promise<MutationResult | null> => {
      setSaving(true);
      setError(null);
      try {
        const result =
          draft.originalKey === null
            ? await createEvent(baseUrl, draft)
            : await updateEvent(baseUrl, draft.originalKey, draft);
        return result;
      } catch (err) {
        setError((err as Error).message);
        return null;
      } finally {
        setSaving(false);
      }
    },
    [baseUrl],
  );

  const remove = useCallback(
    async (key: string): Promise<DeleteEventResult | null> => {
      setSaving(true);
      setError(null);
      try {
        return await deleteEvent(baseUrl, key);
      } catch (err) {
        setError((err as Error).message);
        return null;
      } finally {
        setSaving(false);
      }
    },
    [baseUrl],
  );

  const validate = useCallback(
    async (draft: EventDraft): Promise<ValidationResult | null> => {
      setValidating(true);
      setError(null);
      try {
        // Always validate the current form state, not the disk file
        const result = await validateDraft(baseUrl, draft);
        setValidationResult(result);
        return result;
      } catch (err) {
        setError((err as Error).message);
        return null;
      } finally {
        setValidating(false);
      }
    },
    [baseUrl],
  );

  const download = useCallback((draft: EventDraft) => {
    const content = eventDraftToYaml(draft);
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = draft.key
      ? `${draft.key.replace(/::/g, "_")}.json`
      : "new-event.json";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const clearError = useCallback(() => setError(null), []);
  const clearValidation = useCallback(() => setValidationResult(null), []);

  return {
    saving,
    validating,
    error,
    validationResult,
    save,
    remove,
    validate,
    download,
    clearError,
    clearValidation,
  };
}
