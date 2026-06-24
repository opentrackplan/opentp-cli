import { useT } from "../../i18n";

interface PiiBadgeProps {
  kind?: string;
  masker?: string;
}

export function PiiBadge({ kind, masker }: PiiBadgeProps) {
  const { t } = useT();
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border bg-accent-amber-bg text-accent-amber border-accent-amber-border"
      title={masker ? t("pii.badgeTooltipMasker", { kind: kind ?? "", masker }) : t("pii.badgeTooltip", { kind: kind ?? "" })}
    >
      <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1a3 3 0 0 0-3 3v3H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1V4a3 3 0 0 0-3-3zm-1 3a1 1 0 0 1 2 0v3H7V4z" />
      </svg>
      {kind}
    </span>
  );
}
