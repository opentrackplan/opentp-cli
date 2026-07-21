import { useEffect, useState } from "react";
import type { Field } from "../../types";
import { useT } from "../../i18n";
import { FormField, TextInput } from "../common/FormField";
import { FieldTypeSelect } from "./FieldTypeSelect";
import { EnumEditor } from "./EnumEditor";
import { PiiEditor } from "./PiiEditor";

interface FieldEditorProps {
  name: string;
  field: Field;
  onChange: (name: string, field: Field) => void;
  onRemove: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
  dictionaries: Record<string, Array<string | number | boolean>>;
  isBaseField?: boolean;
}

export function FieldEditor({
  name,
  field,
  onChange,
  onRemove,
  onRename,
  dictionaries,
  isBaseField,
}: FieldEditorProps) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const [localName, setLocalName] = useState(name);

  useEffect(() => {
    setLocalName(name);
  }, [name]);

  const commitRename = () => {
    if (localName !== name) {
      onRename(name, localName);
    }
  };

  const isConstant = field.value !== undefined;
  const hasPii = !!field.pii;

  const update = (partial: Partial<Field>) => {
    onChange(name, { ...field, ...partial });
  };

  return (
    <div className="border border-edge-primary rounded-lg overflow-hidden">
      {/* Collapsed row */}
      <div
        className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-surface-input/50 ${
          expanded ? "bg-surface-input/50 border-b border-edge-primary" : ""
        }`}
        onClick={() => setExpanded(!expanded)}
      >
        <span
          className={`text-content-muted text-xs transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          ▶
        </span>

        <code className="text-sm font-mono text-content-primary min-w-[120px]">
          {name}
        </code>

        <div className="flex items-center gap-1.5 flex-1 justify-end">
          {isConstant && (
            <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-surface-active/50 text-content-secondary border border-edge-active/30">
              const = {JSON.stringify(field.value)}
            </span>
          )}
          {!isConstant && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-surface-tertiary text-content-tertiary">
              {field.type ?? "string"}
            </span>
          )}
          {field.required && !isConstant && (
            <span className="text-[10px] text-accent-red">{t("detail.required")}</span>
          )}
          {hasPii && (
            <span className="text-[10px] text-accent-amber">{t("pii.badge")}</span>
          )}
          {isBaseField && (
            <span className="text-[10px] text-content-muted">{t("field.baseBadge")}</span>
          )}
        </div>

        {!isBaseField && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove(name);
            }}
            className="text-content-muted hover:text-accent-red text-sm px-1"
            title={t("field.removeField")}
          >
            ×
          </button>
        )}
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div className="p-3 space-y-3 bg-surface-primary/50">
          <FormField label={t("field.name")} hint={t("field.nameHint")}>
            <TextInput
              value={localName}
              onChange={setLocalName}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
              }}
              mono
              disabled={isBaseField}
            />
          </FormField>

          <FormField label={t("field.description")}>
            <TextInput
              value={field.description ?? ""}
              onChange={(v) => update({ description: v || undefined })}
              placeholder={t("field.descriptionPlaceholder")}
            />
          </FormField>

          {/* Constant toggle */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isConstant}
                onChange={(e) => {
                  if (e.target.checked) {
                    update({
                      value: "",
                      type: undefined,
                      enum: undefined,
                      required: undefined,
                    });
                  } else {
                    const { value: _, ...rest } = field;
                    onChange(name, { ...rest, type: "string" });
                  }
                }}
                className="rounded border-edge-secondary bg-surface-input"
              />
              <span className="text-xs text-content-secondary">
                {t("field.constant")}
              </span>
            </label>
          </div>

          {isConstant ? (
            <FormField label={t("field.value")}>
              <TextInput
                value={String(field.value ?? "")}
                onChange={(v) => update({ value: v })}
                mono
                placeholder={t("field.valuePlaceholder")}
              />
            </FormField>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <FormField label={t("field.type")}>
                  <FieldTypeSelect
                    value={field.type ?? "string"}
                    onChange={(type) => {
                      const updates: Partial<Field> = {
                        type: type as Field["type"],
                      };
                      if (type !== field.type) updates.enum = undefined;
                      if (type === "array" && !field.items) {
                        updates.items = { type: "string" };
                      }
                      update(updates);
                    }}
                  />
                </FormField>

                <FormField label={t("field.required")}>
                  <label className="flex items-center gap-2 py-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={field.required ?? false}
                      onChange={(e) => update({ required: e.target.checked })}
                      className="rounded border-edge-secondary bg-surface-input"
                    />
                    <span className="text-xs text-content-secondary">
                      {t("field.requiredInPayload")}
                    </span>
                  </label>
                </FormField>
              </div>

              {field.type === "array" && (
                <FormField label={t("field.arrayItemType")}>
                  <FieldTypeSelect
                    value={field.items?.type ?? "string"}
                    onChange={(type) =>
                      update({
                        items: {
                          ...field.items,
                          type: type as Field["items"] extends
                            | { type: infer T }
                            | undefined
                            ? T
                            : never,
                        },
                      })
                    }
                  />
                </FormField>
              )}

              <FormField
                label={t("field.dictionary")}
                hint={t("field.dictionaryHint")}
              >
                <select
                  value={field.dict ?? ""}
                  onChange={(e) => {
                    const dict = e.target.value || undefined;
                    if (dict && dictionaries[dict]) {
                      update({
                        dict,
                        enum: [
                          ...dictionaries[dict],
                        ] as (string | number | boolean)[],
                      });
                    } else {
                      update({ dict });
                    }
                  }}
                  className="w-full px-3 py-2 bg-surface-input border border-edge-primary rounded-md text-sm text-content-primary focus:outline-none focus:border-edge-active"
                >
                  <option value="">{t("field.noDictionary")}</option>
                  {Object.keys(dictionaries).map((key) => (
                    <option key={key} value={key}>
                      {key} ({dictionaries[key].length} {t("meta.values")})
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField
                label={t("field.enumValues")}
                hint={t("field.enumHint")}
              >
                <EnumEditor
                  values={field.enum ?? []}
                  onChange={(values) =>
                    update({ enum: values.length ? values : undefined })
                  }
                  suggestions={
                    field.dict ? dictionaries[field.dict] : undefined
                  }
                  fieldType={field.type ?? "string"}
                />
              </FormField>

              <PiiEditor
                enabled={hasPii}
                kind={field.pii?.kind}
                masker={field.pii?.masker}
                onChange={(pii) => update({ pii: pii ?? undefined })}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
