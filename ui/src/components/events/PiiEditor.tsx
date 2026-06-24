import { useMemo } from "react";
import { useT } from "../../i18n";
import { FormField, SelectInput } from "../common/FormField";

interface PiiEditorProps {
  enabled: boolean;
  kind?: string;
  masker?: string;
  onChange: (pii: { kind: string; masker: string } | null) => void;
}

export function PiiEditor({
  enabled,
  kind,
  masker,
  onChange,
}: PiiEditorProps) {
  const { t } = useT();

  const maskerOptions = useMemo(() => [
    { value: "", label: t("pii.maskerNone") },
    { value: "star", label: t("pii.maskerStar") },
    { value: "hash", label: t("pii.maskerHash") },
    { value: "redact", label: t("pii.maskerRedact") },
  ], [t]);

  const piiKinds = useMemo(() => [
    { value: "user_id", label: t("pii.kindUserId") },
    { value: "email", label: t("pii.kindEmail") },
    { value: "phone", label: t("pii.kindPhone") },
    { value: "name", label: t("pii.kindName") },
    { value: "address", label: t("pii.kindAddress") },
    { value: "ip_address", label: t("pii.kindIpAddress") },
    { value: "device_id", label: t("pii.kindDeviceId") },
    { value: "other", label: t("pii.kindOther") },
  ], [t]);

  const handleToggle = () => {
    if (enabled) {
      onChange(null);
    } else {
      onChange({ kind: "user_id", masker: "" });
    }
  };

  return (
    <div className="border border-accent-amber-border rounded-lg p-3 bg-accent-amber-bg">
      <label className="flex items-center gap-2 cursor-pointer mb-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={handleToggle}
          className="rounded border-edge-secondary bg-surface-input"
        />
        <span className="text-xs font-medium text-accent-amber">
          {t("pii.label")}
        </span>
      </label>

      {enabled && (
        <div className="grid grid-cols-2 gap-3 mt-2">
          <FormField label={t("pii.kind")}>
            <SelectInput
              value={kind ?? "user_id"}
              onChange={(v) => onChange({ kind: v, masker: masker ?? "" })}
              options={piiKinds}
            />
          </FormField>
          <FormField label={t("pii.masker")}>
            <SelectInput
              value={masker ?? ""}
              onChange={(v) =>
                onChange({ kind: kind ?? "user_id", masker: v })
              }
              options={maskerOptions}
            />
          </FormField>
        </div>
      )}
    </div>
  );
}
