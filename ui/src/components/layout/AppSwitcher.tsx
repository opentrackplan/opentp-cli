import { useCallback } from "react";
import { useCurrentApp } from "../../core/platform/useCurrentApp";
import { useDropdown } from "../../hooks/useDropdown";
import { useT } from "../../i18n";

export function AppSwitcher() {
  const { app, apps, switchApp } = useCurrentApp();
  const { t } = useT();

  const handleSelect = useCallback(
    (index: number) => {
      const selected = apps[index];
      if (selected) {
        switchApp(selected.id);
      }
    },
    [apps, switchApp],
  );

  const { isOpen, toggle, close, menuRef, buttonRef, activeIndex, onKeyDown } =
    useDropdown({ itemCount: apps.length, onSelect: handleSelect });

  // Hide when 0 or 1 app
  if (apps.length <= 1) return null;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        onKeyDown={onKeyDown}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-lg bg-surface-tertiary hover:bg-surface-hover border border-edge-primary text-content-primary transition-colors"
        aria-label={t("platform.app.switchApp")}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        {app?.icon && (
          <span className="shrink-0 text-sm">{app.icon}</span>
        )}
        <span className="truncate flex-1 text-left">{app?.name ?? t("platform.app.noApps")}</span>
        <svg
          className={`w-3.5 h-3.5 shrink-0 text-content-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 z-50 bg-surface-secondary border border-edge-primary rounded-lg shadow-lg overflow-hidden"
        >
          {apps.map((a, i) => {
            const isCurrent = a.id === app?.id;
            const isActive = i === activeIndex;
            return (
              <button
                key={a.id}
                type="button"
                role="option"
                aria-selected={isCurrent}
                onClick={() => {
                  switchApp(a.id);
                  close();
                }}
                className={`w-full text-left px-2.5 py-2 text-xs transition-colors flex items-center gap-2 ${
                  isCurrent
                    ? "bg-accent-blue-bg text-accent-blue"
                    : isActive
                      ? "bg-surface-hover text-content-primary"
                      : "text-content-secondary hover:bg-surface-hover hover:text-content-primary"
                }`}
              >
                {a.icon && (
                  <span className="shrink-0 text-sm">{a.icon}</span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate">{a.name}</div>
                  {a.description && (
                    <div className="truncate text-[10px] text-content-muted mt-0.5">{a.description}</div>
                  )}
                </div>
                {isCurrent && (
                  <svg className="w-3.5 h-3.5 shrink-0 text-accent-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
