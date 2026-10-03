/**
 * `opentp fix`: rewrites the `event.key` of an event file and nothing else. The key's scalar is
 * located with the yaml Document API and only its source text is replaced, so every other byte of
 * the file stays as it was (comments, blank lines, quoting, indentation, line endings and key order,
 * including version keys such as "2" before "1").
 */

import { isDeepStrictEqual } from "node:util";
import { Document, isMap, isScalar, type Pair, parseDocument, Scalar } from "yaml";

export type EventKeyEdit = { ok: true; text: string } | { ok: false; reason: string };

/** The parsed value of a YAML text the way event files are loaded, or undefined on errors */
function parsedValue(text: string): unknown {
  try {
    const document = parseDocument(text);
    if (document.errors.length > 0) return undefined;
    return document.toJS();
  } catch {
    return undefined;
  }
}

/** The one pair with this key in a mapping (null when there is none or more than one) */
function onlyPair(map: { items: unknown[] }, key: string): Pair | null {
  const pairs = (map.items as Pair[]).filter(
    (pair) => isScalar(pair.key) && pair.key.value === key,
  );
  return pairs.length === 1 ? pairs[0] : null;
}

/** A string rendered as a YAML scalar of one style (block styles are not used for one line) */
function renderScalar(value: string, type: Scalar["type"]): string {
  const scalar = new Scalar(value);
  scalar.type = type;
  return new Document(scalar).toString({ lineWidth: 0 }).replace(/\r?\n$/, "");
}

/**
 * Sets `event.key` of an event file's text to `key`. The scalar keeps its quoting style when the
 * new key can be written in it (else it becomes double-quoted). The result is parsed again and
 * must equal the original document with only `event.key` changed; when the key node cannot be
 * changed alone (it is missing, an alias, written more than once, repeated by an alias of its
 * anchor, or the file has YAML errors), nothing is changed and the reason is returned.
 */
export function setEventKey(text: string, key: string): EventKeyEdit {
  const document = parseDocument(text);
  const expected = parsedValue(text) as { event?: { key?: unknown } } | undefined;
  if (document.errors.length > 0 || expected === undefined) {
    return { ok: false, reason: "the file cannot be read as one YAML document" };
  }

  const root = document.contents;
  const eventPair = isMap(root) ? onlyPair(root, "event") : null;
  if (eventPair === null || !isMap(eventPair.value)) {
    return { ok: false, reason: "'event' is not a mapping written in the file" };
  }
  const keyPair = onlyPair(eventPair.value, "key");
  const node = keyPair?.value;
  if (!isScalar(node) || !Array.isArray(node.range)) {
    return { ok: false, reason: "event.key is not a scalar written in the file" };
  }

  const [start, end] = node.range;
  const original = text.slice(start, end);
  // A block scalar's range ends with its line break; the replacement keeps it
  const lineBreak = /\r?\n$/.exec(original)?.[0] ?? "";
  const block = node.type === Scalar.BLOCK_LITERAL || node.type === Scalar.BLOCK_FOLDED;
  const styles: Array<Scalar["type"]> = block
    ? [Scalar.QUOTE_DOUBLE]
    : [node.type, Scalar.QUOTE_DOUBLE];

  if (expected.event === null || typeof expected.event !== "object") {
    return { ok: false, reason: "'event' is not a mapping written in the file" };
  }
  // The document the edit must produce: the original with only event.key changed
  expected.event.key = key;
  for (const style of styles) {
    const rendered = renderScalar(key, style);
    if (rendered.includes("\n")) continue;
    const edited = `${text.slice(0, start)}${rendered}${lineBreak}${text.slice(end)}`;
    if (isDeepStrictEqual(parsedValue(edited), expected)) {
      return { ok: true, text: edited };
    }
  }
  return {
    ok: false,
    reason: node.anchor
      ? `event.key carries the anchor &${node.anchor}; an alias of it would change too`
      : "the new key cannot be written in place of the old one",
  };
}
