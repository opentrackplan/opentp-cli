import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import { useGenerators } from "../../hooks/useGenerators";
import { useGenerateDownload } from "../../hooks/useGenerateDownload";

interface ExportPanelProps {
  baseUrl: string;
  onError?: (message: string) => void;
}

const EXTENSION_HINTS: Record<string, string> = {
  "ts-sdk": ".ts",
  "swift-sdk": ".swift",
  "kotlin-sdk": ".kt",
  json: ".json",
  yaml: ".yaml",
};

export function ExportPanel({ baseUrl, onError }: ExportPanelProps) {
  const { t } = useT();
  const [collapsed, setCollapsed] = useState(false);

  const generatorLabels: Record<string, string> = {
    "ts-sdk": t("export.generatorTsSdk"),
    "swift-sdk": t("export.generatorSwiftSdk"),
    "kotlin-sdk": t("export.generatorKotlinSdk"),
    json: t("export.generatorJson"),
    yaml: t("export.generatorYaml"),
    template: t("export.generatorTemplate"),
  };

  const targetLabels: Record<string, string> = {
    web: t("export.targetWeb"),
    ios: t("export.targetIos"),
    android: t("export.targetAndroid"),
  };
  const { generators, bundleEnabled, loading, error: fetchError } = useGenerators(baseUrl);
  const { downloading, error: downloadError, download, downloadBundle } = useGenerateDownload(baseUrl);

  // Report download errors via callback (in useEffect to avoid render-loop)
  useEffect(() => {
    if (downloadError && onError) {
      onError(downloadError);
    }
  }, [downloadError, onError]);

  if (loading) {
    return (
      <div className="border-t border-edge-primary p-3">
        <p className="text-xs text-content-tertiary">{t("export.loading")}</p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="border-t border-edge-primary p-3">
        <p className="text-xs text-accent-red">{fetchError}</p>
      </div>
    );
  }

  if (generators.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-edge-primary">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-surface-hover/50 transition-colors"
      >
        <h3 className="text-[11px] font-medium text-content-secondary uppercase tracking-wider">
          {t("export.title")}
        </h3>
        <svg
          className={`w-3 h-3 text-content-muted transition-transform ${collapsed ? "" : "rotate-180"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-1.5">
          {generators.map((gen) => (
            <button
              key={gen.name}
              type="button"
              onClick={() => download(gen.name, gen.target)}
              disabled={downloading}
              className="w-full flex items-center justify-between px-2.5 py-2 text-xs rounded-lg bg-surface-tertiary hover:bg-surface-hover border border-edge-primary text-content-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="flex items-center gap-1.5">
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                  />
                </svg>
                {generatorLabels[gen.name] ?? gen.name}
              </span>
              <span className="flex items-center gap-1.5">
                {gen.target && (
                  <span className="text-[10px] text-content-muted" data-testid={`target-${gen.name}`}>
                    {targetLabels[gen.target] ?? gen.target}
                  </span>
                )}
                {EXTENSION_HINTS[gen.name] && (
                  <span className="text-[10px] text-content-muted font-mono">
                    {EXTENSION_HINTS[gen.name]}
                  </span>
                )}
              </span>
            </button>
          ))}

          {bundleEnabled && (
            <button
              type="button"
              onClick={downloadBundle}
              disabled={downloading}
              className="w-full flex items-center justify-between px-2.5 py-2 text-xs rounded-lg bg-accent-blue-bg hover:bg-accent-blue-bg/80 border border-accent-blue-border text-accent-blue transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="flex items-center gap-1.5">
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
                  />
                </svg>
                {t("export.bundle")}
              </span>
              <span className="text-[10px] font-mono">.zip</span>
            </button>
          )}

          {downloading && (
            <p className="text-[10px] text-content-muted animate-pulse">
              {t("export.downloading")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
