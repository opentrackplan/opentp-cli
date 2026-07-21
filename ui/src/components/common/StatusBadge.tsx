import { useT } from "../../i18n";

const STATUS_STYLES = {
  active: "bg-accent-green-bg text-accent-green border-accent-green-border",
  draft: "bg-accent-amber-bg text-accent-amber border-accent-amber-border",
  deprecated: "bg-accent-red-bg text-accent-red border-accent-red-border",
} as const;

interface StatusBadgeProps {
  status?: "active" | "draft" | "deprecated";
}

export function StatusBadge({ status = "active" }: StatusBadgeProps) {
  const { t } = useT();
  const key = `status.${status}` as const;

  return (
    <span
      className={`inline-flex px-1.5 py-0.5 text-[10px] font-medium rounded border ${STATUS_STYLES[status]}`}
    >
      {t(key)}
    </span>
  );
}
