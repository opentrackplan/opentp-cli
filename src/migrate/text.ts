/**
 * Text splicing for `opentp migrate`: files are edited as text, located with the ranges of a
 * parsed YAML document, so that every byte the migration does not change stays identical
 * (comments, blank lines, quoting, key order).
 */

import { Document, isMap, isScalar, isSeq, type Node, type Pair, type YAMLMap } from "yaml";

/** Replace `[start, end)` of the original text with `text` (an insertion when start === end) */
export interface Edit {
  start: number;
  end: number;
  text: string;
}

/** A problem that stops one automatic edit (reported under `manual`, the text stays as it is) */
export class EditError extends Error {}

/** Edits of one text, kept apart until they are applied */
export class EditList {
  readonly edits: Edit[] = [];

  add(start: number, end: number, text: string): void {
    this.edits.push({ start, end, text });
  }

  /** Removes and returns the edits that lie completely inside `[start, end)` */
  take(start: number, end: number): Edit[] {
    const inside: Edit[] = [];
    for (let index = this.edits.length - 1; index >= 0; index -= 1) {
      const edit = this.edits[index];
      if (edit.start >= start && edit.end <= end && !(edit.start === end && edit.end === end)) {
        inside.unshift(edit);
        this.edits.splice(index, 1);
      }
    }
    return inside;
  }

  get size(): number {
    return this.edits.length;
  }

  /** Drops the edits added after the list had `size` edits */
  truncate(size: number): void {
    this.edits.length = size;
  }
}

/**
 * Applies edits to a text. Insertions at the same position keep the order in which they were
 * added and come before a replacement that starts there.
 * @throws Error for overlapping edits (a bug in the caller)
 */
export function applyEdits(text: string, edits: readonly Edit[], offset = 0): string {
  const sorted = edits
    .map((edit, index) => ({ ...edit, index }))
    .sort((a, b) => a.start - b.start || a.end - a.start - (b.end - b.start) || a.index - b.index);
  let out = "";
  let position = 0;
  for (const edit of sorted) {
    const start = edit.start - offset;
    const end = edit.end - offset;
    if (start < position) {
      throw new Error(`Overlapping edits at offset ${edit.start}`);
    }
    out += text.slice(position, start) + edit.text;
    position = end;
  }
  return out + text.slice(position);
}

/** `text[start, end)` with the edits inside that range applied */
export function sliceWithEdits(
  text: string,
  start: number,
  end: number,
  edits: readonly Edit[],
): string {
  return applyEdits(text.slice(start, end), edits, start);
}

/** The line ending of a text: CRLF when the text uses it, else LF */
export function lineEnding(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/** Converts LF line endings of generated text to `eol` */
export function withEol(text: string, eol: string): string {
  return eol === "\n" ? text : text.replace(/\r?\n/g, eol);
}

/** A block of full lines that ends with a line break (the last line of a file may have none) */
export function withFinalEol(text: string, eol: string): string {
  return text === "" || text.endsWith("\n") ? text : `${text}${eol}`;
}

/** Index of the first character of the line that contains `position` */
export function lineStart(text: string, position: number): number {
  return text.lastIndexOf("\n", position - 1) + 1;
}

/** Index right after the line break of the line that contains `position` (or the text length) */
export function lineEnd(text: string, position: number): number {
  const index = text.indexOf("\n", position);
  return index === -1 ? text.length : index + 1;
}

/** The column of a position (characters since the start of its line) */
export function columnOf(text: string, position: number): number {
  return position - lineStart(text, position);
}

/** Whether the line that starts at `position` is blank (the end of the text is not a line) */
export function isBlankLine(text: string, position: number): boolean {
  if (position >= text.length) return false;
  return /^[ \t]*\r?$/.test(text.slice(position, lineEnd(text, position)).replace(/\n$/, ""));
}

/** The start of the comment lines right above a line (they belong to what follows them) */
export function startWithComments(text: string, lineStartPosition: number): number {
  let start = lineStartPosition;
  while (start > 0) {
    const previous = lineStart(text, start - 1);
    if (!/^[ \t]*#/.test(text.slice(previous, start))) break;
    start = previous;
  }
  return start;
}

/** Whether only spaces precede `position` on its line */
export function startsLine(text: string, position: number): boolean {
  return /^[ ]*$/.test(text.slice(lineStart(text, position), position));
}

/**
 * Where the content of a node ends: the end of its last scalar or flow collection (without the
 * comments and line breaks that the ranges of block collections include)
 */
export function contentEnd(node: unknown): number {
  if (isMap(node) && !node.flow) {
    const last = (node.items as Pair[])[node.items.length - 1];
    return last ? pairEnd(last) : (node.range?.[0] ?? 0);
  }
  if (isSeq(node) && !node.flow) {
    const last = node.items[node.items.length - 1];
    return last ? contentEnd(last) : (node.range?.[0] ?? 0);
  }
  return (node as Node | null)?.range?.[1] ?? 0;
}

/** Where the written value of a pair ends (the key's end for a pair without a value) */
export function pairEnd(pair: Pair): number {
  const value = pair.value as Node | null;
  if (value && Array.isArray(value.range)) return contentEnd(value);
  return (pair.key as Node).range?.[1] ?? 0;
}

export function pairStart(pair: Pair): number {
  return (pair.key as Node).range?.[0] ?? 0;
}

/** The key of a pair as a string (null for keys that are not scalars) */
export function keyOf(pair: Pair): string | null {
  return isScalar(pair.key) && pair.key.value !== null && pair.key.value !== undefined
    ? String(pair.key.value)
    : null;
}

/** The pair with this key in a mapping */
export function findPair(map: YAMLMap, key: string): Pair | undefined {
  return (map.items as Pair[]).find((pair) => keyOf(pair) === key);
}

/** The value node of a key in a mapping, when it is a mapping */
export function mapAt(map: unknown, key: string): YAMLMap | null {
  if (!isMap(map)) return null;
  const value = findPair(map, key)?.value;
  return isMap(value) ? value : null;
}

/**
 * The lines of a pair in a block mapping: from the start of the key's line to the end of the line
 * where its value ends (a comment on that line included)
 */
export function blockPairSpan(text: string, pair: Pair): [number, number] {
  const start = pairStart(pair);
  if (!startsLine(text, start)) {
    throw new EditError("the key does not start its line");
  }
  const end = pairEnd(pair);
  return [lineStart(text, start), lineEnd(text, Math.max(start, end - 1))];
}

/** The text of a pair inside a flow mapping: from the key to the end of the value */
export function flowPairText(text: string, pair: Pair, edits: readonly Edit[] = []): string {
  return sliceWithEdits(text, pairStart(pair), pairEnd(pair), edits);
}

/**
 * Re-indents full lines of a block (the first line included) from `fromColumn` to `toColumn`.
 * Lines with less indentation lose only what they have; blank lines stay blank.
 */
export function reindent(block: string, fromColumn: number, toColumn: number): string {
  const lines = block.split("\n");
  return lines
    .map((line, index) => {
      if (index === lines.length - 1 && line === "") return line;
      if (/^[ \t]*\r?$/.test(line)) return line.replace(/^[ \t]+/, "");
      const indent = line.length - line.trimStart().length;
      const strip = Math.min(indent, fromColumn);
      return " ".repeat(toColumn) + line.slice(strip);
    })
    .join("\n");
}

/** The column of the first key of a block mapping */
export function firstKeyColumn(text: string, map: YAMLMap): number | null {
  const first = (map.items as Pair[])[0];
  return first ? columnOf(text, pairStart(first)) : null;
}

/**
 * Position right after the `:` that follows a key, and after the value's anchor (`&slot`) or tag
 * on the same line (for `key: {}`, `key: &slot {}`)
 */
export function colonAfterKey(text: string, pair: Pair): number {
  const keyEnd = (pair.key as Node).range?.[1] ?? 0;
  const skipSpaces = (from: number): number => {
    let index = from;
    while (index < text.length && (text[index] === " " || text[index] === "\t")) index += 1;
    return index;
  };
  let index = skipSpaces(keyEnd);
  if (text[index] !== ":") throw new EditError("cannot find the ':' after the key");
  let position = index + 1;
  index = skipSpaces(position);
  while (text[index] === "&" || text[index] === "!") {
    while (index < text.length && !/[\s]/.test(text[index])) index += 1;
    position = index;
    index = skipSpaces(index);
  }
  return position;
}

/** One change to a pair of a mapping (see editMapping) */
export type PairChange = { remove: true } | { replace: (style: "block" | "flow") => string };

export interface MappingChanges {
  /** Changes per pair; pairs without an entry keep their text (and the edits inside them) */
  pairs: Map<Pair, PairChange>;
  /** Pairs written before the first pair (`type: string`), as `key: value` text */
  insertFirst: string[];
}

/**
 * Applies pair changes to a mapping as text edits:
 * - block mapping: removed pairs lose their lines, replaced pairs get the lines returned by
 *   `replace("block")` (complete lines, indentation included), inserted pairs go before the first
 *   pair at its indentation; a mapping left with no pair becomes `{}` (written after the parent
 *   key's `:`), which needs `parent`;
 * - flow mapping: the mapping is rewritten from the text of its pairs (`{ a: 1, b: 2 }`), with
 *   the edits already made inside kept pairs.
 */
export function editMapping(
  text: string,
  map: YAMLMap,
  changes: MappingChanges,
  edits: EditList,
  eol: string,
  parent: Pair | null,
): void {
  const items = map.items as Pair[];
  if (changes.pairs.size === 0 && changes.insertFirst.length === 0) return;

  if (map.flow) {
    const [start, end] = map.range ?? [0, 0];
    const inner = edits.take(start, end);
    const texts: string[] = [...changes.insertFirst];
    for (const pair of items) {
      const change = changes.pairs.get(pair);
      if (change && "remove" in change) continue;
      if (change) {
        texts.push(change.replace("flow"));
        continue;
      }
      const pairEdits = inner.filter(
        (edit) => edit.start >= pairStart(pair) && edit.end <= pairEnd(pair),
      );
      texts.push(flowPairText(text, pair, pairEdits));
    }
    const padding = text[start + 1] === " " ? " " : "";
    const rendered = texts.length === 0 ? "{}" : `{${padding}${texts.join(", ")}${padding}}`;
    edits.add(start, end, rendered);
    return;
  }

  let kept = 0;
  for (const pair of items) {
    const change = changes.pairs.get(pair);
    if (!change) {
      kept += 1;
      continue;
    }
    const [start, end] = blockPairSpan(text, pair);
    if ("remove" in change) {
      // A block between blank lines takes one of them along
      const next = lineEnd(text, end);
      const blankAround =
        start > 0 && isBlankLine(text, lineStart(text, start - 1)) && isBlankLine(text, end);
      edits.add(start, blankAround && next > end ? next : end, "");
    } else {
      kept += 1;
      edits.add(start, end, change.replace("block"));
    }
  }

  if (changes.insertFirst.length > 0) {
    const first = items[0];
    if (!first) throw new EditError("cannot insert into an empty mapping");
    const position = pairStart(first);
    if (!startsLine(text, position)) throw new EditError("the key does not start its line");
    const indent = " ".repeat(columnOf(text, position));
    edits.add(
      lineStart(text, position),
      lineStart(text, position),
      changes.insertFirst.map((pairText) => `${indent}${pairText}${eol}`).join(""),
    );
    kept += changes.insertFirst.length;
  }

  if (kept === 0) {
    if (!parent) throw new EditError("cannot leave an empty mapping without a parent key");
    const colon = colonAfterKey(text, parent);
    edits.add(colon, colon, " {}");
  }
}

/** Plain data rendered as block YAML lines at `column` (for data that cannot be copied as text) */
export function renderBlock(data: unknown, column: number, eol: string): string {
  const rendered = new Document(data).toString({ lineWidth: 0 });
  return withEol(reindent(rendered, 0, column), eol);
}

/** One `key: value` pair with the value rendered in flow style (`checks: { a: true }`) */
export function renderFlowPair(key: string, data: unknown): string {
  const doc = new Document();
  const value = doc.createNode(data);
  if (isMap(value) || isSeq(value)) value.flow = true;
  const map = doc.createNode({}) as YAMLMap;
  map.items.push(doc.createPair(key, value));
  doc.contents = map;
  return doc.toString({ lineWidth: 0 }).replace(/\n$/, "");
}
