import type { EventDraft, ValidationResult } from "../../types";
import { Permissions } from "../../types/platform";
import { RoleGate } from "../../core/platform/RoleGate";
import { useBranding } from "../../core/platform/useBranding";
import { useT } from "../../i18n";

interface EditorToolbarProps {
  draft: EventDraft;
  saving: boolean;
  validating: boolean;
  error: string | null;
  validationResult: ValidationResult | null;
  onSave: () => void;
  onDownload: () => void;
  onValidate: () => void;
  onDiscard: () => void;
  onDelete?: () => void;
  onClearError: () => void;
}

export function EditorToolbar({
  draft,
  saving,
  validating,
  error,
  validationResult,
  onSave,
  onDownload,
  onValidate,
  onDiscard,
  onDelete,
  onClearError,
}: EditorToolbarProps) {
  const { t } = useT();
  const { accentClasses } = useBranding();
  const isNew = draft.originalKey === null;
  const canSave = draft.key.trim().length > 0;

  return (
    <div className="border-b border-edge-primary bg-surface-primary px-6 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-content-secondary">
            {isNew ? t("editor.newEvent") : t("editor.editing")}
          </span>
          {draft.isDirty && (
            <span className="text-[10px] text-accent-amber">
              {t("editor.unsavedChanges")}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onSave}
            disabled={saving || !canSave}
            className={`px-3 py-1.5 text-xs font-medium rounded ${accentClasses.bg} text-white ${accentClasses.hover} disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
          >
            {saving ? t("common.saving") : isNew ? t("common.create") : t("common.save")}
          </button>

          <button
            onClick={onDownload}
            className="px-3 py-1.5 text-xs rounded bg-surface-tertiary text-content-primary hover:bg-surface-active transition-colors"
          >
            {t("common.download")}
          </button>

          <button
            onClick={onValidate}
            disabled={validating}
            className="px-3 py-1.5 text-xs rounded bg-surface-tertiary text-content-primary hover:bg-surface-active disabled:opacity-50 transition-colors"
          >
            {validating ? t("common.validating") : t("common.validate")}
          </button>

          {!isNew && onDelete && (
            <RoleGate action={Permissions.DELETE_EVENT}>
              <button
                onClick={onDelete}
                disabled={saving}
                className="px-3 py-1.5 text-xs rounded text-accent-red hover:bg-accent-red-bg disabled:opacity-50 transition-colors"
              >
                {t("common.delete")}
              </button>
            </RoleGate>
          )}

          <button
            onClick={onDiscard}
            className="px-3 py-1.5 text-xs rounded text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary transition-colors"
          >
            {t("common.discard")}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-2 flex items-center justify-between bg-accent-red-bg border border-accent-red-border rounded px-3 py-2">
          <span className="text-xs text-accent-red">{error}</span>
          <button
            onClick={onClearError}
            className="text-xs text-accent-red hover:text-accent-red/80 ml-2"
          >
            {t("editor.dismiss")}
          </button>
        </div>
      )}

      {validationResult && !error && (
        <div
          className={`mt-2 rounded px-3 py-2 text-xs border ${
            validationResult.valid
              ? "bg-accent-green-bg border-accent-green-border text-accent-green"
              : "bg-accent-red-bg border-accent-red-border text-accent-red"
          }`}
        >
          <div>
            {validationResult.valid
              ? t("validation.passed")
              : t("validation.errors", {
                  errors: validationResult.errorCount,
                  errorPlural: validationResult.errorCount !== 1 ? "s" : "",
                  warnings: validationResult.warningCount,
                  warningPlural: validationResult.warningCount !== 1 ? "s" : "",
                })}
          </div>
          {!validationResult.valid && validationResult.events && (
            <ul className="mt-1.5 space-y-0.5 list-none">
              {Object.entries(validationResult.events).flatMap(
                ([eventKey, { errors, warnings }]) => [
                  ...errors.map((err, i) => (
                    <li key={`e-${eventKey}-${i}`} className="flex gap-1.5">
                      <span className="shrink-0">{t("validation.errorPrefix")}</span>
                      <span>
                        {err.path && (
                          <span className="opacity-70">{err.path}: </span>
                        )}
                        {err.message}
                      </span>
                    </li>
                  )),
                  ...warnings.map((warn, i) => (
                    <li key={`w-${eventKey}-${i}`} className="flex gap-1.5 text-accent-amber">
                      <span className="shrink-0">{t("validation.warningPrefix")}</span>
                      <span>
                        {warn.path && (
                          <span className="opacity-70">{warn.path}: </span>
                        )}
                        {warn.message}
                      </span>
                    </li>
                  )),
                ],
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
