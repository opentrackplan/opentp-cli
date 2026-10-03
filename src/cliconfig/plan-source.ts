/**
 * Application repository mode: where the plan named by `plan:` in an application's opentp.cli.yaml
 * lives.
 *
 * - A value is a git URL when it starts with `git+ssh://`, `git+https://` or `git+file://` (git gets
 *   it without `git+`) and ends with `#<ref>`, where the ref is a tag or a 40-hex commit SHA. Other
 *   URL-like values (`https://...`, `git@host:org/repo.git`) are refused with a hint.
 * - Anything else is a local path: absolute, or relative to the application file's directory (`/`
 *   and `\` both work).
 *
 * A git plan is fetched once with the system `git` into
 * `<cache root>/plans/<first 16 hex of sha256(<url>#<ref>)>` and never refreshed: a tag or a commit
 * names fixed content, so a cached ref is used without any network access. Delete the directory to
 * fetch it again. A tag is resolved to its object id with `git ls-remote` and fetched by that id, so
 * a branch with the same name never takes its place; the checked-out commit must be the tag's
 * commit. A commit SHA may also name an annotated tag object; the commit it points to is checked
 * out.
 *
 * git never starts looking for a repository in a directory that someone else controls: the cache
 * root can be inside a checkout under review (OPENTP_CACHE_DIR in CI), and so can the current
 * directory, and a bare repository layout committed there would make git read its config (for
 * example `core.sshCommand`, which runs a command). Each fetch works in a fresh directory under the
 * system's temporary directory: `git ls-remote` runs there (with GIT_CEILING_DIRECTORIES at its
 * parent, so git looks nowhere else), the repository is created inside it, every later command
 * names that repository with `-C`, and every command gets `-c safe.bareRepository=explicit`. The finished checkout is then
 * moved into the cache (renamed, or copied next to its place and renamed when the cache is on
 * another file system), so concurrent runs never see half a clone; the run that loses the rename
 * uses the winner's clone. On Windows the fresh directory also keeps a `git.exe` of an untrusted
 * checkout from being found before the one on PATH.
 *
 * The plan URL is never written into the clone's git configuration (it is fetched by URL, not
 * through a remote), and FETCH_HEAD is removed, so no token in a URL stays on disk. Credentials in
 * a URL (`https://user:token@host/...`) never reach a message or a log line (redactCredentials).
 */

import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Environment variable with the cache root (default: the platform's cache directory) */
export const CACHE_DIR_ENV = "OPENTP_CACHE_DIR";

/** Timeout of one git command */
export const GIT_TIMEOUT_MS = 120_000;

/** Prefixes of a git URL in `plan:` (git gets the URL without `git+`) */
export const GIT_URL_PREFIXES = ["git+ssh://", "git+https://", "git+file://"] as const;

const COMMIT_SHA = /^[0-9a-f]{40}$/i;
/** An object id in git's output: SHA-1 (40 hex) or SHA-256 (64 hex) */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const SCP_LIKE = /^[^/\\]+@[^:]+:/;

/** `<scheme>://<user information>@` (up to the last `@` before the host) */
const URL_USERINFO = /([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/\s'"]*@/g;
/** `<user>:<password>@<host>:` of an scp-like address (a bare `git@host:` is not a credential) */
const SCP_PASSWORD = /(^|[\s'"])[^\s/\\'"@:]+:[^\s/\\'"@]*@(?=[^\s/\\'"@:]+:)/g;

/**
 * Text with the credentials of URLs hidden: the user information of every `<scheme>://` URL and
 * the password of an scp-like address become `***` (`https://***@example.com/plan.git`). For every
 * message and log line that shows a plan URL, and for git's output.
 */
export function redactCredentials(text: string): string {
  return text.replace(URL_USERINFO, "$1***@").replace(SCP_PASSWORD, "$1***@");
}

/**
 * Git environment variables that point a git command at a repository (as `git rev-parse
 * --local-env-vars` lists them). They are removed for the clone: inside a git hook they name the
 * hook's repository, and git commands for the plan must not touch it.
 */
const REPOSITORY_ENV_VARS = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_QUARANTINE_PATH",
];

/** A problem with `plan:` (reported as `opentp.cli.yaml: plan: <message>`, exit 2) */
export class PlanSourceError extends Error {
  constructor(
    message: string,
    /** More lines, e.g. git's stderr */
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

export interface LocalPlanSource {
  kind: "path";
  /** `plan:` as written */
  written: string;
  /** Absolute directory */
  dir: string;
}

export interface GitPlanSource {
  kind: "git";
  /** `plan:` as written */
  written: string;
  /** The URL for git (without `git+` and `#<ref>`) */
  url: string;
  /** The tag or commit SHA after `#` (a SHA in lowercase) */
  ref: string;
  /** The ref is a 40-hex commit SHA */
  sha: boolean;
}

export type PlanSource = LocalPlanSource | GitPlanSource;

/**
 * A hint for a URL written without `git+`: the same URL as a git URL, when there is an obvious one
 * (`value` has its credentials hidden already)
 */
function gitUrlHint(value: string): string {
  const withRef = (url: string) => (url.includes("#") ? url : `${url}#<tag or commit SHA>`);
  const scheme = /^(ssh|https|file):\/\//i.exec(value);
  if (scheme) return `, e.g. git+${withRef(value)}`;
  const scp = /^([^/\\]+@[^:]+):(.*)$/.exec(value);
  if (scp && !URL_SCHEME.test(value)) {
    return `, e.g. git+ssh://${withRef(`${scp[1]}/${scp[2].replace(/^\/+/, "")}`)}`;
  }
  return "";
}

/**
 * Reads a `plan:` value. A local path is resolved against `baseDir` (the application file's
 * directory) but not checked here.
 * @throws PlanSourceError for a URL that is not a supported git URL, or a git URL without a ref
 */
export function parsePlanSource(value: string, baseDir: string): PlanSource {
  const shown = redactCredentials(value);
  if (value.startsWith("git+")) {
    const prefix = GIT_URL_PREFIXES.find((candidate) => value.startsWith(candidate));
    if (!prefix) {
      throw new PlanSourceError(
        `'${shown}' is not a supported git URL: use git+ssh://, git+https:// or git+file:// with #<tag or commit SHA>`,
      );
    }
    const hash = value.indexOf("#");
    const url = value.slice("git+".length, hash === -1 ? undefined : hash);
    const ref = hash === -1 ? "" : value.slice(hash + 1);
    if (url.length <= prefix.length - "git+".length) {
      throw new PlanSourceError(`'${shown}' has no repository after ${prefix}`);
    }
    if (ref === "") {
      throw new PlanSourceError(
        `a git URL needs #<tag or commit SHA> at the end, e.g. ${shown.replace(/#$/, "")}#v1.0.0`,
      );
    }
    // A ref is one git ref name: no whitespace or control characters, no leading '-'
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it rejects
    if (/[\s\u0000-\u001f\u007f]/.test(ref) || ref.startsWith("-")) {
      throw new PlanSourceError(`plan ref must be a tag or a commit SHA: '${ref}'`);
    }
    const sha = COMMIT_SHA.test(ref);
    return { kind: "git", written: value, url, ref: sha ? ref.toLowerCase() : ref, sha };
  }
  if (URL_SCHEME.test(value) || SCP_LIKE.test(value)) {
    throw new PlanSourceError(
      `'${shown}' looks like a URL: write a git URL as git+ssh://, git+https:// or git+file:// with #<tag or commit SHA>${gitUrlHint(shown)}`,
    );
  }
  // Both separators work; Windows paths (drive letters, `\`) are native there
  const normalized = path.sep === "/" ? value.replace(/\\/g, "/") : value;
  return { kind: "path", written: value, dir: path.resolve(baseDir, normalized) };
}

/**
 * The cache root: OPENTP_CACHE_DIR, else `$XDG_CACHE_HOME/opentp` or `~/.cache/opentp` (Linux and
 * other systems), `~/Library/Caches/opentp` (macOS), `%LOCALAPPDATA%\opentp\Cache` (Windows)
 */
export function cacheRoot(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  const explicit = env[CACHE_DIR_ENV];
  if (explicit) return path.resolve(explicit);
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || path.win32.join(home, "AppData", "Local");
    return path.win32.join(local, "opentp", "Cache");
  }
  if (platform === "darwin") return path.posix.join(home, "Library", "Caches", "opentp");
  const xdg = env.XDG_CACHE_HOME;
  // XDG: a relative path is invalid and ignored
  const base = xdg && path.posix.isAbsolute(xdg) ? xdg : path.posix.join(home, ".cache");
  return path.posix.join(base, "opentp");
}

/** `<url>#<ref>` of a git plan for messages and logs, with credentials hidden */
export function planLabel(source: Pick<GitPlanSource, "url" | "ref">): string {
  return redactCredentials(`${source.url}#${source.ref}`);
}

/** The cache directory of a git plan: `<root>/plans/<first 16 hex of sha256(<url>#<ref>)>` */
export function planCacheDir(root: string, source: Pick<GitPlanSource, "url" | "ref">): string {
  const hash = createHash("sha256").update(`${source.url}#${source.ref}`).digest("hex");
  return path.join(root, "plans", hash.slice(0, 16));
}

/** The result of one git command */
export interface GitResult {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Spawn failure: git missing (ENOENT), timeout (ETIMEDOUT) */
  error?: Error & { code?: string };
}

/**
 * Runs git with an argument array in the directory `cwd` (replaceable in tests). fetchGitPlan
 * always passes the fresh temporary directory of the fetch.
 */
export type GitRunner = (args: string[], env: NodeJS.ProcessEnv, cwd: string) => GitResult;

/** The system git: no shell, no prompts, 120 s per command */
export const runGit: GitRunner = (args, env, cwd) => {
  const result: SpawnSyncReturns<string> = spawnSync("git", args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error as Error & { code?: string } } : {}),
  };
};

/** The environment of the git commands: no terminal prompts, no repository of the caller */
export function gitEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env, GIT_TERMINAL_PROMPT: "0" };
  for (const name of REPOSITORY_ENV_VARS) delete out[name];
  return out;
}

export interface FetchPlanOptions {
  /** Environment (cache root, git); default: process.env */
  env?: NodeJS.ProcessEnv;
  /** Runs git (default: the system git) */
  git?: GitRunner;
  /** Called before a clone starts (e.g. to log that the plan is being fetched) */
  onFetch?: (source: GitPlanSource, dir: string) => void;
}

/** git's stderr as lines, with credentials hidden */
function stderrLines(result: GitResult): string[] {
  return result.stderr
    .split(/\r?\n/)
    .map((line) => redactCredentials(line.trimEnd()))
    .filter((line) => line.trim() !== "");
}

/**
 * How fetchGitPlan runs git: the runner, its environment (with GIT_CEILING_DIRECTORIES) and the
 * directory (the fresh temporary directory of the fetch)
 */
interface GitContext {
  git: GitRunner;
  env: NodeJS.ProcessEnv;
  cwd: string;
}

/**
 * Passed before every git command: git uses a bare repository only when it is named explicitly
 * (`-C`, GIT_DIR), never one it finds on its own (git 2.38 and later; older versions ignore it)
 */
const GIT_SAFETY_OPTIONS = ["-c", "safe.bareRepository=explicit"] as const;

/**
 * Runs one git command (after GIT_SAFETY_OPTIONS); throws PlanSourceError with git's stderr when it
 * fails. `what` names the command in messages (with credentials hidden).
 */
function gitStep(context: GitContext, args: string[], what: string): GitResult {
  const result = context.git([...GIT_SAFETY_OPTIONS, ...args], context.env, context.cwd);
  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new PlanSourceError(
        "git is needed for a git URL in plan:, but it was not found on PATH",
      );
    }
    if (result.error.code === "ETIMEDOUT") {
      throw new PlanSourceError(`${what} timed out after ${GIT_TIMEOUT_MS / 1000} s`);
    }
    throw new PlanSourceError(
      `${what} failed: ${redactCredentials(result.error.message)}`,
      stderrLines(result),
    );
  }
  if (result.status !== 0) {
    throw new PlanSourceError(
      `${what} failed (git exit code ${result.status ?? "unknown"})`,
      stderrLines(result),
    );
  }
  return result;
}

/** The error text of an exception */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Creates a directory of the cache (and its parents) */
function makeCacheDirectory(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    throw new PlanSourceError(
      `cannot create the cache directory ${dir} (set ${CACHE_DIR_ENV} to another directory): ${errorText(error)}`,
    );
  }
}

/** The object ids that `git ls-remote` names for a tag */
interface TagIds {
  /** The id of refs/tags/<tag>: the commit, or the tag object of an annotated tag */
  object: string;
  /** The commit it names (`refs/tags/<tag>^{}` for an annotated tag, else the same id) */
  commit: string;
}

/**
 * Resolves a tag with `git ls-remote`. Branches move, so a ref that is not a tag cannot pin a plan.
 * @throws PlanSourceError when the ref is not a tag
 */
function resolveTag(context: GitContext, source: GitPlanSource): TagIds {
  const tag = `refs/tags/${source.ref}`;
  const shownUrl = redactCredentials(source.url);
  const listed = gitStep(
    context,
    // Without the second pattern, ls-remote leaves out the `^{}` line of an annotated tag
    ["ls-remote", "--tags", source.url, tag, `${tag}^{}`],
    `git ls-remote ${shownUrl}`,
  );
  const ids = new Map<string, string>();
  for (const line of listed.stdout.split(/\r?\n/)) {
    const [id, name] = line.split("\t");
    if (name !== undefined && OBJECT_ID.test(id.trim())) {
      ids.set(name.trim(), id.trim().toLowerCase());
    }
  }
  const object = ids.get(tag);
  if (object === undefined) {
    throw new PlanSourceError(
      `plan ref must be a tag or a commit SHA: '${source.ref}' is not a tag of ${shownUrl}`,
    );
  }
  return { object, commit: ids.get(`${tag}^{}`) ?? object };
}

/** Prefix of the temporary directory of a fetch, under the system's temporary directory */
export const FETCH_DIR_PREFIX = "opentp-plan-";

/**
 * A new empty directory under the system's temporary directory (its real path, only the user can
 * read it): the only place where git runs during a fetch
 */
function createFetchDirectory(): string {
  try {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), FETCH_DIR_PREFIX)));
  } catch (error) {
    throw new PlanSourceError(
      `cannot create a temporary directory in ${os.tmpdir()}: ${errorText(error)}`,
    );
  }
}

/** The code of a file system error (EXDEV, ENOTEMPTY, ...) */
function errorCode(error: unknown): string | undefined {
  return (error as { code?: unknown } | null)?.code as string | undefined;
}

/**
 * Moves a finished checkout into its place in the cache (`to` must not exist yet). When another
 * run put the same ref there first, its clone (with the same content) is used. When `from` is on
 * another file system (EXDEV), it is copied next to `to` first and that copy is renamed, so that no
 * run ever sees half a copy. `from` is left for the caller to remove.
 * @returns `to`
 * @throws PlanSourceError when neither works and `to` does not exist
 */
export function moveIntoCache(
  from: string,
  to: string,
  label: string,
  rename: (from: string, to: string) => void = fs.renameSync,
): string {
  let failure: unknown;
  try {
    rename(from, to);
    return to;
  } catch (error) {
    failure = error;
  }
  if (errorCode(failure) === "EXDEV") {
    const staging = `${to}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
    try {
      fs.cpSync(from, staging, { recursive: true, verbatimSymlinks: true, errorOnExist: true });
      rename(staging, to);
      return to;
    } catch (error) {
      failure = error;
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
  // Another run fetched the same ref first: its clone has the same content
  if (fs.existsSync(to)) return to;
  throw new PlanSourceError(`cannot move the clone of ${label} into ${to}: ${errorText(failure)}`);
}

/** What fetchGitPlan fetches: an object id, and the commit that a tag's ls-remote listing names */
interface FetchTarget {
  /** The object id to fetch: a commit, or the tag object of an annotated tag */
  object: string;
  /** For a tag: the commit that `git ls-remote` gives for it */
  tagCommit?: string;
}

/**
 * Fetches `target.object` into a new repository in the empty directory `repo` and checks it out.
 * HEAD must be the
 * commit that the fetched object peels to (the object itself for a commit, the tagged commit for an
 * annotated tag object), and for a tag also the commit that ls-remote named. The URL goes only to
 * `git fetch`: it is never written into the repository's configuration, and FETCH_HEAD (which
 * names it) is removed afterwards.
 */
function fetchInto(
  context: GitContext,
  repo: string,
  source: GitPlanSource,
  target: FetchTarget,
): void {
  const label = planLabel(source);
  gitStep(context, ["-C", repo, "init", "-q"], "git init");
  gitStep(
    context,
    ["-C", repo, "fetch", "-q", "--depth", "1", source.url, target.object],
    `git fetch ${label}`,
  );
  gitStep(
    context,
    ["-C", repo, "-c", "advice.detachedHead=false", "checkout", "-q", "FETCH_HEAD"],
    `git checkout ${source.ref}`,
  );
  const revParse = (revision: string): string =>
    gitStep(context, ["-C", repo, "rev-parse", "--verify", revision], `git rev-parse ${revision}`)
      .stdout.trim()
      .toLowerCase();
  const peeled = revParse(`${target.object}^{commit}`);
  const head = revParse("HEAD");
  if (target.tagCommit !== undefined && head !== target.tagCommit) {
    throw new PlanSourceError(
      `git checkout ${source.ref} gave the commit ${head}, not the commit of the tag (${target.tagCommit})`,
    );
  }
  if (head !== peeled) {
    const expected =
      peeled === target.object
        ? target.object
        : `the commit that the annotated tag ${target.object} points to (${peeled})`;
    throw new PlanSourceError(
      `git checkout ${source.ref} gave the commit ${head}, not ${expected}`,
    );
  }
  fs.rmSync(path.join(repo, ".git", "FETCH_HEAD"), { force: true });
}

/**
 * The directory of a git plan, fetched into the cache when it is not there yet. A cached ref is
 * used as it is, without running git.
 *
 * Both a tag and a commit SHA are fetched by object id (`init`, `fetch --depth 1 <url> <id>`,
 * `checkout FETCH_HEAD`): for a tag, the id that `git ls-remote` gives for `refs/tags/<tag>`. That
 * is the advertised tag object of an annotated tag (a server that speaks git protocol version 0
 * sends only advertised ids), and checking it out gives the tag's commit; the checked-out HEAD
 * must equal the commit that ls-remote named. git runs only in a fresh temporary directory (see the
 * top of this file); the checkout is then moved into the cache.
 * @throws PlanSourceError when the ref is not a tag or a commit SHA, or a git command fails
 */
export function fetchGitPlan(source: GitPlanSource, options: FetchPlanOptions = {}): string {
  const env = options.env ?? process.env;
  const root = cacheRoot(env);
  const dir = planCacheDir(root, source);
  if (fs.existsSync(dir)) return dir;

  makeCacheDirectory(root);
  const work = createFetchDirectory();
  try {
    // The checkout, created with the usual permissions (the fetch directory is private)
    const repo = path.join(work, "plan");
    fs.mkdirSync(repo);
    const context: GitContext = {
      git: options.git ?? runGit,
      // git does not look for a repository above the fresh directory
      env: { ...gitEnvironment(env), GIT_CEILING_DIRECTORIES: path.dirname(work) },
      cwd: work,
    };
    let target: FetchTarget;
    if (source.sha) {
      target = { object: source.ref };
    } else {
      const tag = resolveTag(context, source);
      target = { object: tag.object, tagCommit: tag.commit };
    }
    options.onFetch?.(source, dir);
    makeCacheDirectory(path.dirname(dir));
    fetchInto(context, repo, source, target);
    return moveIntoCache(repo, dir, planLabel(source));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/**
 * The plan directory of a source: a local directory as it is, a git plan from the cache (cloned
 * when needed)
 * @throws PlanSourceError
 */
export function planDirectory(source: PlanSource, options: FetchPlanOptions = {}): string {
  if (source.kind === "git") return fetchGitPlan(source, options);
  if (!fs.existsSync(source.dir) || !fs.statSync(source.dir).isDirectory()) {
    throw new PlanSourceError(`directory not found: ${source.dir}`);
  }
  return source.dir;
}
