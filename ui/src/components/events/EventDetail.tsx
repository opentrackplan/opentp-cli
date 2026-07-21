import { Modes } from "../../types";
import type { TrackingEvent, UIMode, EventDraft, OpenTPConfig, ScalarType } from "../../types";
import { getPayloadSchema, buildSdkExample } from "../../lib/payload";
import { useT } from "../../i18n";
import { StatusBadge } from "../common/StatusBadge";
import { TaxonomySection } from "./TaxonomySection";
import { PayloadSection } from "./PayloadSection";
import { CopyButton } from "../common/CopyButton";
import { EventForm } from "./EventForm";
import { getAreaTextClass } from "../../utils/areaColors";

interface EventDetailProps {
  event: TrackingEvent;
  mode?: UIMode;
  draft?: EventDraft | null;
  config?: OpenTPConfig;
  dictionaries?: Record<string, Array<string | number | boolean>>;
  onDraftChange?: (draft: EventDraft) => void;
  dictionaryMeta?: Record<string, { type: ScalarType; values: Array<string | number | boolean> }>;
  baseUrl?: string | null;
  onDictUpdated?: () => void;
  addToast?: (type: "success" | "error", text: string) => void;
}

export function EventDetail({
  event,
  mode = Modes.VIEWER,
  draft,
  config,
  dictionaries,
  onDraftChange,
  dictionaryMeta,
  baseUrl,
  onDictUpdated,
  addToast,
}: EventDetailProps) {
  const { t } = useT();

  // Editor mode with active draft
  if (mode === Modes.EDITOR && draft && config && dictionaries && onDraftChange) {
    return (
      <div className="p-6 max-w-3xl">
        <EventForm
          draft={draft}
          config={config}
          dictionaries={dictionaries}
          onChange={onDraftChange}
          dictionaryMeta={dictionaryMeta}
          baseUrl={baseUrl}
          onDictUpdated={onDictUpdated}
          addToast={addToast}
        />
      </div>
    );
  }

  // Viewer mode — read-only rendering
  const [area, eventName] = event.key.split("::");
  const status = event.lifecycle?.status;
  const schema = getPayloadSchema(event.payload);

  const sdkExample = buildSdkExample(area, eventName, schema);

  return (
    <div className="p-6 max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <h2 className="text-lg font-semibold text-content-primary">
            <span className={getAreaTextClass(area)}>{area}::</span>
            {eventName}
          </h2>
          <StatusBadge status={status} />
          <CopyButton text={event.key} label={t("detail.copyKey")} />
        </div>
        <p className="text-xs text-content-tertiary">{event.relativePath}</p>
      </div>

      {/* Sections */}
      <div className="space-y-6">
        {/* Taxonomy */}
        <TaxonomySection taxonomy={event.taxonomy} />

        {/* Payload */}
        <PayloadSection schema={schema} />

        {/* SDK Usage Example */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-medium text-content-tertiary uppercase tracking-wider">
              {t("detail.sdkUsage")}
            </h3>
            <CopyButton text={sdkExample} label={t("common.copy")} />
          </div>
          <pre className="text-xs font-mono bg-surface-input border border-edge-primary rounded-lg p-4 text-content-primary overflow-x-auto">
            {sdkExample}
          </pre>
        </section>
      </div>
    </div>
  );
}
