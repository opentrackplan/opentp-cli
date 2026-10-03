/**
 * What `opentp migrate` found and did: changed and created files, warnings (changes that alter
 * meaning, or that the owner should check) and manual items (what migrate cannot fix and
 * `opentp validate` will still reject).
 */

/** A warning or manual item at a place in a file (paths relative to the plan root) */
export interface Finding {
  file: string;
  path: string;
  message: string;
}

export type FileKind = "config" | "cli-config" | "event" | "dictionary";

/** One changed or created file */
export interface FileChange {
  file: string;
  kind: FileKind;
  /** An event or dictionary file outside the events or dictionaries root (e.g. a skeleton) */
  outsideRoots?: true;
  /** What changed, one line each (`opentp: 2026-01 -> 2026-09`, `removed enum: [] (2)`, ...) */
  changes: string[];
}

/** Counts the changes made to one file, by kind of change (in the order first seen) */
export class FileNotes {
  private readonly counts = new Map<string, number>();
  private readonly details: string[] = [];

  /** A change that may happen several times (`removed enum: []`), shown with its count */
  count(change: string, times = 1): void {
    this.counts.set(change, (this.counts.get(change) ?? 0) + times);
  }

  /** A change described once (`moved keygen to opentp.cli.yaml`) */
  note(change: string): void {
    if (!this.details.includes(change)) this.details.push(change);
  }

  lines(): string[] {
    const counted = [...this.counts].map(([change, times]) =>
      times > 1 ? `${change} (${times})` : change,
    );
    return [...this.details, ...counted];
  }
}

/** Findings of one run, in the order they were found */
export class Findings {
  readonly warnings: Finding[] = [];
  readonly manual: Finding[] = [];

  warn(file: string, path: string, message: string): void {
    this.warnings.push({ file, path, message });
  }

  manualItem(file: string, path: string, message: string): void {
    if (
      this.manual.some(
        (item) => item.file === file && item.path === path && item.message === message,
      )
    ) {
      return;
    }
    this.manual.push({ file, path, message });
  }
}

// --- Messages ------------------------------------------------------------------------------------

export const REQUIRED_FALSE_REMOVED =
  "required: false next to value removed: the field is now always present (2026-09 has no optional constant; use versions for a transition period)";

export const EVENT_VALUE_REQUIRED_REMOVED =
  "valueRequired removed: 2026-09 has no valueRequired (a policy on the catalog or common field says what every event must do)";

export function valueRequiredNotPinnedMessage(field: string, unpinned: number, total: number) {
  return total === 0
    ? `valueRequired removed from '${field}': no event lists it, and 2026-09 has no 'this value if present' rule (set policy: fixed by hand if every event must pin it)`
    : `valueRequired removed from '${field}': ${unpinned} of ${total} event versions do not pin a value, and 2026-09 has no 'this value if present' rule (pin it in every event and set policy: fixed, or leave the field free)`;
}

export function valueRequiredSomeTargetsMessage(
  field: string,
  withValue: string[],
  without: string[],
): string {
  return `valueRequired removed from '${field}': only ${withValue.join(", ")} set a value in opentp.yaml; on ${without.join(", ")} events no longer have to pin it`;
}

export function typeConflictMessage(
  field: string,
  counts: Array<[string, number]>,
  chosen: string,
  files: string[],
): string {
  const listed = counts.map(([type, count]) => `${type} (${count})`).join(", ");
  const shown = files.slice(0, 5).join(", ");
  const more = files.length > 5 ? ` and ${files.length - 5} more` : "";
  return `Field '${field}' is declared with different types in events: ${listed}; the catalog uses ${chosen}. Files with another type: ${shown}${more}`;
}

export function defaultTypeMessage(field: string): string {
  return `The type of '${field}' could not be inferred (nothing declares one, and it has no value or enum): string was written; check it`;
}
