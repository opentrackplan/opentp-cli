import { useCallback, useRef } from "react";
import type { Field } from "../../types";
import { useT } from "../../i18n";
import { FieldEditor } from "./FieldEditor";

interface PayloadEditorProps {
  schema: Record<string, Field>;
  onChange: (schema: Record<string, Field>) => void;
  dictionaries: Record<string, Array<string | number | boolean>>;
  baseSchema?: Record<string, Field>;
}

let nextStableId = 0;

export function PayloadEditor({
  schema,
  onChange,
  dictionaries,
  baseSchema,
}: PayloadEditorProps) {
  const { t } = useT();

  // Stable key map: field name → stable React key (persists through renames)
  const stableKeyMap = useRef(new Map<string, string>());

  const getStableKey = (name: string) => {
    if (!stableKeyMap.current.has(name)) {
      stableKeyMap.current.set(name, `field-${nextStableId++}`);
    }
    return stableKeyMap.current.get(name)!;
  };

  // Clean up keys for removed fields
  for (const key of stableKeyMap.current.keys()) {
    if (!(key in schema)) {
      stableKeyMap.current.delete(key);
    }
  }

  const handleFieldChange = useCallback(
    (name: string, field: Field) => {
      onChange({ ...schema, [name]: field });
    },
    [schema, onChange],
  );

  const handleFieldRemove = useCallback(
    (name: string) => {
      const next = { ...schema };
      delete next[name];
      onChange(next);
    },
    [schema, onChange],
  );

  const handleFieldRename = useCallback(
    (oldName: string, newName: string) => {
      const sanitized = newName.replace(/[^a-z0-9_]/gi, "_").toLowerCase().replace(/^_+|_+$/g, "");
      if (!sanitized || sanitized === oldName) return;
      if (schema[sanitized] && sanitized !== oldName) return;

      // Transfer stable key from old name to new name
      const existingKey = stableKeyMap.current.get(oldName);
      if (existingKey) {
        stableKeyMap.current.delete(oldName);
        stableKeyMap.current.set(sanitized, existingKey);
      }

      const next: Record<string, Field> = {};
      for (const [key, value] of Object.entries(schema)) {
        if (key === oldName) {
          next[sanitized] = value;
        } else {
          next[key] = value;
        }
      }
      onChange(next);
    },
    [schema, onChange],
  );

  const handleAddField = useCallback(() => {
    let name = "new_field";
    let counter = 1;
    while (schema[name]) {
      name = `new_field_${counter++}`;
    }
    onChange({
      ...schema,
      [name]: { type: "string", required: false },
    });
  }, [schema, onChange]);

  const baseFieldNames = new Set(Object.keys(baseSchema ?? {}));
  const allFields = Object.entries(schema);

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-content-tertiary uppercase tracking-wider">
          {t("form.payloadFields")}
          <span className="ml-2 text-content-muted normal-case tracking-normal">
            ({allFields.length} {t("form.fields")})
          </span>
        </h3>
        <button
          onClick={handleAddField}
          className="flex items-center gap-1 px-2 py-1 bg-surface-tertiary hover:bg-surface-active text-content-primary text-xs rounded transition-colors"
        >
          {t("form.addField")}
        </button>
      </div>

      <div className="space-y-2">
        {allFields.length === 0 && (
          <div className="text-center py-8 text-content-muted text-xs border border-dashed border-edge-primary rounded-lg">
            {t("form.noFieldsHint")}
          </div>
        )}

        {allFields.map(([name, field]) => (
          <FieldEditor
            key={getStableKey(name)}
            name={name}
            field={field}
            onChange={handleFieldChange}
            onRemove={handleFieldRemove}
            onRename={handleFieldRename}
            dictionaries={dictionaries}
            isBaseField={baseFieldNames.has(name)}
          />
        ))}
      </div>

      {baseSchema && Object.keys(baseSchema).length > 0 && (
        <p className="text-[10px] text-content-muted mt-3">
          {t("form.baseFieldHint")}
        </p>
      )}
    </section>
  );
}
