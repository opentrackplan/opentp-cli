import { useState } from "react";
import type { DictionaryDraft, ScalarType } from "../../types";
import { useT } from "../../i18n";
import { FormField, TextInput, SelectInput } from "../common/FormField";
import { EnumEditor } from "../events/EnumEditor";

interface DictionaryEditorProps {
  draft: DictionaryDraft;
  onChange: (draft: DictionaryDraft) => void;
}

const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "string", label: "string" },
  { value: "number", label: "number" },
  { value: "integer", label: "integer" },
];

/** Sanitize a dictionary key: lowercase, replace invalid chars with underscores, trim edges. */
function sanitizeDictKey(raw: string): string {
  return raw
    .replace(/[^a-z0-9_/-]/gi, "_")
    .toLowerCase()
    .replace(/^[_/-]+|[_/-]+$/g, "");
}

export function DictionaryEditor({ draft, onChange }: DictionaryEditorProps) {
  const { t } = useT();
  const [keyError, setKeyError] = useState<string | undefined>();

  const update = (partial: Partial<DictionaryDraft>) => {
    onChange({ ...draft, ...partial, isDirty: true });
  };

  const validateKey = (key: string): string | undefined => {
    if (!key.trim()) return t("dictEditor.keyRequired");
    if (key.startsWith("/")) return t("dictEditor.keyNoSlashPrefix");
    if (key.includes("..")) return t("dictEditor.keyNoDotDot");
    return undefined;
  };

  const handleKeyChange = (value: string) => {
    setKeyError(validateKey(value));
    update({ key: value });
  };

  const handleKeyBlur = () => {
    if (!draft.key.trim()) return;
    const sanitized = sanitizeDictKey(draft.key);
    if (sanitized !== draft.key) {
      setKeyError(validateKey(sanitized));
      update({ key: sanitized });
    }
  };

  const handleTypeChange = (type: string) => {
    update({ type: type as ScalarType, values: [] });
  };

  return (
    <div className="space-y-4">
      <FormField
        label={t("dictEditor.keyLabel")}
        required
        error={keyError}
        hint={t("dictEditor.keyHint")}
      >
        <TextInput
          value={draft.key}
          onChange={handleKeyChange}
          onBlur={handleKeyBlur}
          placeholder={t("dictEditor.keyPlaceholder")}
          mono
        />
      </FormField>

      <FormField label={t("dictEditor.valueType")} required>
        <SelectInput
          value={draft.type}
          onChange={handleTypeChange}
          options={TYPE_OPTIONS}
        />
      </FormField>

      <FormField
        label={t("dictEditor.values")}
        required
        hint={t("dictEditor.valuesHint")}
      >
        <EnumEditor
          values={draft.values}
          onChange={(values) => update({ values })}
          fieldType={draft.type}
        />
      </FormField>
    </div>
  );
}
