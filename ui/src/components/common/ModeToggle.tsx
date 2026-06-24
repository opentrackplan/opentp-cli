import { useT } from "../../i18n";
import { Modes } from "../../types";
import type { UIMode } from "../../types";

interface ModeToggleProps {
  mode: UIMode;
  canEdit: boolean;
  onModeChange: (mode: UIMode) => void;
}

export function ModeToggle({ mode, canEdit, onModeChange }: ModeToggleProps) {
  const { t } = useT();

  return (
    <div className="flex items-center bg-surface-input rounded-lg p-0.5 border border-edge-primary">
      <button
        onClick={() => onModeChange(Modes.VIEWER)}
        className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${
          mode === Modes.VIEWER
            ? "bg-surface-tertiary text-content-primary shadow-sm"
            : "text-content-tertiary hover:text-content-secondary"
        }`}
      >
        {t("mode.viewer")}
      </button>
      <button
        onClick={() => onModeChange(Modes.EDITOR)}
        disabled={!canEdit}
        title={!canEdit ? t("mode.editorRequiresApi") : undefined}
        className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${
          mode === Modes.EDITOR
            ? "bg-surface-tertiary text-content-primary shadow-sm"
            : canEdit
              ? "text-content-tertiary hover:text-content-secondary"
              : "text-content-muted cursor-not-allowed"
        }`}
      >
        {t("mode.editor")}
      </button>
    </div>
  );
}
