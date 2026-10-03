/**
 * Event and dictionary files: the header and the field definitions of event payloads, edited as
 * text (see definitions.ts). Nothing else changes: keys, taxonomy, lifecycle, ignore paths and the
 * rest of the payload keep their bytes.
 */

import { isMap, isScalar, type Pair, type YAMLMap } from "yaml";
import { SPEC_VERSION } from "../meta";
import { type BaseView, baseType, selectorTargets } from "./analysis";
import { definitionsOf, type EditTarget, type EffectiveType, editDefinition } from "./definitions";
import { FileNotes, type Findings } from "./report";
import type { ScannedFile } from "./scan";
import { applyEdits, EditList, findPair, keyOf, lineEnding, mapAt } from "./text";

/** Replaces the value of the root `opentp` key, keeping its quoting and comment */
export function headerEdit(target: EditTarget, root: unknown, from: string): void {
  if (!isMap(root)) return;
  const value = findPair(root, "opentp")?.value;
  if (!isScalar(value) || !value.range) return;
  const quote = value.type === "QUOTE_DOUBLE" ? '"' : value.type === "QUOTE_SINGLE" ? "'" : "";
  target.edits.add(value.range[0], value.range[1], `${quote}${SPEC_VERSION}${quote}`);
  target.notes.note(`opentp: ${from} -> ${SPEC_VERSION}`);
}

/** One field definition written in an event payload */
export interface PayloadDefinition {
  /** null for an implicit payload (all targets) */
  selector: string | null;
  /** Path as written, without the leading `event.` (`payload.web.1.0.0.schema.user_id`) */
  path: string;
  name: string;
  map: YAMLMap;
  pair: Pair;
}

/** Whether a payload node is one implicit target payload (`schema` or `current` at the top) */
function isImplicit(payload: YAMLMap): boolean {
  if (mapAt(payload, "schema")) return true;
  const current = findPair(payload, "current")?.value;
  return isScalar(current) && typeof current.value === "string";
}

/** The field definitions (mappings) of an event payload node, in document order */
export function payloadDefinitions(payload: unknown): PayloadDefinition[] {
  const out: PayloadDefinition[] = [];
  if (!isMap(payload)) return out;
  const version = (selector: string | null, node: unknown, path: string) => {
    for (const [name, map, pair] of definitionsOf(mapAt(node, "schema"))) {
      out.push({ selector, path: `${path}.schema.${name}`, name, map, pair });
    }
  };
  const target = (selector: string | null, node: unknown, path: string) => {
    if (!isMap(node)) return;
    if (mapAt(node, "schema")) {
      version(selector, node, path);
      return;
    }
    for (const pair of node.items as Pair[]) {
      const key = keyOf(pair);
      if (key !== null && key !== "current" && isMap(pair.value)) {
        version(selector, pair.value, `${path}.${key}`);
      }
    }
  };
  if (isImplicit(payload)) {
    target(null, payload, "payload");
  } else {
    for (const pair of payload.items as Pair[]) {
      const key = keyOf(pair);
      if (key !== null) target(key, pair.value, `payload.${key}`);
    }
  }
  return out;
}

/** The type a written definition ends up with on the targets it covers */
export function effectiveTypeOf(
  map: YAMLMap,
  name: string,
  targets: string[],
  view: BaseView,
): EffectiveType {
  const scalarAt = (node: unknown, key: string): string | undefined => {
    const value = isMap(node) ? findPair(node, key)?.value : undefined;
    return isScalar(value) && typeof value.value === "string" ? value.value : undefined;
  };
  let type = scalarAt(map, "type");
  let itemsType = scalarAt(mapAt(map, "items"), "type");
  for (const target of targets.length > 0 ? targets : ["all"]) {
    const base = baseType(view, name, target);
    if (!base) continue;
    type ??= base.type;
    itemsType ??= base.itemsType;
    break;
  }
  return { type, itemsType };
}

export interface FileMigration {
  text: string;
  notes: FileNotes;
}

export interface EventMigrationContext {
  config: Record<string, unknown>;
  view: BaseView;
  webhookIds: Map<Pair, string>;
  findings: Findings;
}

/** Migrates an event or dictionary file with a 2026-01 header */
export function migrateEventFile(file: ScannedFile, context: EventMigrationContext): FileMigration {
  const notes = new FileNotes();
  const target: EditTarget = {
    file: file.rel,
    doc: file.doc,
    text: file.text,
    eol: lineEnding(file.text),
    edits: new EditList(),
    notes,
    findings: context.findings,
    webhookIds: context.webhookIds,
  };
  const root = file.doc.contents;
  headerEdit(target, root, file.version ?? "");

  if (file.kind === "event" && isMap(root)) {
    const event = mapAt(root, "event");
    const payload = event ? findPair(event, "payload")?.value : undefined;
    for (const definition of payloadDefinitions(payload)) {
      const targets = selectorTargets(definition.selector, context.config, context.view.targets);
      editDefinition(target, definition.map, {
        path: definition.path,
        parent: definition.pair,
        layer: "event",
        effectiveType: () =>
          effectiveTypeOf(definition.map, definition.name, targets, context.view),
      });
    }
  }

  return { text: applyEdits(file.text, target.edits.edits), notes };
}
