import { useT } from "../../i18n";

interface TaxonomySectionProps {
  taxonomy: Record<string, unknown>;
}

export function TaxonomySection({ taxonomy }: TaxonomySectionProps) {
  const { t } = useT();
  const entries = Object.entries(taxonomy);
  if (entries.length === 0) return null;

  return (
    <section>
      <h3 className="text-xs font-medium text-content-tertiary uppercase tracking-wider mb-2">
        {t("detail.taxonomy")}
      </h3>
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {entries.map(([key, value]) => (
          <div key={key} className="contents">
            <span className="text-xs text-content-tertiary font-mono">{key}</span>
            <span className="text-sm text-content-primary">{String(value)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
