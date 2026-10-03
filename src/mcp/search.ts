/**
 * Lexical event search: BM25 over character trigrams.
 *
 * Trigrams are language-agnostic (no stemmer, no stop words, no locale) and tolerate typos and word
 * forms. Text is normalized
 * with Unicode rules only: NFKD, combining marks removed (so "é" matches "e" and "ё" matches "е"),
 * lowercase.
 */

import type { Field, ResolvedEvent } from "../types";

const K1 = 1.2;
const B = 0.75;
/** Words shorter than this are ignored (single letters only add noise) */
const MIN_WORD_LENGTH = 2;
/** Enums longer than this are left out of the event document (they are shared vocabularies) */
const MAX_ENUM_VALUES = 10;

export function normalizeText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

/** The words of a text: runs of letters and digits, at least MIN_WORD_LENGTH long */
export function words(text: string): string[] {
  return normalizeText(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => [...word].length >= MIN_WORD_LENGTH);
}

/** Character trigrams of every word, with `_` marking the word boundaries ("_lo", "log", ...) */
export function trigrams(text: string): string[] {
  const out: string[] = [];
  for (const word of words(text)) {
    const chars = [..."_", ...word, "_"];
    for (let i = 0; i + 3 <= chars.length; i++) out.push(chars.slice(i, i + 3).join(""));
  }
  return out;
}

export interface SearchHit {
  /** Index of the document in the array given to the index */
  index: number;
  score: number;
}

/** A BM25 index over character trigrams with an inverted list per trigram */
export class TrigramIndex {
  private readonly postings = new Map<string, Array<[doc: number, tf: number]>>();
  private readonly lengths: number[];
  private readonly averageLength: number;

  constructor(documents: readonly string[]) {
    this.lengths = documents.map((text, doc) => {
      const counts = new Map<string, number>();
      const grams = trigrams(text);
      for (const gram of grams) counts.set(gram, (counts.get(gram) ?? 0) + 1);
      for (const [gram, tf] of counts) {
        let list = this.postings.get(gram);
        if (!list) {
          list = [];
          this.postings.set(gram, list);
        }
        list.push([doc, tf]);
      }
      return grams.length;
    });
    const total = this.lengths.reduce((sum, length) => sum + length, 0);
    this.averageLength = total > 0 ? total / this.lengths.length : 1;
  }

  get size(): number {
    return this.lengths.length;
  }

  /** The best `limit` documents for `query`, highest score first; documents with no match are left out */
  search(query: string, limit: number): SearchHit[] {
    const n = this.lengths.length;
    const scores = new Map<number, number>();
    for (const gram of new Set(trigrams(query))) {
      const list = this.postings.get(gram);
      if (!list) continue;
      const idf = Math.log(1 + (n - list.length + 0.5) / (list.length + 0.5));
      for (const [doc, tf] of list) {
        const norm = K1 * (1 - B + (B * this.lengths[doc]) / this.averageLength);
        scores.set(doc, (scores.get(doc) ?? 0) + (idf * tf * (K1 + 1)) / (tf + norm));
      }
    }
    return [...scores]
      .map(([index, score]) => ({ index, score }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, limit);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalarText(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(scalarText);
  if (typeof value === "object") return [];
  return [String(value)];
}

/** Text from the fields an event defines itself (base fields are the same everywhere: no signal) */
function fieldText(name: string, field: Field): string[] {
  const parts = [name];
  for (const key of ["title", "name", "description"] as const) {
    const value = field[key];
    if (typeof value === "string") parts.push(value);
  }
  parts.push(...scalarText(field.value));
  if (Array.isArray(field.enum) && field.enum.length <= MAX_ENUM_VALUES) {
    parts.push(...scalarText(field.enum));
  }
  return parts;
}

/** Every `schema` mapping in a raw event payload, whatever its shape (implicit, versioned, selectors) */
function collectSchemas(value: unknown, out: Array<Record<string, unknown>>): void {
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "schema" && isPlainObject(child)) out.push(child);
    else collectSchemas(child, out);
  }
}

/**
 * The search document of one event: its key, taxonomy values (including descriptions such as a
 * trigger), and the names, titles, descriptions, fixed values and small enums of the payload fields
 * it defines. The file path is left out: every path variable is a taxonomy field, so its values are
 * already here, and repeating them only skews the ranking.
 */
export function eventDocument(event: ResolvedEvent): string {
  const parts: string[] = [typeof event.key === "string" ? event.key : ""];
  for (const value of Object.values(event.taxonomy)) parts.push(...scalarText(value));
  const schemas: Array<Record<string, unknown>> = [];
  collectSchemas(event.payload, schemas);
  for (const schema of schemas) {
    for (const [name, field] of Object.entries(schema)) {
      if (isPlainObject(field)) parts.push(...fieldText(name, field as Field));
    }
  }
  return parts.filter((part) => part.length > 0).join("\n");
}
