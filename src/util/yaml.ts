import { isAlias, isMap, isPair, isScalar, isSeq, type Node, parseDocument } from "yaml";

/**
 * The keys of a parsed YAML mapping in source order, stored on the mapping as a property that is
 * not enumerable (spreading, `Object.keys` and JSON leave it out). A JavaScript object lists
 * integer-like keys ("1", "2", "10") first and in numeric order, so a mapping written as `"2": ...`
 * then `"1": ...` loses its order; parseYaml records it only for such mappings.
 */
const SOURCE_KEY_ORDER = Symbol("opentp.sourceKeyOrder");

/**
 * The keys of a mapping in the order the YAML source lists them (parseYaml), else in the object's
 * own key order
 */
export function keysInSourceOrder(mapping: Record<string, unknown>): string[] {
  const order = (mapping as { [SOURCE_KEY_ORDER]?: string[] })[SOURCE_KEY_ORDER];
  return Array.isArray(order) ? order : Object.keys(mapping);
}

/** The paths of the YAML merge keys of a parsed document, stored on its root value (see mergeKeyPaths) */
const MERGE_KEY_PATHS = Symbol("opentp.mergeKeyPaths");

/**
 * The dotted paths (`a.b[0].<<`) of the YAML merge keys of a document parsed by parseYaml: every
 * mapping key written as a plain `<<` (a quoted `"<<"` is an ordinary key in YAML 1.1 and 1.2).
 * They are found in the YAML text, once where each is written (not again through an alias). A
 * value that parseYaml did not return has none.
 */
export function mergeKeyPaths(document: unknown): string[] {
  if (typeof document !== "object" || document === null) return [];
  const paths = (document as { [MERGE_KEY_PATHS]?: string[] })[MERGE_KEY_PATHS];
  return Array.isArray(paths) ? paths : [];
}

/**
 * Parses YAML text like `parse` from the yaml package (same value, warnings and errors) and
 * records the source key order of every mapping whose JavaScript key order differs from it (see
 * keysInSourceOrder) and the paths of the merge keys (see mergeKeyPaths).
 */
export function parseYaml(text: string): unknown {
  const document = parseDocument(text);
  for (const warning of document.warnings) process.emitWarning(warning);
  if (document.errors.length > 0) throw document.errors[0];
  const value = document.toJS();
  recordKeyOrder(document.contents, value);
  if (typeof value === "object" && value !== null) {
    const paths: string[] = [];
    findMergeKeys(document.contents, "", paths);
    if (paths.length > 0) {
      Object.defineProperty(value, MERGE_KEY_PATHS, { value: paths, configurable: true });
    }
  }
  return value;
}

/** Collects the paths of plain `<<` keys below a node; aliases are not followed */
function findMergeKeys(node: unknown, path: string, paths: string[]): void {
  if (isSeq(node)) {
    node.items.forEach((item, index) => {
      findMergeKeys(item, `${path}[${index}]`, paths);
    });
    return;
  }
  if (!isMap(node)) return;
  for (const pair of node.items) {
    if (!isPair(pair)) continue;
    const key = isScalar(pair.key) ? String(pair.key.value ?? "") : "?";
    const childPath = path === "" ? key : `${path}.${key}`;
    if (isScalar(pair.key) && pair.key.type === "PLAIN" && pair.key.value === "<<") {
      paths.push(childPath);
    }
    findMergeKeys(pair.value, childPath, paths);
  }
}

/** The JavaScript key of a plain scalar mapping key, or null for keys parseYaml does not track */
function scalarKey(key: unknown): string | null {
  if (!isScalar(key)) return null;
  const value = key.value;
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? null : String(value);
}

/**
 * Walks a YAML node and its JavaScript value together. Aliases are skipped: their value is the
 * object of the anchored node, which is walked where it is defined (so an alias bomb is never
 * expanded here).
 */
function recordKeyOrder(node: Node | null | undefined | unknown, value: unknown): void {
  if (node === null || node === undefined || isAlias(node)) return;
  if (isSeq(node)) {
    if (!Array.isArray(value)) return;
    node.items.forEach((item, index) => {
      recordKeyOrder(item, value[index]);
    });
    return;
  }
  if (!isMap(node) || typeof value !== "object" || value === null || Array.isArray(value)) return;

  const mapping = value as Record<string, unknown>;
  const order: string[] = [];
  let tracked = true;
  for (const pair of node.items) {
    const key = isPair(pair) ? scalarKey(pair.key) : null;
    if (key === null) {
      tracked = false;
      continue;
    }
    order.push(key);
    recordKeyOrder(pair.value, mapping[key]);
  }
  if (!tracked) return;
  const own = Object.keys(mapping);
  // Only keys the object holds once each (anything else keeps the object's own order)
  if (own.length !== order.length || new Set(order).size !== order.length) return;
  if (order.every((key, index) => own[index] === key)) return;
  if (!order.every((key) => Object.hasOwn(mapping, key))) return;
  Object.defineProperty(mapping, SOURCE_KEY_ORDER, { value: order, configurable: true });
}
