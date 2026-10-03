/**
 * Paths in opentp.cli.yaml that must stay inside the file's directory: `output` and `file` of
 * `generate.run` entries. `opentp generate` without a generator name writes those outputs and reads
 * those templates without any consent flag, so whoever can change opentp.cli.yaml must not be able
 * to write (or, through the MCP tool, read) files elsewhere: `.git/config` or a git hook (code that
 * git runs), a file outside the repository, a secret next to it. There is no option to allow it;
 * `opentp generate <name> -o <path> --file <path>` on the command line writes and reads anywhere.
 *
 * A path is refused when it is absolute, when it has a `.git` segment, or when it leaves the
 * directory once the symbolic links of its existing part are resolved (realpath of the deepest
 * entry that exists). The check uses the same normalized path (`path.resolve`) that is then read or
 * written.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Whether a path segment names a `.git` directory: compared without case (case-insensitive file
 * systems), without trailing dots and spaces (Windows drops them), and as the Windows short name
 * `GIT~1`
 */
function isGitSegment(segment: string): boolean {
  const name = segment.replace(/[. ]+$/, "").toLowerCase();
  return name === ".git" || name === "git~1";
}

/** Whether an entry exists (a symbolic link counts, even when its target does not exist) */
function entryExists(file: string): boolean {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

function realDirectory(dir: string): string {
  try {
    return fs.realpathSync.native(dir);
  } catch {
    return path.resolve(dir);
  }
}

/**
 * The problem of a path from opentp.cli.yaml that must stay inside `dir` (the file's directory), or
 * null when it does. `value` is the path as written.
 */
export function containedPathProblem(dir: string, value: string): string | null {
  if (path.isAbsolute(value) || path.win32.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    return `'${value}' is an absolute path: write a path relative to the directory of opentp.cli.yaml`;
  }
  if (value.split(/[\\/]+/).some(isGitSegment)) {
    return `'${value}' is inside a .git directory`;
  }

  // The deepest entry that exists, with the rest of the path (which is created when written)
  const target = path.resolve(dir, value);
  let existing = target;
  const rest: string[] = [];
  while (!entryExists(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    rest.unshift(path.basename(existing));
    existing = parent;
  }
  let real: string;
  try {
    real = path.join(fs.realpathSync.native(existing), ...rest);
  } catch {
    // A dangling symbolic link (or a loop): where it points cannot be checked
    return `'${value}' contains a symbolic link that cannot be resolved`;
  }

  const relative = path.relative(realDirectory(dir), real);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return `'${value}' leaves the directory of opentp.cli.yaml (${dir})`;
  }
  if (relative.split(path.sep).some(isGitSegment)) {
    return `'${value}' is inside a .git directory`;
  }
  return null;
}
