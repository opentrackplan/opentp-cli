import { useT } from "../../i18n";
import { Permissions } from "../../types/platform";
import { RoleGate } from "../../core/platform/RoleGate";
import type { DictionaryEntry } from "../../types";

interface DictionaryListProps {
  dictionaryMeta: Record<string, DictionaryEntry>;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onNew: () => void;
  onDelete: (key: string) => void;
  expanded?: boolean;
}

export function DictionaryList({
  dictionaryMeta,
  selectedKey,
  onSelect,
  onNew,
  onDelete,
  expanded,
}: DictionaryListProps) {
  const { t } = useT();
  const sortedKeys = Object.keys(dictionaryMeta).sort();

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-edge-primary flex items-center justify-between">
        <span className="text-sm text-content-secondary">
          {t("dict.countLabel", { count: sortedKeys.length })}
        </span>
        <button
          type="button"
          onClick={onNew}
          className="px-2 py-1 text-xs bg-accent-blue-bg hover:bg-surface-hover border border-accent-blue-border text-accent-blue rounded transition-colors"
        >
          {t("dict.new")}
        </button>
      </div>

      {sortedKeys.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-center px-4">
          <div>
            <p className="text-content-tertiary text-sm">{t("dict.empty")}</p>
            <p className="text-content-muted text-xs mt-1">
              {t("dict.emptyHint")}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {sortedKeys.map((key) => {
            const meta = dictionaryMeta[key];
            const isSelected = key === selectedKey;

            return expanded ? (
              <div
                key={key}
                onClick={() => onSelect(key)}
                className={`px-4 py-3 border-b border-edge-primary cursor-pointer group hover:bg-surface-hover transition-colors ${
                  isSelected ? "bg-surface-active" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono text-content-primary truncate">
                      {key}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-surface-tertiary border border-edge-secondary text-[10px] font-mono text-content-secondary">
                        {meta.type}
                      </span>
                      <span className="text-xs text-content-muted">
                        {meta.values.length} {t("meta.values")}
                      </span>
                    </div>
                    {meta.values.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {meta.values.slice(0, 8).map((v, i) => (
                          <span
                            key={i}
                            className="inline-flex px-1.5 py-0.5 bg-surface-tertiary border border-edge-primary rounded text-[10px] font-mono text-content-tertiary"
                          >
                            {String(v)}
                          </span>
                        ))}
                        {meta.values.length > 8 && (
                          <span className="text-[10px] text-content-muted py-0.5">
                            {t("eventList.more", { count: meta.values.length - 8 })}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <RoleGate action={Permissions.DELETE_DICTS}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(key);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-content-muted hover:text-accent-red text-xs p-1 transition-opacity"
                      title={t("dict.deleteTooltip")}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </RoleGate>
                </div>
              </div>
            ) : (
              <div
                key={key}
                onClick={() => onSelect(key)}
                className={`px-3 py-2.5 border-b border-edge-primary/50 cursor-pointer group hover:bg-surface-hover transition-colors ${
                  isSelected ? "bg-surface-active" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-content-primary truncate">
                      {key}
                    </p>
                    <p className="text-[10px] text-content-muted mt-0.5">
                      {meta.type} &middot; {meta.values.length} {t("meta.values")}
                    </p>
                  </div>
                  <RoleGate action={Permissions.DELETE_DICTS}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(key);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-content-muted hover:text-accent-red text-xs p-1 transition-opacity"
                      title={t("dict.deleteTooltip")}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </RoleGate>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
