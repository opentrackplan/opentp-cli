/**
 * YAML anchors and aliases in `opentp migrate`. Edits splice text, so an anchor that an edit moves
 * after its alias, or removes, would leave an alias that cannot be resolved; these helpers find
 * such aliases (and merge keys, which 2026-09 does not support) and name their places.
 */

import {
  type Document,
  isAlias,
  isPair,
  isScalar,
  isSeq,
  type Node,
  type Pair,
  parseDocument,
  visit,
} from "yaml";
import type { Finding } from "./report";
import { keyOf } from "./text";

/** The dotted path of a node from the ancestors `visit` passes (`spec.targets.all.schema.a[0]`) */
export function nodePath(ancestors: readonly unknown[], node?: unknown): string {
  const chain = node === undefined ? ancestors : [...ancestors, node];
  const parts: string[] = [];
  chain.forEach((current, index) => {
    if (isPair(current)) {
      parts.push(keyOf(current as Pair) ?? "?");
    } else if (isSeq(current) && index + 1 < chain.length) {
      const position = current.items.indexOf(chain[index + 1] as never);
      if (parts.length === 0) parts.push(`[${position}]`);
      else parts[parts.length - 1] += `[${position}]`;
    }
  });
  return parts.join(".");
}

/** Whether a node is an alias or contains one */
export function containsAlias(node: unknown): boolean {
  if (isAlias(node)) return true;
  if (node === null || typeof node !== "object") return false;
  let found = false;
  visit(node as Node, {
    Alias() {
      found = true;
      return visit.BREAK;
    },
  });
  return found;
}

/** The paths of the aliases to an anchor in a document */
export function aliasesTo(doc: Document, anchor: string): string[] {
  const places: string[] = [];
  visit(doc, {
    Alias(_key, node, ancestors) {
      if (node.source === anchor) places.push(nodePath(ancestors, node));
    },
  });
  return places;
}

/** The paths of the nodes that carry an anchor in a document */
function anchorsNamed(doc: Document, anchor: string): string[] {
  const places: string[] = [];
  visit(doc, {
    Node(_key, node, ancestors) {
      if (!isAlias(node) && (node as Node).anchor === anchor) {
        places.push(nodePath(ancestors, node));
      }
    },
  });
  return places;
}

/**
 * Aliases of a migrated text that cannot be resolved, with the place of their anchor in the
 * original document (`original`, null for a new file)
 */
export function unresolvedAliases(
  file: string,
  original: Document | null,
  text: string,
): Finding[] {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return [];
  const findings: Finding[] = [];
  visit(doc, {
    Alias(_key, node, ancestors) {
      if (node.resolve(doc) !== undefined) return;
      const where = nodePath(ancestors, node);
      const anchors = original ? anchorsNamed(original, node.source) : [];
      findings.push({
        file,
        path: where,
        message:
          anchors.length > 0
            ? `The alias *${node.source} needs the anchor &${node.source} set at ${anchors.join(", ")}, which the migration moves after the alias or removes: expand the alias (write the anchored content in its place) and run opentp migrate again`
            : `The alias *${node.source} has no anchor after the migration: expand the alias (write the anchored content in its place) and run opentp migrate again`,
      });
    },
  });
  return findings;
}

/** The paths of the YAML merge keys (a plain `<<` key) in a document */
export function mergeKeyPaths(doc: Document): string[] {
  const places: string[] = [];
  visit(doc, {
    Pair(_key, pair, ancestors) {
      if (isScalar(pair.key) && pair.key.type === "PLAIN" && pair.key.value === "<<") {
        places.push(nodePath(ancestors, pair));
      }
    },
  });
  return places;
}
