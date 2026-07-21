import type { TrackingEvent } from "../../types";
import { useT } from "../../i18n";
import { EventCard } from "./EventCard";
import { EventRow } from "./EventRow";

interface EventListProps {
  events: TrackingEvent[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  expanded?: boolean;
  matchedFieldsByKey?: Map<string, Set<string>>;
}

export function EventList({ events, selectedKey, onSelect, expanded, matchedFieldsByKey }: EventListProps) {
  const { t } = useT();

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-edge-primary text-sm text-content-secondary">
        {events.length} {events.length !== 1 ? t("eventList.events") : t("eventList.event")}
      </div>

      {events.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-center px-4">
          <div>
            <p className="text-content-tertiary text-sm">{t("eventList.noResults")}</p>
            <p className="text-content-muted text-xs mt-1">
              {t("eventList.noResultsHint")}
            </p>
          </div>
        </div>
      ) : expanded ? (
        <div className="flex-1 overflow-y-auto">
          {events.map((event) => (
            <EventRow
              key={event.key}
              event={event}
              selected={event.key === selectedKey}
              onClick={() => onSelect(event.key)}
              highlightFields={matchedFieldsByKey?.get(event.key)}
            />
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {events.map((event) => (
            <EventCard
              key={event.key}
              event={event}
              selected={event.key === selectedKey}
              onClick={() => onSelect(event.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
