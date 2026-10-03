/**
 * Finds the files `opentp migrate` reads: every `*.yaml`/`*.yml` under the plan root (dot
 * directories, `node_modules` and the root tool files skipped), parsed once with the YAML 1.2 core
 * schema like every other command. The events and dictionaries roots are walked through their
 * configured paths, also when they are symbolic links or outside the plan root, and symbolic links
 * to YAML files inside them are read through the link (as validate reads them; a write goes to the
 * link's target). Other symbolic links are not followed and are listed.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { type Document, isMap, parseDocument } from "yaml";
import { ROOT_TOOL_FILES } from "../core/config";
import { formatLoadError, isYamlMapping } from "../util";

export type ScannedKind = "event" | "dictionary" | "other";

export interface ScannedFile {
  /** Path relative to the plan root, with `/` separators */
  rel: string;
  abs: string;
  text: string;
  doc: Document.Parsed;
  /** The parsed document as plain data */
  data: unknown;
  kind: ScannedKind;
  /** The value of the root `opentp` key, if it is a string */
  version: string | null;
}

export interface UnparsableFile {
  file: string;
  message: string;
}

export interface ScanResult {
  files: ScannedFile[];
  /**
   * Plan files that cannot be loaded, and directories of the events and dictionaries roots that
   * cannot be read: nothing is written
   */
  unparsable: UnparsableFile[];
  /** Other YAML files that cannot be loaded: not plan files, skipped (listed as warnings) */
  skipped: UnparsableFile[];
  /** Other directories that cannot be read: skipped (listed as warnings) */
  skippedDirectories: UnparsableFile[];
  /** Symbolic links to YAML files outside the events and dictionaries roots: never followed */
  symlinks: string[];
  /**
   * Symbolic links inside the events and dictionaries roots to a file that is migrated under
   * another path (`target`, relative to the plan root)
   */
  linkedTwice: Array<{ link: string; target: string }>;
  /** Symbolic links to directories (other than the events and dictionaries roots): not followed */
  directoryLinks: string[];
}

/** A root `opentp: 2026-01` line, for files that cannot be parsed */
const PREVIOUS_HEADER = /^(?:\uFEFF)?opentp:[ \t]*["']?2026-01["']?[ \t]*(?:#.*)?$/m;

function isYamlFile(name: string): boolean {
  return /\.ya?ml$/i.test(name);
}

/** Directories that are never walked (and links to them never listed) */
function isSkippedDirectory(name: string): boolean {
  return name.startsWith(".") || name === "node_modules";
}

function realPathOf(file: string): string | null {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
}

interface Listing {
  files: string[];
  symlinks: string[];
  linkedTwice: Array<{ link: string; target: string }>;
  directoryLinks: string[];
  unreadable: Array<{ dir: string; message: string; inPlan: boolean }>;
}

/** A YAML file found by the walk: a file, or a symbolic link inside a plan directory */
interface Candidate {
  abs: string;
  /** The real path of the file (the link's own path for a link that leads nowhere) */
  real: string;
  link: boolean;
  /** Inside the events or dictionaries root */
  inPlan: boolean;
}

/**
 * Lists the YAML files of the events and dictionaries roots (`planDirs`, through their configured
 * paths, symbolic links followed) and of the plan root. A directory is walked once, by its real
 * path, so files are listed under the configured roots when a root is also reachable another way.
 * A file reached by more than one path (a symbolic link to it) is listed once: preferably under a
 * path inside a plan directory, then under its own path, then by relative path.
 */
function listYamlFiles(root: string, planDirs: readonly string[]): Listing {
  const listing: Listing = {
    files: [],
    symlinks: [],
    linkedTwice: [],
    directoryLinks: [],
    unreadable: [],
  };
  const toolFiles = new Set(ROOT_TOOL_FILES.map((name) => path.resolve(root, name)));
  const planDirReals = new Set(
    planDirs.map(realPathOf).filter((dir): dir is string => dir !== null),
  );
  const walked = new Set<string>();
  const candidates: Candidate[] = [];

  const walk = (dir: string, real: string, inPlan: boolean): void => {
    if (walked.has(real)) return;
    walked.add(real);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      listing.unreadable.push({ dir, message: formatLoadError(error), inPlan });
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (toolFiles.has(path.resolve(full))) continue;
      if (entry.isSymbolicLink()) {
        const target = realPathOf(full);
        // An events or dictionaries root: walked through its configured path
        if (target !== null && planDirReals.has(target)) continue;
        let isDirectory = false;
        try {
          isDirectory = fs.statSync(full).isDirectory();
        } catch {
          isDirectory = false;
        }
        if (isDirectory) {
          if (!isSkippedDirectory(entry.name)) listing.directoryLinks.push(full);
        } else if (isYamlFile(entry.name)) {
          // validate reads a link inside the events or dictionaries root like a file
          if (inPlan) candidates.push({ abs: full, real: target ?? full, link: true, inPlan });
          else listing.symlinks.push(full);
        }
        continue;
      }
      if (entry.isDirectory()) {
        if (isSkippedDirectory(entry.name)) continue;
        walk(full, path.join(real, entry.name), inPlan);
      } else if (entry.isFile() && isYamlFile(entry.name)) {
        candidates.push({ abs: full, real: path.join(real, entry.name), link: false, inPlan });
      }
    }
  };
  for (const dir of planDirs) {
    const resolved = path.resolve(dir);
    walk(resolved, realPathOf(resolved) ?? resolved, true);
  }
  const resolvedRoot = path.resolve(root);
  walk(resolvedRoot, realPathOf(resolvedRoot) ?? resolvedRoot, false);

  const rel = (file: string) => relativePath(root, file);
  const byRel = (a: string, b: string) => (rel(a) < rel(b) ? -1 : rel(a) > rel(b) ? 1 : 0);

  // One entry per real file
  const preferred = (a: Candidate, b: Candidate): number =>
    Number(b.inPlan) - Number(a.inPlan) || Number(a.link) - Number(b.link) || byRel(a.abs, b.abs);
  const byReal = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const list = byReal.get(candidate.real);
    if (list) list.push(candidate);
    else byReal.set(candidate.real, [candidate]);
  }
  for (const list of byReal.values()) {
    const [kept, ...others] = [...list].sort(preferred);
    listing.files.push(kept.abs);
    for (const other of others) {
      if (other.link) listing.linkedTwice.push({ link: other.abs, target: kept.abs });
    }
  }

  listing.files.sort(byRel);
  listing.symlinks.sort(byRel);
  listing.linkedTwice.sort((a, b) => byRel(a.link, b.link));
  listing.directoryLinks.sort(byRel);
  return listing;
}

/** Path relative to the plan root, with `/` separators */
export function relativePath(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

export interface ParsedYaml {
  doc: Document.Parsed;
  /** The document as plain data (undefined when it cannot be loaded) */
  data: unknown;
  error: string | null;
}

/**
 * Parses and loads YAML text like the other commands do: duplicate keys, syntax errors and aliases
 * that cannot be resolved (an alias before its anchor, too many aliases) are errors
 */
export function parseYaml(text: string): ParsedYaml {
  const doc = parseDocument(text, { prettyErrors: true });
  if (doc.errors.length > 0) return { doc, data: undefined, error: formatLoadError(doc.errors[0]) };
  try {
    return { doc, data: doc.toJS(), error: null };
  } catch (error) {
    return { doc, data: undefined, error: formatLoadError(error) };
  }
}

/**
 * Scans the plan root, and the events and dictionaries roots (`planDirs`). A file that cannot be
 * loaded is listed in `unparsable` when it is under one of `planDirs` or starts with an
 * `opentp: 2026-01` line; other files that cannot be loaded are not plan files and are skipped
 * (`skipped`). A directory that cannot be read is listed in `unparsable` when it is one of
 * `planDirs` or inside one (validate would read it), else in `skippedDirectories`.
 */
export function scanPlan(root: string, planDirs: readonly string[]): ScanResult {
  const listing = listYamlFiles(root, planDirs);
  const files: ScannedFile[] = [];
  const unparsable: UnparsableFile[] = [];
  const skippedDirectories: UnparsableFile[] = [];
  for (const { dir, message, inPlan } of listing.unreadable) {
    const file = relativePath(root, dir);
    if (inPlan) unparsable.push({ file, message: `Cannot read this directory (${message})` });
    else skippedDirectories.push({ file, message });
  }
  const skipped: UnparsableFile[] = [];
  const inPlanDir = (file: string) => planDirs.some((dir) => isInside(path.resolve(dir), file));

  for (const abs of listing.files) {
    const rel = relativePath(root, abs);
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf-8");
    } catch (error) {
      unparsable.push({ file: rel, message: formatLoadError(error) });
      continue;
    }
    const { doc, data, error } = parseYaml(text);
    if (error !== null) {
      if (inPlanDir(abs) || PREVIOUS_HEADER.test(text))
        unparsable.push({ file: rel, message: error });
      else skipped.push({ file: rel, message: error });
      continue;
    }
    if (!isYamlMapping(data) || !isMap(doc.contents)) continue;
    const version = typeof data.opentp === "string" ? data.opentp : null;
    if (version === null) continue;
    const isEvent = Object.hasOwn(data, "event");
    const isDictionary = Object.hasOwn(data, "dict");
    const kind: ScannedKind =
      isEvent && !isDictionary ? "event" : isDictionary && !isEvent ? "dictionary" : "other";
    files.push({ rel, abs, text, doc, data, kind, version });
  }

  return {
    files,
    unparsable,
    skipped,
    skippedDirectories,
    symlinks: listing.symlinks.map((file) => relativePath(root, file)),
    linkedTwice: listing.linkedTwice.map(({ link, target }) => ({
      link: relativePath(root, link),
      target: relativePath(root, target),
    })),
    directoryLinks: listing.directoryLinks.map((file) => relativePath(root, file)),
  };
}

/** Whether `file` is inside `dir` (absolute paths) */
export function isInside(dir: string | null, file: string): boolean {
  if (dir === null) return false;
  const relative = path.relative(dir, file);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
