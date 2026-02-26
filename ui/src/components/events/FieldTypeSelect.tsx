import { useMemo } from "react";
import { useT } from "../../i18n";
import { SelectInput } from "../common/FormField";

interface FieldTypeSelectProps {
  value: string;
  onChange: (type: string) => void;
}

export function FieldTypeSelect({ value, onChange }: FieldTypeSelectProps) {
  const { t } = useT();

  const fieldTypes = useMemo(() => [
    { value: "string", label: t("fieldType.string") },
    { value: "number", label: t("fieldType.number") },
    { value: "integer", label: t("fieldType.integer") },
    { value: "boolean", label: t("fieldType.boolean") },
    { value: "array", label: t("fieldType.array") },
  ], [t]);

  return (
    <SelectInput
      value={value || "string"}
      onChange={onChange}
      options={fieldTypes}
    />
  );
}
