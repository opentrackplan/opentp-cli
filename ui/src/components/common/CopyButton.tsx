import { useState } from "react";
import { useT } from "../../i18n";

interface CopyButtonProps {
  text: string;
  label?: string;
}

export function CopyButton({ text, label }: CopyButtonProps) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-content-tertiary hover:text-content-primary bg-surface-hover hover:bg-surface-tertiary rounded transition-colors"
    >
      {copied ? t("common.copied") : (label ?? t("common.copy"))}
    </button>
  );
}
