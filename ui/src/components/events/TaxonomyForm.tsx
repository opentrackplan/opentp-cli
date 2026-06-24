import { useState } from "react";
import type { ScalarType, TaxonomyField } from "../../types";
import { useT } from "../../i18n";
import { DictValueManager } from "../dictionaries/DictValueManager";
import { FormField, TextInput } from "../common/FormField";

interface TaxonomyFormProps {
  /** Taxonomy field definitions from config */
  taxonomyDefs: Record<string, TaxonomyField>;
  /** Current taxonomy values */
  values: Record<string, unknown>;
  /** Callback when any field changes */
  onChange: (key: string, value: string | number) => void;
  /** Validation errors by field name */
  errors: Record<string, string>;
  /** Dictionary values for fields with enums/suggestions */
  dictionaries?: Record<string, Array<string | number | boolean>>;
  /** Full dictionary metadata (type + values), needed for DictValueManager */
  dictionaryMeta?: Record<string, { type: ScalarType; values: Array<string | number | boolean> }>;
  /** API base URL. Null/undefined disables inline dict management */
  baseUrl?: string | null;
  /** Called after dictionary values change, to trigger data reload */
  onDictUpdated?: () => void;
  /** Toast function for notifications */
  addToast?: (type: "success" | "error", text: string) => void;
}

/**
 * Parse "1 = desc, 2 = desc, 3 = desc" style descriptions
 * into a map of value → label.
 */
function parseEnumDescriptions(
  enumValues: Array<string | number | boolean>,
  description?: string,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!description) return map;

  for (let i = 0; i < enumValues.length; i++) {
    const val = String(enumValues[i]);
    const pattern = new RegExp(
      // Escape special regex chars in the value, then look for "value = label"
      val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "\\s*[=–—-]\\s*(.+?)(?:,\\s*" +
        // Lookahead: next enum value or end of string
        (i < enumValues.length - 1
          ? String(enumValues[i + 1]).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          : "$") +
        ")",
    );
    const match = description.match(pattern);
    if (match?.[1]) {
      map.set(val, match[1].trim());
    }
  }
  return map;
}

/** Coerce a string value to the field's declared type. */
function coerceValue(raw: string, type: string): string | number {
  if ((type === "number" || type === "integer") && raw !== "") {
    const n = Number(raw);
    if (!Number.isNaN(n)) return n;
  }
  return raw;
}

export function TaxonomyForm({
  taxonomyDefs,
  values,
  onChange,
  errors,
  dictionaries,
  dictionaryMeta,
  baseUrl,
  onDictUpdated,
  addToast,
}: TaxonomyFormProps) {
  const { t } = useT();
  const fields = Object.entries(taxonomyDefs);
  // Track which dict-linked fields are in "custom value" mode
  const [customMode, setCustomMode] = useState<Record<string, boolean>>({});
  // Track which dict-linked fields have the manage panel open
  const [manageMode, setManageMode] = useState<Record<string, boolean>>({});

  return (
    <section>
      <h3 className="text-xs font-medium text-content-tertiary uppercase tracking-wider mb-3">
        {t("form.taxonomy")}
      </h3>
      <div className="grid gap-3">
        {fields.map(([key, def]) => {
          const dictValues = def.dict ? dictionaries?.[def.dict] : undefined;
          const hasDict = dictValues && dictValues.length > 0;
          const hasEnum = def.enum && def.enum.length > 0;
          const val = values[key] ?? "";
          const strVal = String(val);
          const isCustom = customMode[key] ?? false;

          // Dict-linked field → select (or text input in custom mode)
          if (hasDict && !isCustom) {
            const dictMeta = def.dict ? dictionaryMeta?.[def.dict] : undefined;
            const canManage = !!baseUrl && !!dictMeta && !!onDictUpdated && !!addToast;
            const isManaging = manageMode[key] ?? false;

            return (
              <FormField
                key={key}
                label={def.title ?? key}
                required={def.required}
                error={errors[key]}
                hint={def.description}
              >
                <div className="flex gap-1.5">
                  <select
                    value={strVal}
                    onChange={(e) => onChange(key, coerceValue(e.target.value, def.type))}
                    className="flex-1 px-3 py-2 pr-8 bg-surface-input border border-edge-primary rounded-md text-sm text-content-primary focus:outline-none focus:border-edge-secondary font-mono"
                  >
                    {!def.required && (
                      <option value="">{t("form.enterField", { field: def.title ?? key })}</option>
                    )}
                    {!strVal && def.required && (
                      <option value="" disabled>
                        {t("form.enterField", { field: def.title ?? key })}
                      </option>
                    )}
                    {dictValues.map((s) => (
                      <option key={String(s)} value={String(s)}>
                        {String(s)}
                      </option>
                    ))}
                    {/* Show current value even if not in dict (e.g. editing existing event) */}
                    {strVal && !dictValues.some((s) => String(s) === strVal) && (
                      <option value={strVal}>{strVal}</option>
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={() => setCustomMode((prev) => ({ ...prev, [key]: true }))}
                    title={t("form.addCustomValue")}
                    className="px-2 py-2 bg-surface-tertiary hover:bg-surface-active border border-edge-primary rounded-md text-sm text-content-secondary transition-colors"
                  >
                    +
                  </button>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => setManageMode((prev) => ({ ...prev, [key]: !prev[key] }))}
                      title={t("dictInline.manage")}
                      className={`px-2 py-2 border border-edge-primary rounded-md text-sm transition-colors ${
                        isManaging
                          ? "bg-surface-active text-content-primary"
                          : "bg-surface-tertiary hover:bg-surface-active text-content-secondary"
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </button>
                  )}
                </div>
                {canManage && isManaging && (
                  <DictValueManager
                    dictKey={def.dict!}
                    values={dictMeta.values}
                    dictType={dictMeta.type}
                    baseUrl={baseUrl!}
                    onDictUpdated={onDictUpdated}
                    onValueAdded={(val) => onChange(key, coerceValue(String(val), def.type))}
                    addToast={addToast}
                  />
                )}
              </FormField>
            );
          }

          // Dict field in custom mode → text input with back button
          if (hasDict && isCustom) {
            return (
              <FormField
                key={key}
                label={def.title ?? key}
                required={def.required}
                error={errors[key]}
                hint={def.description}
              >
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={strVal}
                    onChange={(e) => onChange(key, e.target.value)}
                    placeholder={t("form.enterField", { field: def.title ?? key })}
                    className="flex-1 px-3 py-2 bg-surface-input border border-edge-primary rounded-md text-sm text-content-primary placeholder:text-content-muted focus:outline-none focus:border-edge-secondary font-mono"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setCustomMode((prev) => ({ ...prev, [key]: false }))}
                    className="px-2 py-2 bg-surface-tertiary hover:bg-surface-active border border-edge-primary rounded-md text-xs text-content-secondary transition-colors"
                  >
                    &larr;
                  </button>
                </div>
              </FormField>
            );
          }

          // Enum field → select with description labels
          if (hasEnum) {
            const enumDescs = parseEnumDescriptions(def.enum!, def.description);

            return (
              <FormField
                key={key}
                label={def.title ?? key}
                required={def.required}
                error={errors[key]}
              >
                <select
                  value={strVal}
                  onChange={(e) => onChange(key, coerceValue(e.target.value, def.type))}
                  className="w-full px-3 py-2 pr-8 bg-surface-input border border-edge-primary rounded-md text-sm text-content-primary focus:outline-none focus:border-edge-secondary font-mono"
                >
                  {!def.required && <option value="">{t("form.noneSelected")}</option>}
                  {!strVal && def.required && (
                    <option value="" disabled>
                      {t("form.enterField", { field: def.title ?? key })}
                    </option>
                  )}
                  {def.enum!.map((v) => {
                    const sv = String(v);
                    const desc = enumDescs.get(sv);
                    return (
                      <option key={sv} value={sv}>
                        {desc ? `${sv} — ${desc}` : sv}
                      </option>
                    );
                  })}
                </select>
              </FormField>
            );
          }

          // Default: plain text input
          return (
            <FormField
              key={key}
              label={def.title ?? key}
              required={def.required}
              error={errors[key]}
              hint={def.description}
            >
              <TextInput
                value={strVal}
                onChange={(v) => onChange(key, v)}
                placeholder={t("form.enterField", { field: def.title ?? key })}
                mono
              />
            </FormField>
          );
        })}
      </div>
    </section>
  );
}
