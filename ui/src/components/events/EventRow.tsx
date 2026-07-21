import { useT } from "../../i18n";
import type { TrackingEvent, Field } from "../../types";
import { StatusBadge } from "../common/StatusBadge";
import { CopyButton } from "../common/CopyButton";
import {
  getPayloadSchema,
  countParams,
  countConstants,
  hasPii,
  buildSdkExample,
} from "../../lib/payload";
import { getAreaTextClass } from "../../utils/areaColors";

interface EventRowProps {
  event: TrackingEvent;
  selected: boolean;
  onClick: () => void;
  highlightFields?: Set<string>;
}

export function EventRow({ event, onClick, selected, highlightFields }: EventRowProps) {
  const { t } = useT();
  const [area, eventName] = event.key.split("::");
  const status = event.lifecycle?.status;
  const action = event.taxonomy?.action as string | undefined;

  const schema = getPayloadSchema(event.payload);
  const params = countParams(schema);
  const constants = countConstants(schema);
  const pii = hasPii(schema);

  const fields = Object.entries(schema);
  const sdkExample = buildSdkExample(area, eventName, schema);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className={`group w-full text-left px-4 py-3 border-b transition-colors cursor-pointer ${
        selected
          ? "bg-accent-blue-bg border-accent-blue-border"
          : "border-edge-primary hover:bg-surface-input"
      } ${status === "deprecated" ? "opacity-60" : ""}`}
    >
      {/* Line 1: taxonomy breadcrumb */}
      <p className="text-sm font-medium">
        <span className={`font-medium ${getAreaTextClass(area)}`}>{area}</span>
        <span className="text-content-muted"> / </span>
        <span className="text-content-primary">{eventName}</span>
      </p>

      {/* Line 2: action description */}
      {action && (
        <p className="text-xs text-content-tertiary truncate mt-0.5">{action}</p>
      )}

      {/* Line 3: badges + hover copy */}
      <div className="flex items-center gap-2 mt-1.5">
        <StatusBadge status={status} />
        {params > 0 && (
          <span className="text-[11px] text-content-muted">
            {params} {t("eventList.params")}
          </span>
        )}
        {constants > 0 && (
          <span className="text-[11px] text-content-muted">
            {constants} {t("eventList.constants")}
          </span>
        )}
        {pii && <span className="text-[11px] text-accent-amber/70">{t("pii.badge")}</span>}

        {/* Copy SDK — hover only */}
        <span
          className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <CopyButton text={sdkExample} />
        </span>
      </div>

      {/* Payload mini-table */}
      {fields.length > 0 && (
        <PayloadMiniTable fields={fields} highlightFields={highlightFields} />
      )}
    </div>
  );
}

function PayloadMiniTable({
  fields,
  highlightFields,
}: {
  fields: Array<[string, Field]>;
  highlightFields?: Set<string>;
}) {
  const visible = fields.slice(0, 6);
  const overflow = fields.length - visible.length;

  return (
    <div className="grid auto-cols-fr grid-flow-col mt-2 border border-edge-primary/50 rounded overflow-hidden text-[11px]">
      {visible.map(([name, field]) => {
        const isConst = field.value !== undefined;
        const highlighted = highlightFields?.has(name);
        return (
          <div
            key={name}
            className="border-r border-edge-primary/50 last:border-r-0 min-w-0"
          >
            <div
              className={`px-2 py-1 border-b border-edge-primary/50 font-mono truncate ${
                highlighted
                  ? "text-accent-blue bg-accent-blue-bg"
                  : "text-content-secondary"
              }`}
            >
              {name}
              {!isConst && field.required && "*"}
            </div>
            <div
              className={`px-2 py-1 font-mono truncate ${
                isConst ? "text-accent-green" : "text-content-tertiary"
              }`}
            >
              {isConst
                ? JSON.stringify(field.value)
                : field.enum || field.dict
                  ? "enum"
                  : (field.type ?? "string")}
            </div>
          </div>
        );
      })}
      {overflow > 0 && (
        <div className="flex items-center justify-center text-content-muted text-[10px] px-2">
          +{overflow}
        </div>
      )}
    </div>
  );
}
