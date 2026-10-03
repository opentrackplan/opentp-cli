/**
 * opentp.yaml (2026-01 -> 2026-09), spliced: nodes are located by their ranges, only the changed
 * parts are rewritten, every other byte stays identical.
 * - the header;
 * - the old base fields (`spec.events.payload.schema`, part of every event) move to
 *   `spec.targets.all.schema` with their text (comments included), so they keep their meaning;
 * - `spec.events.payload.schema` becomes the catalog: one-line entries rendered with the
 *   Document API;
 * - base fields get a type when they have none, `valueRequired` becomes `policy: fixed` or is
 *   removed, and every definition gets the field edits of definitions.ts;
 * - `spec.events.x-opentp.keygen` leaves the file (opentp.cli.yaml keygen).
 */

import { Document, isAlias, isMap, isScalar, type Node, type Pair, type YAMLMap } from "yaml";
import { isYamlMapping } from "../util";
import { aliasesTo, containsAlias } from "./aliases";
import {
  type Analysis,
  CATALOG_PATH,
  type CatalogEntry,
  canonicalJson,
  catalogDefinition,
  movedPath,
} from "./analysis";
import { definitionsOf, type EditTarget, editDefinition } from "./definitions";
import { effectiveTypeOf, headerEdit } from "./events";
import { FileNotes, type Findings } from "./report";
import type { ScannedFile } from "./scan";
import {
  applyEdits,
  blockPairSpan,
  colonAfterKey,
  columnOf,
  EditError,
  EditList,
  editMapping,
  findPair,
  firstKeyColumn,
  flowPairText,
  keyOf,
  lineEnd,
  lineEnding,
  lineStart,
  mapAt,
  pairEnd,
  pairStart,
  reindent,
  renderBlock,
  renderFlowPair,
  sliceWithEdits,
  startsLine,
  startWithComments,
  withEol,
  withFinalEol,
} from "./text";

/**
 * A problem that makes a correct migration impossible: nothing is written. `path` is the dotted
 * path of the problem in `file` (default: the file being migrated).
 */
export class MigrationError extends Error {
  constructor(
    message: string,
    readonly path = "",
    readonly file?: string,
  ) {
    super(message);
  }
}

/** The error for a mapping that migrate has to insert into but that is not a block mapping */
export function blockMappingError(path: string, node: unknown, file?: string): MigrationError {
  return new MigrationError(
    isMap(node) && node.flow
      ? `Written in flow style, which migrate cannot insert into: rewrite ${path} in block style and run opentp migrate again`
      : `Not a block mapping with at least one key, which migrate cannot insert into: rewrite ${path} in block style and run opentp migrate again`,
    path,
    file,
  );
}

/** Runs an edit; a text edit that is not possible becomes a MigrationError at `path` */
export function atPath<T>(path: string, edit: () => T, file?: string): T {
  try {
    return edit();
  } catch (error) {
    if (!(error instanceof EditError)) throw error;
    throw new MigrationError(
      `Cannot be edited automatically (${error.message}): write it as a plain block mapping and run opentp migrate again`,
      path,
      file,
    );
  }
}

/** keygen taken out of opentp.yaml, for opentp.cli.yaml */
export interface MovedKeygen {
  /** The node's text: block lines at column 2, or the flow text written after `keygen: ` */
  text: string;
  block: boolean;
  data: unknown;
}

export interface ConfigMigration {
  text: string;
  notes: FileNotes;
  keygen: MovedKeygen | null;
  /** Number of base fields moved to spec.targets.all.schema */
  movedFields: number;
}

/** One catalog line: `name: { type: string }` */
export function renderCatalogEntry(name: string, entry: CatalogEntry): string {
  const doc = new Document();
  const value = doc.createNode(catalogDefinition(entry)) as YAMLMap;
  value.flow = true;
  const map = doc.createNode({}) as YAMLMap;
  map.items.push(doc.createPair(name, value));
  doc.contents = map;
  return doc.toString({ lineWidth: 0 }).replace(/\n$/, "");
}

/** Whether the line before a position is blank */
function blankLineBefore(text: string, position: number): boolean {
  if (position === 0) return false;
  const previous = lineStart(text, position - 1);
  return /^[ \t]*\r?\n?$/.test(text.slice(previous, position));
}

interface MovedPiece {
  name: string;
  /** Block lines at `column` (comments above the field included), or a flow pair's text */
  text: string;
  column: number | null;
  data: unknown;
}

function renderPieces(pieces: MovedPiece[], column: number, eol: string): string {
  return pieces
    .map((piece) =>
      piece.column === null
        ? `${" ".repeat(column)}${piece.text}${eol}`
        : withFinalEol(reindent(piece.text, piece.column, column), eol),
    )
    .join("");
}

/** Migrates a 2026-01 opentp.yaml */
export function migrateConfigFile(
  file: ScannedFile,
  analysis: Analysis,
  webhookIds: Map<Pair, string>,
  findings: Findings,
): ConfigMigration {
  const { text } = file;
  const eol = lineEnding(text);
  const notes = new FileNotes();
  const edits = new EditList();
  const target: EditTarget = {
    file: file.rel,
    doc: file.doc,
    text,
    eol,
    edits,
    notes,
    findings,
    webhookIds,
  };
  const { view } = analysis;
  const root = file.doc.contents;
  if (!isMap(root)) throw new MigrationError("Expected a mapping with 'opentp', 'info' and 'spec'");
  headerEdit(target, root, file.version ?? "");

  const specPair = findPair(root, "spec");
  const spec = mapAt(root, "spec");
  if (!spec || !specPair || spec.flow || spec.items.length === 0) {
    throw blockMappingError("spec", specPair?.value);
  }
  const events = mapAt(spec, "events");
  if (!events) {
    throw new MigrationError(
      "Missing or not a mapping: fix spec.events and run opentp migrate again",
      "spec.events",
    );
  }
  const step = firstKeyColumn(text, spec) ?? 2;
  const eventsPair = findPair(spec, "events") as Pair;
  const payloadPair = findPair(events, "payload");
  const payload = mapAt(events, "payload");
  if (!payloadPair) {
    throw new MigrationError(
      "Missing: add spec.events.payload (with targets.all) and run opentp migrate again",
      "spec.events.payload",
    );
  }
  if (!payload) {
    throw new MigrationError(
      "Not a mapping with targets.all: fix spec.events.payload and run opentp migrate again",
      "spec.events.payload",
    );
  }

  // Taxonomy fields and fragments (fragments first: they are inside their field)
  for (const [name, definition, pair] of definitionsOf(mapAt(events, "taxonomy"))) {
    const path = `spec.events.taxonomy.${name}`;
    for (const [fragment, fragmentDefinition, fragmentPair] of definitionsOf(
      mapAt(definition, "fragments"),
    )) {
      editDefinition(target, fragmentDefinition, {
        path: `${path}.fragments.${fragment}`,
        parent: fragmentPair,
        layer: "plan",
      });
    }
    editDefinition(target, definition, { path, parent: pair, layer: "plan" });
  }

  // PII configurations and meta fields
  const pii = mapAt(events, "pii");
  for (const name of ["kind", "masker"]) {
    const pair = pii ? findPair(pii, name) : undefined;
    if (pair && isMap(pair.value)) {
      editDefinition(target, pair.value, {
        path: `spec.events.pii.${name}`,
        parent: pair,
        layer: "plan",
      });
    }
  }
  for (const [name, definition, pair] of definitionsOf(mapAt(pii, "schema"))) {
    editDefinition(target, definition, {
      path: `spec.events.pii.schema.${name}`,
      parent: pair,
      layer: "plan",
    });
  }

  // Base definitions: the old base (moved below) and spec.targets.<id>.schema
  const baseSchemaPair = findPair(payload, "schema");
  checkBaseSchemaNode(file, baseSchemaPair);
  const baseMap = isMap(baseSchemaPair?.value) ? (baseSchemaPair?.value as YAMLMap) : null;
  // The catalog and the moved base fields are written as block lines
  if (payload.flow && ((baseMap?.items.length ?? 0) > 0 || analysis.catalog.entries.length > 0)) {
    throw blockMappingError("spec.events.payload", payload);
  }
  const editBase = (
    definitions: Array<[string, YAMLMap, Pair]>,
    prefix: string,
    targets: string[],
  ) => {
    for (const [name, definition, pair] of definitions) {
      const site = `${prefix}.${name}`;
      editDefinition(target, definition, {
        path: movedPath(site),
        parent: pair,
        layer: "plan",
        valueRequired: analysis.valueRequired.get(site),
        insertFirst: analysis.typeInsertions.get(site),
        effectiveType: () => effectiveTypeOf(definition, name, targets, view),
      });
      if (analysis.typeInsertions.has(site)) notes.count("added a type to a base field");
    }
  };
  const specTargetsPair = findPair(spec, "targets");
  const specTargets = mapAt(spec, "targets");
  editBase(definitionsOf(baseMap), CATALOG_PATH, view.targets);
  for (const [id, , targetPair] of definitionsOf(specTargets)) {
    editBase(definitionsOf(mapAt(targetPair.value, "schema")), `spec.targets.${id}.schema`, [id]);
  }

  // keygen leaves the file
  const keygen = atPath("spec.events.x-opentp", () => moveKeygen(target, events, file));

  // The old base fields move to spec.targets.all.schema; the catalog takes their place
  const basePairs = baseMap ? (baseMap.items as Pair[]) : [];
  const pieces: MovedPiece[] = [];
  let catalogColumn: number;
  if (baseMap && basePairs.length > 0 && !baseMap.flow) {
    const regionStart = lineEnd(text, (baseSchemaPair?.key as { range: number[] }).range[1]);
    const fromColumn = columnOf(text, pairStart(basePairs[0]));
    let previous = regionStart;
    for (const pair of basePairs) {
      const [, end] = atPath(`${CATALOG_PATH}.${keyOf(pair) ?? "?"}`, () =>
        blockPairSpan(text, pair),
      );
      pieces.push({
        name: keyOf(pair) ?? "",
        text: sliceWithEdits(text, previous, end, edits.take(previous, end)),
        column: fromColumn,
        data: nodeData(pair, file),
      });
      previous = end;
    }
    catalogColumn = fromColumn;
    const lines = catalogLines(analysis, catalogColumn, eol);
    edits.add(regionStart, previous, lines);
    if (lines === "") {
      const colon = atPath(CATALOG_PATH, () => colonAfterKey(text, baseSchemaPair as Pair));
      edits.add(colon, colon, " {}");
    }
  } else {
    if (baseMap && basePairs.length > 0) {
      for (const pair of basePairs) {
        pieces.push({
          name: keyOf(pair) ?? "",
          text: flowPairText(text, pair, edits.take(pairStart(pair), pairEnd(pair))),
          column: null,
          data: nodeData(pair, file),
        });
      }
    }
    catalogColumn = baseSchemaPair
      ? columnOf(text, pairStart(baseSchemaPair)) + step
      : (firstKeyColumn(text, payload) ?? 0) + step;
    const lines = catalogLines(analysis, catalogColumn, eol);
    if (baseSchemaPair) {
      if (lines !== "" || basePairs.length > 0) {
        const colon = atPath(CATALOG_PATH, () => colonAfterKey(text, baseSchemaPair));
        const end = pairEnd(baseSchemaPair);
        edits.add(colon, end, lines === "" ? " {}" : `${eol}${lines.slice(0, -eol.length)}`);
      }
    } else if (lines !== "") {
      if (payload.flow || payload.items.length === 0) {
        throw blockMappingError("spec.events.payload", payloadPair.value);
      }
      // After the last pair of payload (targets), at its indentation
      const items = payload.items as Pair[];
      const [, position] = atPath("spec.events.payload", () =>
        blockPairSpan(text, items[items.length - 1]),
      );
      const indent = " ".repeat(columnOf(text, pairStart(items[0])));
      const before = position === text.length && !text.endsWith("\n") ? eol : "";
      edits.add(position, position, `${before}${indent}schema:${eol}${lines}`);
    }
  }
  if (analysis.catalog.entries.length > 0) {
    notes.note(`catalog: ${analysis.catalog.entries.length} fields in spec.events.payload.schema`);
  }

  // Insert the moved fields in front of spec.targets.all.schema
  let moved = 0;
  if (pieces.length > 0) {
    moved = insertMovedFields(target, file, eventsPair, specTargetsPair, specTargets, pieces, step);
    notes.note(`moved ${moved} base fields to spec.targets.all.schema`);
  }

  return { text: applyEdits(text, edits.edits), notes, keygen, movedFields: moved };
}

/**
 * Stops on an anchor on spec.events.payload.schema, or an alias in its place: 2026-09 turns the
 * mapping into the catalog and moves its fields, which neither can follow
 */
function checkBaseSchemaNode(file: ScannedFile, pair: Pair | undefined): void {
  const value = pair?.value;
  if (isAlias(value)) {
    throw new MigrationError(
      `An alias (*${value.source}): 2026-09 turns ${CATALOG_PATH} into the catalog and moves its fields to spec.targets.all.schema, which an alias cannot express. Expand the alias (write the fields in its place) and run opentp migrate again`,
      CATALOG_PATH,
    );
  }
  const anchor = (value as Node | null | undefined)?.anchor;
  if (anchor) {
    const places = aliasesTo(file.doc, anchor);
    const used =
      places.length === 0
        ? ""
        : ` (used by the ${places.length === 1 ? "alias" : "aliases"} at ${places.join(", ")})`;
    throw new MigrationError(
      `Has the anchor &${anchor}${used}: 2026-09 turns ${CATALOG_PATH} into the catalog and moves its fields to spec.targets.all.schema, so the anchor cannot stay. Remove the anchor, write the fields in place of every alias to it, and run opentp migrate again`,
      CATALOG_PATH,
    );
  }
}

/** The value of a pair as plain data */
function nodeData(pair: Pair, file: ScannedFile): unknown {
  const value = pair.value as { toJS?: (doc: unknown) => unknown } | null;
  return value?.toJS ? value.toJS(file.doc) : null;
}

function catalogLines(analysis: Analysis, column: number, eol: string): string {
  return analysis.catalog.entries
    .map(
      ([name, entry]) =>
        `${" ".repeat(column)}${withEol(renderCatalogEntry(name, entry), eol)}${eol}`,
    )
    .join("");
}

/**
 * Moves `spec.events.x-opentp.keygen` out: the `x-opentp` pair is removed when nothing else is in
 * it; other members are reported under manual and stay.
 */
function moveKeygen(target: EditTarget, events: YAMLMap, file: ScannedFile): MovedKeygen | null {
  const { text } = target;
  const pair = findPair(events, "x-opentp");
  if (!pair) return null;
  const written = pair.value;
  const value = isAlias(written) ? written.resolve(file.doc) : written;
  if (!isMap(value)) {
    editMapping(
      text,
      events,
      { pairs: new Map([[pair, { remove: true }]]), insertFirst: [] },
      target.edits,
      target.eol,
      null,
    );
    return null;
  }
  const members = value.items as Pair[];
  const keygenPair = members.find((member) => keyOf(member) === "keygen");
  const others = members.filter((member) => member !== keygenPair);
  for (const member of others) {
    target.findings.manualItem(
      target.file,
      `spec.events.x-opentp.${keyOf(member) ?? "?"}`,
      `spec.events.x-opentp.${keyOf(member) ?? "?"} has no 2026-09 equivalent: move or remove it, then remove x-opentp`,
    );
  }

  let keygen: MovedKeygen | null = null;
  if (keygenPair?.value && (isAlias(written) || containsAlias(keygenPair.value))) {
    // Aliases cannot travel to another file: the keygen is written from its data
    const data: unknown = (keygenPair.value as Node).toJS(file.doc);
    keygen = isYamlMapping(data)
      ? { block: true, text: renderBlock(data, 2, target.eol), data }
      : { block: false, text: renderFlowPair("keygen", data).slice("keygen: ".length), data };
    target.notes.note("moved keygen to opentp.cli.yaml");
  } else if (keygenPair?.value && (keygenPair.value as YAMLMap).range) {
    const node = keygenPair.value as YAMLMap;
    const [start, end] = node.range as [number, number, number];
    const block = isMap(node) && !node.flow;
    keygen = {
      block,
      // Comment lines right above the first key belong to the block
      text: block
        ? withFinalEol(
            reindent(
              text.slice(startWithComments(text, lineStart(text, start)), lineEnd(text, end - 1)),
              columnOf(text, start),
              2,
            ),
            target.eol,
          )
        : text.slice(start, end),
      data: isScalar(node) ? node.value : node.toJS(file.doc),
    };
    target.notes.note("moved keygen to opentp.cli.yaml");
  }

  if (others.length === 0) {
    editMapping(
      text,
      events,
      { pairs: new Map([[pair, { remove: true }]]), insertFirst: [] },
      target.edits,
      target.eol,
      null,
    );
  } else if (keygenPair && !isAlias(written)) {
    editMapping(
      text,
      value,
      { pairs: new Map([[keygenPair, { remove: true }]]), insertFirst: [] },
      target.edits,
      target.eol,
      pair,
    );
  }
  return keygen;
}

/** Inserts the moved base fields in front of spec.targets.all.schema; returns how many moved */
function insertMovedFields(
  target: EditTarget,
  file: ScannedFile,
  eventsPair: Pair,
  specTargetsPair: Pair | undefined,
  specTargets: YAMLMap | null,
  pieces: MovedPiece[],
  step: number,
): number {
  const { text, eol, edits } = target;
  const insertBefore = (pair: Pair, where: string): { position: number; blank: boolean } => {
    const keyStart = pairStart(pair);
    if (!startsLine(text, keyStart)) throw blockMappingError(where, null);
    const position = startWithComments(text, lineStart(text, keyStart));
    return { position, blank: blankLineBefore(text, position) };
  };

  if (!specTargetsPair) {
    const column = columnOf(text, pairStart(eventsPair));
    const { position, blank } = insertBefore(eventsPair, "spec");
    const pad = (n: number) => " ".repeat(column + n * step);
    edits.add(
      position,
      position,
      `${pad(0)}targets:${eol}${pad(1)}all:${eol}${pad(2)}schema:${eol}${renderPieces(pieces, column + 3 * step, eol)}${blank ? eol : ""}`,
    );
    return pieces.length;
  }

  if (!specTargets || specTargets.flow || specTargets.items.length === 0) {
    throw blockMappingError("spec.targets", specTargetsPair.value);
  }
  const allPair = findPair(specTargets, "all");
  if (!allPair) {
    const first = (specTargets.items as Pair[])[0];
    const column = columnOf(text, pairStart(first));
    const { position } = insertBefore(first, "spec.targets");
    edits.add(
      position,
      position,
      `${" ".repeat(column)}all:${eol}${" ".repeat(column + step)}schema:${eol}${renderPieces(pieces, column + 2 * step, eol)}`,
    );
    return pieces.length;
  }

  const all = isMap(allPair.value) ? allPair.value : null;
  if (!all || all.flow || all.items.length === 0) {
    throw blockMappingError("spec.targets.all", allPair.value);
  }
  const schemaPair = findPair(all, "schema");
  if (!schemaPair) {
    const first = (all.items as Pair[])[0];
    const column = columnOf(text, pairStart(first));
    const { position } = insertBefore(first, "spec.targets.all");
    edits.add(
      position,
      position,
      `${" ".repeat(column)}schema:${eol}${renderPieces(pieces, column + step, eol)}`,
    );
    return pieces.length;
  }
  const schema = isMap(schemaPair.value) ? schemaPair.value : null;
  if (!schema || schema.flow || schema.items.length === 0) {
    throw blockMappingError("spec.targets.all.schema", schemaPair.value);
  }
  const existing = new Map<string, unknown>();
  for (const pair of schema.items as Pair[]) {
    const key = keyOf(pair);
    if (key !== null) existing.set(key, nodeData(pair, file));
  }
  const kept = pieces.filter((piece) => {
    if (!existing.has(piece.name)) return true;
    if (canonicalJson(existing.get(piece.name)) !== canonicalJson(piece.data)) {
      target.findings.manualItem(
        target.file,
        `spec.targets.all.schema.${piece.name}`,
        `'${piece.name}' is defined in spec.events.payload.schema (2026-01 base) and in spec.targets.all.schema: the spec.targets.all definition was kept; merge the old one into it by hand`,
      );
    }
    return false;
  });
  const first = (schema.items as Pair[])[0];
  const column = columnOf(text, pairStart(first));
  const position = lineStart(text, pairStart(first));
  if (kept.length > 0) edits.add(position, position, renderPieces(kept, column, eol));
  return kept.length;
}
