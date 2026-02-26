import { useT } from "../../i18n";
import type { DictionaryDraft } from "../../types";
import type { UseDictionaryMutationResult } from "../../hooks/useDictionaryMutation";
import { DictionaryEditor } from "./DictionaryEditor";

interface DictionaryPanelProps {
  draft: DictionaryDraft | null;
  mutation: UseDictionaryMutationResult;
  onSave: () => void;
  onDiscard: () => void;
  onDraftChange: (draft: DictionaryDraft) => void;
}

export function DictionaryPanel({
  draft,
  mutation,
  onSave,
  onDiscard,
  onDraftChange,
}: DictionaryPanelProps) {
  const { t } = useT();

  if (!draft) {
    return (
      <div className="flex items-center justify-center h-full text-content-tertiary text-sm">
        {t("dict.selectHint")}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="border-b border-edge-primary px-6 py-3 flex items-center justify-between bg-surface-primary">
        <span className="text-xs font-medium text-content-secondary">
          {draft.originalKey === null
            ? t("dict.newDict")
            : t("dict.editingDict", { key: draft.originalKey })}
        </span>
        <div className="flex items-center gap-2">
          {draft.isDirty && (
            <span className="text-[10px] text-accent-amber">{t("editor.unsavedChanges")}</span>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={
              mutation.saving ||
              !draft.key.trim() ||
              draft.values.length === 0
            }
            className="px-3 py-1.5 text-xs font-medium rounded bg-accent-blue text-white hover:bg-accent-blue/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {mutation.saving
              ? t("common.saving")
              : draft.originalKey === null
                ? t("common.create")
                : t("common.save")}
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="px-3 py-1.5 text-xs rounded text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary transition-colors"
          >
            {t("common.discard")}
          </button>
        </div>
      </div>

      {mutation.error && (
        <div className="mx-6 mt-3 px-3 py-2 bg-accent-red-bg border border-accent-red-border rounded text-xs text-accent-red">
          {mutation.error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6 max-w-2xl">
        <DictionaryEditor draft={draft} onChange={onDraftChange} />
      </div>
    </div>
  );
}
