import type { Field } from "../types";

interface RawPayloadShape {
  schema?: Record<string, Field>;
}

/** Safely extract the schema from an event's raw payload. */
export function getPayloadSchema(payload: unknown): Record<string, Field> {
  if (payload && typeof payload === "object" && "schema" in payload) {
    return (payload as RawPayloadShape).schema ?? {};
  }
  return {};
}

/** Count parameters (fields without a fixed value). */
export function countParams(schema: Record<string, Field>): number {
  return Object.values(schema).filter((f) => f.value === undefined).length;
}

/** Count constants (fields with a fixed value). */
export function countConstants(schema: Record<string, Field>): number {
  return Object.values(schema).filter((f) => f.value !== undefined).length;
}

/** Check if any field has PII metadata. */
export function hasPii(schema: Record<string, Field>): boolean {
  return Object.values(schema).some((f) => f.pii != null);
}

/** Get names of parameter fields (non-constant fields). */
export function getParamNames(schema: Record<string, Field>): string[] {
  return Object.entries(schema)
    .filter(([, f]) => f.value === undefined)
    .map(([name]) => name);
}

/** Get field name + type summaries for parameter fields. */
export function getParamSummaries(
  schema: Record<string, Field>,
): Array<{ name: string; type: string; required: boolean }> {
  return Object.entries(schema)
    .filter(([, f]) => f.value === undefined)
    .map(([name, f]) => ({
      name,
      type:
        f.enum || f.dict
          ? "enum"
          : f.type === "array"
            ? `${f.items?.type ?? "any"}[]`
            : (f.type ?? "string"),
      required: f.required === true,
    }));
}

/** Convert snake_case or kebab-case to camelCase. */
export function toCamelCase(str: string): string {
  return str.replace(/[_-](\w)/g, (_, c: string) => c.toUpperCase());
}

/** Build SDK usage example string for an event. */
export function buildSdkExample(
  area: string,
  eventName: string,
  schema: Record<string, Field>,
): string {
  const params = Object.entries(schema).filter(
    ([, f]) => f.value === undefined && f.required,
  );
  if (params.length === 0) {
    return `tracker.${area}.${toCamelCase(eventName)}();`;
  }
  return `tracker.${area}.${toCamelCase(eventName)}({\n${params
    .map(([name, f]) => {
      const v =
        f.enum?.[0] ??
        (f.type === "number" || f.type === "integer"
          ? "0"
          : f.type === "boolean"
            ? "true"
            : "'...'");
      return `  ${name}: ${typeof v === "string" && !f.enum ? v : JSON.stringify(v)}`;
    })
    .join(",\n")}\n});`;
}
