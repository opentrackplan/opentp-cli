import { useT } from "../../i18n";

interface KeyPreviewProps {
  /** Template from config, e.g. "{area}/{event}.yaml" */
  template: string;
  /** Current taxonomy values */
  taxonomy: Record<string, unknown>;
  /** Separator used in keys, e.g. "::" */
  keySeparator?: string;
}

export function KeyPreview({
  template,
  taxonomy,
  keySeparator = "::",
}: KeyPreviewProps) {
  const { t } = useT();
  // Extract field names from template: "{area}/{event}.yaml" → ["area", "event"]
  const fieldNames: string[] = [];
  template.replace(/\{(\w+)\}/g, (_, name: string) => {
    fieldNames.push(name);
    return "";
  });

  // Build key from taxonomy values
  const keyParts = fieldNames
    .map((name) => String(taxonomy[name] ?? ""))
    .filter(Boolean);

  const key = keyParts.join(keySeparator);
  const isComplete = fieldNames.every(
    (name) => String(taxonomy[name] ?? "").trim() !== "",
  );

  // Build file path from template
  let filePath = template;
  for (const name of fieldNames) {
    const val = String(taxonomy[name] ?? "");
    filePath = filePath.replace(`{${name}}`, val || `{${name}}`);
  }

  return (
    <section>
      <h3 className="text-xs font-medium text-content-tertiary uppercase tracking-wider mb-2">
        {t("form.eventKey")}
      </h3>
      <div className="bg-surface-input border border-edge-primary rounded-lg p-3">
        <div className="flex items-center gap-2 mb-1">
          <code
            className={`text-sm font-mono ${isComplete ? "text-content-primary" : "text-content-tertiary"}`}
          >
            {key || t("form.eventKeyHint")}
          </code>
          {isComplete && (
            <span
              className="w-1.5 h-1.5 bg-accent-green rounded-full"
              title={t("form.keyComplete")}
            />
          )}
        </div>
        <p className="text-[11px] text-content-muted font-mono">
          {t("meta.file")} events/{filePath}
        </p>
      </div>
    </section>
  );
}
