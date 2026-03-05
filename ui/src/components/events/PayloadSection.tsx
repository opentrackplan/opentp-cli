import type { Field } from "../../types";
import { useT } from "../../i18n";
import { FieldRow } from "./FieldRow";

interface PayloadSectionProps {
  schema: Record<string, Field>;
}

export function PayloadSection({ schema }: PayloadSectionProps) {
  const { t } = useT();
  const entries = Object.entries(schema);
  if (entries.length === 0) {
    return <p className="text-xs text-content-muted">{t("detail.noPayload")}</p>;
  }

  // Split into params and constants, with params first
  const params = entries.filter(([, f]) => f.value === undefined);
  const constants = entries.filter(([, f]) => f.value !== undefined);

  // Sort: required first within params
  params.sort(([, a], [, b]) => {
    if (a.required && !b.required) return -1;
    if (!a.required && b.required) return 1;
    return 0;
  });

  const requiredCount = params.filter(([, f]) => f.required).length;
  const optionalCount = params.filter(([, f]) => !f.required).length;

  return (
    <section>
      {/* Params */}
      {params.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-medium text-content-tertiary uppercase tracking-wider mb-2">
            {t("detail.parameters")}
            <span className="ml-2 text-content-muted normal-case tracking-normal">
              ({t("detail.requiredCount", { required: requiredCount, optional: optionalCount })})
            </span>
          </h3>
          <div className="divide-y divide-edge-primary border border-edge-primary rounded-lg overflow-hidden">
            {params.map(([name, field]) => (
              <FieldRow key={name} name={name} field={field} isConstant={false} />
            ))}
          </div>
        </div>
      )}

      {/* Constants */}
      {constants.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-content-tertiary uppercase tracking-wider mb-2">
            {t("detail.constants")}
            <span className="ml-2 text-content-muted normal-case tracking-normal">
              ({t("detail.constantsHint")})
            </span>
          </h3>
          <div className="divide-y divide-edge-primary border border-edge-primary rounded-lg overflow-hidden">
            {constants.map(([name, field]) => (
              <FieldRow key={name} name={name} field={field} isConstant={true} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
