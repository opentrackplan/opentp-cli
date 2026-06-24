import type {
  OpenTPConfig,
  TrackingEvent,
  DictionariesResponse,
  DictionaryEntry,
  TrackingPlanData,
  DataSource,
} from "../types";

export async function loadTrackingPlan(
  source: DataSource,
): Promise<TrackingPlanData> {
  switch (source.type) {
    case "api":
      return loadFromApi(source.baseUrl);
    case "static":
      return source.data;
    case "json-url":
      return loadFromJsonUrl(source.url);
  }
}

async function loadFromApi(baseUrl: string): Promise<TrackingPlanData> {
  const [config, events, dictsResponse] = await Promise.all([
    fetchJson<OpenTPConfig>(`${baseUrl}/api/config`),
    fetchJson<TrackingEvent[]>(`${baseUrl}/api/events`),
    fetchJson<DictionariesResponse>(`${baseUrl}/api/dictionaries`),
  ]);

  // Extract flat values map for existing consumers + full meta for dictionary editor
  // Handle both new format { type, values } and legacy format (plain array)
  const dictionaries: Record<string, Array<string | number | boolean>> = {};
  const dictionaryMeta: Record<string, DictionaryEntry> = {};
  for (const [key, raw] of Object.entries(dictsResponse.dictionaries)) {
    if (Array.isArray(raw)) {
      dictionaries[key] = raw;
      dictionaryMeta[key] = { type: "string", values: raw };
    } else {
      const entry = raw as DictionaryEntry;
      dictionaries[key] = entry.values;
      dictionaryMeta[key] = entry;
    }
  }

  return { config, events, dictionaries, dictionaryMeta };
}

async function loadFromJsonUrl(url: string): Promise<TrackingPlanData> {
  const data = await fetchJson<TrackingPlanData>(url);
  if (!data.dictionaryMeta) {
    data.dictionaryMeta = {};
  }
  return data;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

/** Check if opentp serve API is available */
export async function checkApiHealth(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}
