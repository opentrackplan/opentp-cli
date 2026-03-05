import { useMemo } from "react";
import { useT } from "../../i18n";
import { FormField, SelectInput } from "../common/FormField";

interface LifecycleFormProps {
  status: "active" | "draft" | "deprecated";
  onChange: (status: "active" | "draft" | "deprecated") => void;
}

export function LifecycleForm({ status, onChange }: LifecycleFormProps) {
  const { t } = useT();

  const statusOptions = useMemo(() => [
    { value: "draft", label: t("lifecycle.draft") },
    { value: "active", label: t("lifecycle.active") },
    { value: "deprecated", label: t("lifecycle.deprecated") },
  ], [t]);

  return (
    <section>
      <h3 className="text-xs font-medium text-content-tertiary uppercase tracking-wider mb-3">
        {t("form.lifecycle")}
      </h3>
      <FormField label={t("form.status")}>
        <SelectInput
          value={status}
          onChange={(v) =>
            onChange(v as "active" | "draft" | "deprecated")
          }
          options={statusOptions}
        />
      </FormField>
    </section>
  );
}
