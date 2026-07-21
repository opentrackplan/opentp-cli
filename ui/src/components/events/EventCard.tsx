import { useT } from "../../i18n";
import type { TrackingEvent } from "../../types";
import { StatusBadge } from "../common/StatusBadge";
import {
  getPayloadSchema,
  countParams,
  countConstants,
  hasPii,
  getParamNames,
} from "../../lib/payload";
import { getAreaBadgeClasses } from "../../utils/areaColors";

interface EventCardProps {
  event: TrackingEvent;
  selected: boolean;
  onClick: () => void;
}

export function EventCard({ event, onClick, selected }: EventCardProps) {
  const { t } = useT();
  const [area, eventName] = event.key.split("::");
  const status = event.lifecycle?.status;
  const action = event.taxonomy?.action as string | undefined;

  const schema = getPayloadSchema(event.payload);
  const params = countParams(schema);
  const constants = countConstants(schema);
  const pii = hasPii(schema);
  const paramNames = getParamNames(schema);

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border transition-colors ${
        selected
          ? "bg-accent-blue-bg border-accent-blue-border"
          : "bg-surface-secondary border-edge-primary hover:border-edge-secondary hover:bg-surface-hover"
      } ${status === "deprecated" ? "opacity-60" : ""}`}
    >
      {/* Row 1: Area chip + Status badge */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono border ${getAreaBadgeClasses(area)}`}>
          {area}
        </span>
        <StatusBadge status={status} />
      </div>

      {/* Row 2: Event name — full width, prominent */}
      <p className="text-sm font-medium text-content-primary truncate mb-1">
        {eventName}
      </p>

      {/* Row 3: Action description — 2 lines max */}
      {action && (
        <p className="text-xs text-content-tertiary mb-2 line-clamp-2">{action}</p>
      )}

      {/* Row 4: Field name preview chips */}
      {paramNames.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {paramNames.slice(0, 4).map((name) => (
            <span
              key={name}
              className="px-1.5 py-0.5 bg-surface-tertiary/60 rounded text-[10px] font-mono text-content-tertiary"
            >
              {name}
            </span>
          ))}
          {paramNames.length > 4 && (
            <span className="text-[10px] text-content-muted">
              +{paramNames.length - 4}
            </span>
          )}
        </div>
      )}

      {/* Row 5: Meta badges */}
      <div className="flex items-center gap-3 text-[11px] text-content-muted">
        {params > 0 && (
          <span>
            {params} {t("eventList.params")}
          </span>
        )}
        {constants > 0 && (
          <span>
            {constants} {t("eventList.constants")}
          </span>
        )}
        {pii && <span className="text-accent-amber">{t("pii.badge")}</span>}
      </div>
    </button>
  );
}
