/**
 * opentp.cli.yaml for a migrated plan: created when keygen or webhook bindings move out of the
 * plan (with the schema modeline, `opentp` and `cli`), or merged into an existing file (a section
 * equal to the existing one changes nothing; a different one is an error).
 */

import { isMap, isScalar, type Pair, type YAMLMap } from "yaml";
import { SPEC_VERSION, VERSION } from "../meta";
import { containsAlias } from "./aliases";
import { canonicalJson, type NewBinding, WEBHOOK_SETTINGS } from "./analysis";
import { atPath, blockMappingError, MigrationError, type MovedKeygen } from "./config";
import { FileNotes } from "./report";
import { parseYaml, type ScannedFile } from "./scan";
import {
  applyEdits,
  blockPairSpan,
  columnOf,
  type Edit,
  EditError,
  EditList,
  findPair,
  keyOf,
  lineEnd,
  lineEnding,
  lineStart,
  mapAt,
  pairStart,
  reindent,
  renderBlock,
  sliceWithEdits,
  startWithComments,
  withEol,
  withFinalEol,
} from "./text";

export const CLI_SCHEMA_MODELINE =
  "# yaml-language-server: $schema=https://opentp.dev/schemas/cli/opentp.cli.schema.json";

/** The CLI versions a migrated plan pins: the minor line of this CLI (`>=0.10 <0.11`) */
export function cliRange(version: string = VERSION): string {
  const [major, minor] = version.split(".").map((part) => Number.parseInt(part, 10));
  return major === 0 ? `>=0.${minor} <0.${minor + 1}` : `>=${major}.${minor} <${major + 1}`;
}

/** An existing opentp.cli.yaml */
export interface ExistingCliConfig {
  rel: string;
  text: string;
  doc: ScannedFile["doc"];
  data: Record<string, unknown>;
}

/** The webhook configurations bound in an existing file, by binding id */
export function existingWebhooks(existing: ExistingCliConfig | null): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const checks = existing?.data.checks;
  const bindings =
    checks && typeof checks === "object" ? (checks as Record<string, unknown>).bindings : undefined;
  if (!bindings || typeof bindings !== "object") return out;
  for (const [id, binding] of Object.entries(bindings as Record<string, unknown>)) {
    const webhook =
      binding && typeof binding === "object"
        ? (binding as Record<string, unknown>).webhook
        : undefined;
    out.set(id, webhook === undefined ? { __binding: binding } : webhook);
  }
  return out;
}

/**
 * The edits that normalizeWebhook makes to a block mapping, as text edits: the method's scalar
 * upper-cased (same quoting), the lines of dropped keys removed.
 * @throws EditError when a change cannot be made as text
 */
function normalizationEdits(text: string, node: YAMLMap): Edit[] {
  const edits = new EditList();
  for (const pair of node.items as Pair[]) {
    const key = keyOf(pair);
    if (key === null || !WEBHOOK_SETTINGS.includes(key)) {
      const [start, end] = blockPairSpan(text, pair);
      edits.add(start, end, "");
    } else if (key === "method" && isScalar(pair.value) && pair.value.range) {
      const { type, range } = pair.value;
      const quote = type === "QUOTE_DOUBLE" ? '"' : type === "QUOTE_SINGLE" ? "'" : "";
      if (type !== "PLAIN" && quote === "") throw new EditError("a block scalar");
      const method = String(pair.value.value);
      if (method.toUpperCase() !== method) {
        edits.add(range[0], range[1], `${quote}${method.toUpperCase()}${quote}`);
      }
    }
  }
  return edits.edits;
}

/**
 * The text of a binding's webhook configuration, from the file where the check was written (from
 * its data when it uses aliases, which cannot travel to another file, or when it was normalized
 * and is not a block mapping whose changes can be made as text)
 */
function webhookSource(binding: NewBinding, valueColumn: number, eol: string): string {
  const fromData = (): string => `webhook:${eol}${renderBlock(binding.config, valueColumn, eol)}`;
  if (containsAlias(binding.pair.value)) return fromData();
  const node = binding.pair.value as YAMLMap;
  const text = binding.file.text;
  const [start, end] = node.range as [number, number, number];
  if (isMap(node) && !node.flow) {
    let edits: Edit[] = [];
    if (binding.normalized) {
      try {
        edits = normalizationEdits(text, node);
      } catch (error) {
        if (error instanceof EditError) return fromData();
        throw error;
      }
    }
    const block = sliceWithEdits(
      text,
      startWithComments(text, lineStart(text, start)),
      lineEnd(text, end - 1),
      edits,
    ).replace(/\r\n/g, "\n");
    // The edited text must say what the binding says
    if (binding.normalized && !sameData(parseYaml(block).data, binding.config)) return fromData();
    return `webhook:${eol}${withFinalEol(withEol(reindent(block, columnOf(text, start), valueColumn), eol), eol)}`;
  }
  if (binding.normalized) return fromData();
  return `webhook: ${text.slice(start, end)}${eol}`;
}

function sameData(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** `<id>:` / `webhook:` / the configuration, for each binding, starting at `column` */
function bindingLines(bindings: NewBinding[], column: number, step: number, eol: string): string {
  return bindings
    .map(
      (binding) =>
        `${" ".repeat(column)}${binding.id}:${eol}${" ".repeat(column + step)}${webhookSource(binding, column + 2 * step, eol)}`,
    )
    .join("");
}

function keygenSection(keygen: MovedKeygen, eol: string): string {
  return keygen.block
    ? `keygen:${eol}${withFinalEol(withEol(keygen.text.replace(/\r\n/g, "\n"), eol), eol)}`
    : `keygen: ${keygen.text}${eol}`;
}

/** A line break to write before text inserted at `position` (the end of a last line without one) */
function lineBreakAt(text: string, position: number, eol: string): string {
  return position === text.length && !text.endsWith("\n") ? eol : "";
}

export interface CliConfigOutput {
  text: string;
  notes: FileNotes;
}

/**
 * The new or merged opentp.cli.yaml, or null when nothing has to change.
 * @throws MigrationError when the existing file has a different keygen, or sections in flow style
 */
export function buildCliConfig(
  existing: ExistingCliConfig | null,
  keygen: MovedKeygen | null,
  bindings: NewBinding[],
): CliConfigOutput | null {
  const notes = new FileNotes();
  if (!existing) {
    if (!keygen && bindings.length === 0) return null;
    const eol = "\n";
    let text = `${CLI_SCHEMA_MODELINE}${eol}opentp: ${SPEC_VERSION}${eol}cli: "${cliRange()}"${eol}`;
    if (keygen) {
      text += `${eol}${keygenSection(keygen, eol)}`;
      notes.note("keygen from opentp.yaml");
    }
    if (bindings.length > 0) {
      text += `${eol}checks:${eol}  bindings:${eol}${bindingLines(bindings, 4, 2, eol)}`;
      notes.note(`webhook bindings: ${bindings.map((binding) => binding.id).join(", ")}`);
    }
    return { text, notes };
  }

  const { text, data } = existing;
  const eol = lineEnding(text);
  const edits = new EditList();
  const root = existing.doc.contents;
  if (!isMap(root)) throw new MigrationError("Expected a mapping with 'opentp'", "", existing.rel);

  // Header
  const header = findPair(root, "opentp")?.value;
  if (isScalar(header) && header.value !== SPEC_VERSION && header.range) {
    const quote = header.type === "QUOTE_DOUBLE" ? '"' : header.type === "QUOTE_SINGLE" ? "'" : "";
    edits.add(header.range[0], header.range[1], `${quote}${SPEC_VERSION}${quote}`);
    notes.note(`opentp: ${String(header.value)} -> ${SPEC_VERSION}`);
  }

  let appended = "";
  if (keygen) {
    if (data.keygen !== undefined) {
      if (canonicalJson(data.keygen) !== canonicalJson(keygen.data)) {
        throw new MigrationError(
          "This file already has a keygen that differs from spec.events.x-opentp.keygen in opentp.yaml: keep one (remove the other) and run opentp migrate again",
          "keygen",
          existing.rel,
        );
      }
    } else {
      appended += keygenSection(keygen, eol);
      notes.note("keygen from opentp.yaml");
    }
  }

  if (bindings.length > 0) {
    notes.note(`webhook bindings: ${bindings.map((binding) => binding.id).join(", ")}`);
    const checksPair = findPair(root, "checks");
    const checks = mapAt(root, "checks");
    if (!checksPair) {
      appended += `checks:${eol}  bindings:${eol}${bindingLines(bindings, 4, 2, eol)}`;
    } else {
      if (!checks || checks.flow || checks.items.length === 0) {
        throw blockMappingError("checks", checksPair.value, existing.rel);
      }
      const checksColumn = columnOf(text, pairStart((checks.items as Pair[])[0]));
      const bindingsPair = findPair(checks, "bindings");
      const bindingsMap = mapAt(checks, "bindings");
      if (!bindingsPair) {
        const last = (checks.items as Pair[])[checks.items.length - 1];
        const [, end] = atPath("checks", () => blockPairSpan(text, last), existing.rel);
        const step = Math.max(checksColumn, 2);
        edits.add(
          end,
          end,
          `${lineBreakAt(text, end, eol)}${" ".repeat(checksColumn)}bindings:${eol}${bindingLines(bindings, checksColumn + step, step, eol)}`,
        );
      } else {
        if (!bindingsMap || bindingsMap.flow || bindingsMap.items.length === 0) {
          throw blockMappingError("checks.bindings", bindingsPair.value, existing.rel);
        }
        const items = bindingsMap.items as Pair[];
        const column = columnOf(text, pairStart(items[0]));
        const [, end] = atPath(
          "checks.bindings",
          () => blockPairSpan(text, items[items.length - 1]),
          existing.rel,
        );
        const step = Math.max(column - checksColumn, 2);
        edits.add(
          end,
          end,
          `${lineBreakAt(text, end, eol)}${bindingLines(bindings, column, step, eol)}`,
        );
      }
    }
  }

  if (edits.size === 0 && appended === "") return null;
  const edited = applyEdits(text, edits.edits);
  if (appended === "") return { text: edited, notes };
  // New sections go at the end, after one blank line
  let prefix = "";
  if (edited.length > 0 && !edited.endsWith("\n")) prefix += eol;
  if (edited.trim() !== "" && !/\n[ \t]*\r?\n$/.test(edited)) prefix += eol;
  return { text: `${edited}${prefix}${appended}`, notes };
}
