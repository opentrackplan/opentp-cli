/**
 * The data of the json and yaml exports (and the base of the template generator's data).
 */

import type { GeneratorContext } from "./types";

/**
 * The export: the plan header, the field catalog (`spec.events.payload.schema`), the common fields
 * and target settings (`spec.targets`), the portable checks (`spec.checks`), every event with its raw
 * `payload` and its 2026-09 `effectivePayload`, and the dictionaries (sorted by name). Events keep
 * the order of the context (the CLI sorts them by file path).
 */
export function buildExportData(context: GeneratorContext) {
  const { config, events, dictionaries } = context;
  const spec = config.spec;

  return {
    opentp: config.opentp,
    info: config.info,
    catalog: spec.events.payload.schema ?? {},
    targets: spec.targets ?? {},
    checks: spec.checks ?? {},
    events: events.map((event) => ({
      key: event.key,
      taxonomy: event.taxonomy,
      lifecycle: event.lifecycle,
      payload: event.payload,
      effectivePayload: context.effective(event),
    })),
    dictionaries: Object.fromEntries(
      [...dictionaries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  };
}
