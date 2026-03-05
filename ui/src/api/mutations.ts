import type {
  EventDraft,
  ValidationResult,
  CreateEventResult,
  UpdateEventResult,
  DeleteEventResult,
  DictionaryDraft,
  CreateDictionaryResult,
  UpdateDictionaryResult,
  DeleteDictionaryResult,
} from "../types";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function putJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function deleteJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** POST /api/events — create a new event. */
export function createEvent(
  baseUrl: string,
  draft: EventDraft,
): Promise<CreateEventResult> {
  return postJson<CreateEventResult>(`${baseUrl}/api/events`, {
    key: draft.key,
    taxonomy: draft.taxonomy,
    payload: draft.payload,
    lifecycle: draft.lifecycle,
    aliases: draft.aliases,
  });
}

/** PUT /api/events/:key — update an existing event. */
export function updateEvent(
  baseUrl: string,
  originalKey: string,
  draft: EventDraft,
): Promise<UpdateEventResult> {
  return putJson<UpdateEventResult>(
    `${baseUrl}/api/events/${encodeURIComponent(originalKey)}`,
    {
      key: draft.key,
      taxonomy: draft.taxonomy,
      payload: draft.payload,
      lifecycle: draft.lifecycle,
      aliases: draft.aliases,
    },
  );
}

/** POST /api/validate — validate a single event by key. */
export function validateEvent(
  baseUrl: string,
  key: string,
): Promise<ValidationResult> {
  return postJson<ValidationResult>(`${baseUrl}/api/validate`, { key });
}

/** POST /api/validate — validate all events. */
export function validateAll(baseUrl: string): Promise<ValidationResult> {
  return postJson<ValidationResult>(`${baseUrl}/api/validate`, {});
}

/** POST /api/validate — validate an unsaved draft event. */
export function validateDraft(
  baseUrl: string,
  draft: EventDraft,
): Promise<ValidationResult> {
  return postJson<ValidationResult>(`${baseUrl}/api/validate`, {
    draft: {
      key: draft.key,
      taxonomy: draft.taxonomy,
      payload: draft.payload,
      lifecycle: draft.lifecycle,
      aliases: draft.aliases,
    },
  });
}

/** DELETE /api/events/:key — delete an event. */
export function deleteEvent(
  baseUrl: string,
  key: string,
): Promise<DeleteEventResult> {
  return deleteJson<DeleteEventResult>(
    `${baseUrl}/api/events/${encodeURIComponent(key)}`,
  );
}

/** Convert draft to a JSON string for download.
 *  TODO: Replace with proper YAML serialization (e.g. js-yaml). */
export function eventDraftToYaml(draft: EventDraft): string {
  const event: Record<string, unknown> = {
    key: draft.key,
    taxonomy: draft.taxonomy,
  };
  if (draft.lifecycle) event.lifecycle = draft.lifecycle;
  if (draft.aliases) event.aliases = draft.aliases;
  event.payload = draft.payload;

  return JSON.stringify({ opentp: "2026-01", event }, null, 2);
}

// ── Dictionary mutations ─────────────────────────────────

/** POST /api/dictionaries — create a new dictionary. */
export function createDictionary(
  baseUrl: string,
  draft: DictionaryDraft,
): Promise<CreateDictionaryResult> {
  return postJson<CreateDictionaryResult>(`${baseUrl}/api/dictionaries`, {
    key: draft.key,
    type: draft.type,
    values: draft.values,
  });
}

/** PUT /api/dictionaries/:key — update an existing dictionary. */
export function updateDictionary(
  baseUrl: string,
  originalKey: string,
  draft: DictionaryDraft,
): Promise<UpdateDictionaryResult> {
  return putJson<UpdateDictionaryResult>(
    `${baseUrl}/api/dictionaries/${encodeURIComponent(originalKey)}`,
    {
      key: draft.key,
      type: draft.type,
      values: draft.values,
    },
  );
}

/** DELETE /api/dictionaries/:key — delete a dictionary. */
export function deleteDictionary(
  baseUrl: string,
  key: string,
): Promise<DeleteDictionaryResult> {
  return deleteJson<DeleteDictionaryResult>(
    `${baseUrl}/api/dictionaries/${encodeURIComponent(key)}`,
  );
}
