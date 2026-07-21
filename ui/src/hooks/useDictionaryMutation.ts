import { useState, useCallback } from "react";
import type {
  DictionaryDraft,
  CreateDictionaryResult,
  UpdateDictionaryResult,
  DeleteDictionaryResult,
} from "../types";
import {
  createDictionary,
  updateDictionary,
  deleteDictionary,
} from "../api/mutations";

export type DictionaryMutationResult =
  | CreateDictionaryResult
  | UpdateDictionaryResult;

export interface UseDictionaryMutationResult {
  saving: boolean;
  deleting: boolean;
  error: string | null;
  save: (draft: DictionaryDraft) => Promise<DictionaryMutationResult | null>;
  remove: (key: string) => Promise<DeleteDictionaryResult | null>;
  clearError: () => void;
}

export function useDictionaryMutation(
  baseUrl: string,
): UseDictionaryMutationResult {
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (
      draft: DictionaryDraft,
    ): Promise<DictionaryMutationResult | null> => {
      setSaving(true);
      setError(null);
      try {
        return draft.originalKey === null
          ? await createDictionary(baseUrl, draft)
          : await updateDictionary(baseUrl, draft.originalKey, draft);
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
    async (key: string): Promise<DeleteDictionaryResult | null> => {
      setDeleting(true);
      setError(null);
      try {
        return await deleteDictionary(baseUrl, key);
      } catch (err) {
        setError((err as Error).message);
        return null;
      } finally {
        setDeleting(false);
      }
    },
    [baseUrl],
  );

  const clearError = useCallback(() => setError(null), []);

  return { saving, deleting, error, save, remove, clearError };
}
