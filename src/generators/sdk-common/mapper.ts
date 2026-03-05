import { mergeSchemaMaps, resolveEventPayload } from "../../core/payload";
import type { Field, OpenTPConfig, ResolvedEvent } from "../../types";
import type { MappedEvent, ResolvedField } from "./types";

export function toCamelCase(str: string): string {
  return str.replace(/[_-](\w)/g, (_, c) => c.toUpperCase());
}

export function toPascalCase(str: string): string {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/** Resolve a field definition into a language-agnostic ResolvedField */
export function resolveField(
  name: string,
  field: Field,
  dictionaries: Map<string, (string | number | boolean)[]>,
): ResolvedField {
  const required = field.required === true;
  const description = field.description;
  const piiKind = field.pii?.kind;

  // Dictionary reference takes priority
  if (field.dict) {
    const values = dictionaries.get(field.dict);
    if (values && values.length > 0) {
      return {
        name,
        baseType: field.type ?? "string",
        enumValues: values,
        required,
        isArray: false,
        description,
        piiKind,
      };
    }
    // Dict not found — fall through to base type
  }

  // Enum values
  if (field.enum && field.enum.length > 0) {
    return {
      name,
      baseType: field.type ?? "string",
      enumValues: field.enum,
      required,
      isArray: false,
      description,
      piiKind,
    };
  }

  // Array type
  if (field.type === "array") {
    const items = field.items;
    if (!items) {
      return {
        name,
        baseType: "unknown",
        arrayItemType: "unknown",
        required,
        isArray: true,
        description,
        piiKind,
      };
    }
    const itemInfo = resolveItemsField(items, dictionaries);
    return {
      name,
      baseType: "array",
      ...itemInfo,
      required,
      isArray: true,
      description,
      piiKind,
    };
  }

  // Scalar type
  if (field.type) {
    return {
      name,
      baseType: field.type,
      required,
      isArray: false,
      description,
      piiKind,
    };
  }

  // Infer from value
  if (field.value !== undefined) {
    if (Array.isArray(field.value)) {
      return {
        name,
        baseType: "unknown",
        arrayItemType: "unknown",
        required,
        isArray: true,
        description,
        piiKind,
      };
    }
    return {
      name,
      baseType: typeof field.value as string,
      required,
      isArray: false,
      description,
      piiKind,
    };
  }

  // Fallback
  return {
    name,
    baseType: "unknown",
    required,
    isArray: false,
    description,
    piiKind,
  };
}

function resolveItemsField(
  items: NonNullable<Field["items"]>,
  dictionaries: Map<string, (string | number | boolean)[]>,
): Pick<ResolvedField, "arrayItemType" | "arrayItemEnum"> {
  // Dict on items
  if (items.dict) {
    const values = dictionaries.get(items.dict);
    if (values && values.length > 0) {
      return { arrayItemType: items.type, arrayItemEnum: values };
    }
  }

  // Enum on items
  if (items.enum && items.enum.length > 0) {
    return { arrayItemType: items.type, arrayItemEnum: items.enum };
  }

  // Plain scalar items
  return { arrayItemType: items.type };
}

export function mapEvents(
  events: ResolvedEvent[],
  config: OpenTPConfig,
  dictionaries: Map<string, (string | number | boolean)[]>,
  targetName: string,
): MappedEvent[] {
  const result: MappedEvent[] = [];
  const baseSchema = config.spec.events.payload.schema;

  for (const event of events) {
    // Skip deprecated events
    if (event.lifecycle?.status === "deprecated") continue;

    // Resolve payload
    const { payload: resolved } = resolveEventPayload(event.payload, config);

    // Get this target's payload — skip if target not present
    const targetPayload = resolved.targets[targetName];
    if (!targetPayload) continue;

    // Get current version schema
    const currentVersion = targetPayload.versions[targetPayload.current];
    if (!currentVersion) continue;

    // Merge base schema + event schema (base first, event overrides)
    const mergedSchema = mergeSchemaMaps(baseSchema, currentVersion.schema);

    // Split into constants and params
    const constants: Record<string, string | number | boolean> = {};
    const params: ResolvedField[] = [];

    for (const [name, field] of Object.entries(mergedSchema)) {
      if (field.value !== undefined && !Array.isArray(field.value)) {
        constants[name] = field.value;
      } else {
        params.push(resolveField(name, field, dictionaries));
      }
    }

    // Extract area and event name from key (format: "area::event_name")
    const [rawArea, rawEventName] = event.key.split("::");
    const area = toCamelCase(rawArea);
    const eventName = toCamelCase(rawEventName);
    const interfaceName = `${toPascalCase(rawArea)}${toPascalCase(rawEventName)}Params`;

    result.push({
      key: event.key,
      area,
      eventName,
      interfaceName,
      params,
      constants,
      status: event.lifecycle?.status,
    });
  }

  return result;
}
