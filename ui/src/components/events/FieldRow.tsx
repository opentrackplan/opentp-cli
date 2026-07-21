import type { Field } from "../../types";
import { useT } from "../../i18n";
import { TypeBadge } from "../common/TypeBadge";
import { PiiBadge } from "../common/PiiBadge";

interface FieldRowProps {
  name: string;
  field: Field;
  isConstant: boolean;
}

export function FieldRow({ name, field, isConstant }: FieldRowProps) {
  const { t } = useT();
  const isRequired = field.required === true;

  return (
    <div
      className={`grid grid-cols-[1fr_auto_1fr] gap-3 items-start py-2.5 px-3 rounded ${
        isConstant ? "bg-surface-tertiary/30" : ""
      }`}
    >
      {/* Field name + required indicator */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <code className="text-sm font-mono text-content-primary">{name}</code>
          {isRequired && !isConstant && (
            <span className="text-accent-red text-[10px]">*{t("detail.required")}</span>
          )}
        </div>
        {field.description && (
          <p className="text-[11px] text-content-tertiary mt-0.5">
            {field.description}
          </p>
        )}
      </div>

      {/* Type + badges */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {isConstant ? (
          <span className="inline-flex px-1.5 py-0.5 text-[10px] font-mono rounded border bg-surface-active/50 text-content-secondary border-edge-active/30">
            {t("field.const")}
          </span>
        ) : (
          <TypeBadge type={field.type} />
        )}
        {field.pii && (
          <PiiBadge kind={field.pii.kind} masker={field.pii.masker} />
        )}
        {field.dict && (
          <span
            className="text-[10px] text-content-tertiary"
            title={t("field.dictionaryTooltip", { key: field.dict })}
          >
            {t("field.dictBadge")}
          </span>
        )}
      </div>

      {/* Value / enum / array info */}
      <div className="text-right min-w-0">
        {isConstant && field.value !== undefined && (
          <code className="text-xs text-accent-green/80 font-mono">
            {JSON.stringify(field.value)}
          </code>
        )}
        {!isConstant && field.enum && field.enum.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1">
            {field.enum.map((v, i) => (
              <span
                key={i}
                className="px-1.5 py-0.5 bg-surface-tertiary rounded text-[10px] font-mono text-content-secondary"
              >
                {String(v)}
              </span>
            ))}
          </div>
        )}
        {!isConstant && field.type === "array" && field.items && (
          <span className="text-[10px] text-content-tertiary font-mono">
            {field.items.type}[]
            {field.items.enum && ` (${field.items.enum.length} ${t("meta.values")})`}
          </span>
        )}
      </div>
    </div>
  );
}
