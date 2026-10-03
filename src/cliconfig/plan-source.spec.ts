/**
 * plan: in an application repository: values, the cache, and git plans cloned from git+file://
 * repositories created in temporary directories (no network).
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CACHE_DIR_ENV,
  cacheRoot,
  type FetchPlanOptions,
  fetchGitPlan,
  type GitPlanSource,
  type GitRunner,
  gitEnvironment,
  moveIntoCache,
  PlanSourceError,
  parsePlanSource,
  planCacheDir,
  planDirectory,
  redactCredentials,
  runGit,
} from "./plan-source";

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opentp-plan-source-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Runs git for the test setup (no user or system configuration needed) */
function git(cwd: string, ...args: string[]): string {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=opentp-test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "tag.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

interface Repository {
  dir: string;
  /** The URL for plan: (git+file://...) */
  url: string;
  sha: string;
  branch: string;
}

/** A git repository with the tracker fixture, a lightweight tag v1.0.0 and an annotated tag v1.1.0 */
function planRepository(): Repository {
  const dir = tempDir();
  fs.cpSync(path.resolve("tests/data/tracker"), dir, { recursive: true });
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "Tracking plan");
  git(dir, "tag", "v1.0.0");
  git(dir, "tag", "-a", "v1.1.0", "-m", "Release 1.1.0");
  // Lets old git versions (protocol v0) fetch a commit by its SHA
  git(dir, "config", "uploadpack.allowAnySHA1InWant", "true");
  return {
    dir,
    url: `git+${pathToFileURL(dir).href}`,
    sha: git(dir, "rev-parse", "HEAD"),
    branch: git(dir, "rev-parse", "--abbrev-ref", "HEAD"),
  };
}

function gitSource(value: string): GitPlanSource {
  const source = parsePlanSource(value, "/");
  if (source.kind !== "git") throw new Error(`not a git source: ${value}`);
  return source;
}

/** A cache root in a temporary directory, as fetch options */
function cacheOptions(extra: Partial<FetchPlanOptions> = {}): FetchPlanOptions & {
  env: NodeJS.ProcessEnv;
} {
  return { env: { ...process.env, [CACHE_DIR_ENV]: tempDir() }, ...extra };
}

/** Runs the real git and records every argument list (and the environment and directory) */
function recordingGit(calls: string[][], env?: NodeJS.ProcessEnv[], cwds?: string[]): GitRunner {
  return (args, gitEnv, cwd) => {
    calls.push(args);
    env?.push(gitEnv);
    cwds?.push(cwd);
    return runGit(args, gitEnv, cwd);
  };
}

/** Commits on a new branch named like a tag, then returns to the original branch */
function branchNamedLikeTag(repository: Repository, name: string): void {
  git(repository.dir, "checkout", "-q", "-b", name);
  fs.writeFileSync(path.join(repository.dir, "branch-only.txt"), "not the tagged content\n");
  git(repository.dir, "add", "branch-only.txt");
  git(repository.dir, "commit", "-q", "-m", "Branch named like a tag");
  git(repository.dir, "checkout", "-q", repository.branch);
}

/**
 * A bare repository layout, as a pull request could commit it (HEAD, objects, refs, config): git
 * that looks for a repository in `dir` reads its config, which runs a command that creates `marker`
 * (core.sshCommand for ssh URLs, core.fsmonitor for commands that read an index)
 */
function plantBareRepository(dir: string, marker: string): void {
  fs.mkdirSync(path.join(dir, "objects"), { recursive: true });
  fs.mkdirSync(path.join(dir, "refs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "HEAD"), "ref: refs/heads/main\n");
  const command = `touch '${marker}'; false`;
  fs.writeFileSync(
    path.join(dir, "config"),
    `[core]\n\tbare = true\n\tsshCommand = "${command}"\n\tfsmonitor = "${command}"\n`,
  );
}

/** The contents of every file under `dir` except git's object store (text, for searching) */
function filesUnder(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "objects") walk(full);
      } else if (entry.isFile()) {
        files.set(path.relative(dir, full), fs.readFileSync(full, "latin1"));
      }
    }
  };
  walk(dir);
  return files;
}

function sourceError(run: () => unknown): PlanSourceError {
  try {
    run();
  } catch (error) {
    if (error instanceof PlanSourceError) return error;
    throw error;
  }
  throw new Error("expected a PlanSourceError");
}

describe("parsePlanSource", () => {
  it("reads git URLs: the prefix is stripped for git, the ref follows #", () => {
    expect(parsePlanSource("git+ssh://git@example.com/acme/plan.git#v1.4.0", "/app")).toEqual({
      kind: "git",
      written: "git+ssh://git@example.com/acme/plan.git#v1.4.0",
      url: "ssh://git@example.com/acme/plan.git",
      ref: "v1.4.0",
      sha: false,
    });
    expect(
      parsePlanSource("git+https://example.com/acme/plan.git#release/2", "/app"),
    ).toMatchObject({ url: "https://example.com/acme/plan.git", ref: "release/2", sha: false });
    const sha = "0123456789ABCDEF0123456789abcdef01234567";
    expect(parsePlanSource(`git+file:///srv/plan#${sha}`, "/app")).toMatchObject({
      url: "file:///srv/plan",
      ref: sha.toLowerCase(),
      sha: true,
    });
  });

  it.each([
    [
      "git+ssh://git@example.com/acme/plan.git",
      "a git URL needs #<tag or commit SHA> at the end, e.g. git+ssh://***@example.com/acme/plan.git#v1.0.0",
    ],
    [
      "git+https://example.com/plan.git#",
      "a git URL needs #<tag or commit SHA> at the end, e.g. git+https://example.com/plan.git#v1.0.0",
    ],
    [
      "git+ftp://example.com/plan.git#v1",
      "'git+ftp://example.com/plan.git#v1' is not a supported git URL: use git+ssh://, git+https:// or git+file:// with #<tag or commit SHA>",
    ],
    ["git+ssh://#v1", "'git+ssh://#v1' has no repository after git+ssh://"],
    [
      "git+ssh://example.com/plan.git#--upload-pack=x",
      "plan ref must be a tag or a commit SHA: '--upload-pack=x'",
    ],
    ["git+ssh://example.com/plan.git#v 1", "plan ref must be a tag or a commit SHA: 'v 1'"],
    [
      "https://example.com/acme/plan.git#v1.0.0",
      "'https://example.com/acme/plan.git#v1.0.0' looks like a URL: write a git URL as git+ssh://, git+https:// or git+file:// with #<tag or commit SHA>, e.g. git+https://example.com/acme/plan.git#v1.0.0",
    ],
    [
      "git@example.com:acme/plan.git",
      "'git@example.com:acme/plan.git' looks like a URL: write a git URL as git+ssh://, git+https:// or git+file:// with #<tag or commit SHA>, e.g. git+ssh://git@example.com/acme/plan.git#<tag or commit SHA>",
    ],
    [
      "s3://bucket/plan",
      "'s3://bucket/plan' looks like a URL: write a git URL as git+ssh://, git+https:// or git+file:// with #<tag or commit SHA>",
    ],
  ])("refuses %j", (value, message) => {
    expect(sourceError(() => parsePlanSource(value, "/app")).message).toBe(message);
  });

  it("hides credentials of refused values in the message", () => {
    expect(
      sourceError(() =>
        parsePlanSource("https://user:ghp_SECRET@example.com/acme/plan.git#v1", "/"),
      ).message,
    ).toBe(
      "'https://***@example.com/acme/plan.git#v1' looks like a URL: write a git URL as git+ssh://, git+https:// or git+file:// with #<tag or commit SHA>, e.g. git+https://***@example.com/acme/plan.git#v1",
    );
    expect(
      sourceError(() => parsePlanSource("git+ftp://user:ghp_SECRET@example.com/plan.git#v1", "/"))
        .message,
    ).toBe(
      "'git+ftp://***@example.com/plan.git#v1' is not a supported git URL: use git+ssh://, git+https:// or git+file:// with #<tag or commit SHA>",
    );
    expect(
      sourceError(() => parsePlanSource("git+https://ghp_SECRET@example.com/plan.git", "/"))
        .message,
    ).toBe(
      "a git URL needs #<tag or commit SHA> at the end, e.g. git+https://***@example.com/plan.git#v1.0.0",
    );
  });

  it("resolves local paths against the application file's directory; both separators work", () => {
    const base = path.resolve("/work/app");
    expect(parsePlanSource("../tracking-plan", base)).toEqual({
      kind: "path",
      written: "../tracking-plan",
      dir: path.resolve("/work/tracking-plan"),
    });
    expect(parsePlanSource("..\\plans\\web", base)).toMatchObject({
      dir: path.resolve("/work/plans/web"),
    });
    const absolute = path.resolve("/srv/plan");
    expect(parsePlanSource(absolute, base)).toMatchObject({ dir: absolute });
  });

  it("checks that a local plan directory exists", () => {
    const dir = tempDir();
    expect(planDirectory(parsePlanSource(".", dir))).toBe(dir);
    const missing = parsePlanSource("missing", dir);
    expect(sourceError(() => planDirectory(missing)).message).toBe(
      `directory not found: ${path.join(dir, "missing")}`,
    );
  });
});

describe("redactCredentials", () => {
  it("hides the user information of URLs and the password of scp-like addresses", () => {
    expect(redactCredentials("https://user:ghp_SECRET@example.com/x.git")).toBe(
      "https://***@example.com/x.git",
    );
    expect(redactCredentials("git+https://ghp_SECRET@example.com/x.git#v1")).toBe(
      "git+https://***@example.com/x.git#v1",
    );
    expect(redactCredentials("ssh://git@example.com:22/x.git")).toBe(
      "ssh://***@example.com:22/x.git",
    );
    expect(redactCredentials("https://user:p@ss@example.com/x.git")).toBe(
      "https://***@example.com/x.git",
    );
    expect(redactCredentials("fatal: unable to access 'https://u:SECRET@h/x.git/': no route")).toBe(
      "fatal: unable to access 'https://***@h/x.git/': no route",
    );
    expect(redactCredentials("user:SECRET@example.com:acme/plan.git")).toBe(
      "***@example.com:acme/plan.git",
    );
    // Not credentials: a plain scp-like user name, paths, a URL without user information
    for (const text of [
      "git@example.com:acme/plan.git",
      "file:///srv/plan",
      "../tracking-plan",
      "https://example.com/x.git?a=b@c",
      "at 12:00 mail me@example.com",
    ]) {
      expect(redactCredentials(text)).toBe(text);
    }
  });
});

describe("cacheRoot", () => {
  it("uses OPENTP_CACHE_DIR, else the platform's cache directory", () => {
    expect(cacheRoot({ [CACHE_DIR_ENV]: "/tmp/opentp-cache" }, "linux", "/home/u")).toBe(
      path.resolve("/tmp/opentp-cache"),
    );
    expect(cacheRoot({}, "linux", "/home/u")).toBe("/home/u/.cache/opentp");
    expect(cacheRoot({ XDG_CACHE_HOME: "/var/cache/u" }, "linux", "/home/u")).toBe(
      "/var/cache/u/opentp",
    );
    // A relative XDG_CACHE_HOME is invalid and ignored
    expect(cacheRoot({ XDG_CACHE_HOME: "cache" }, "linux", "/home/u")).toBe(
      "/home/u/.cache/opentp",
    );
    expect(cacheRoot({}, "darwin", "/Users/u")).toBe("/Users/u/Library/Caches/opentp");
    expect(
      cacheRoot({ LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, "win32", "C:\\Users\\u"),
    ).toBe("C:\\Users\\u\\AppData\\Local\\opentp\\Cache");
    expect(cacheRoot({}, "win32", "C:\\Users\\u")).toBe(
      "C:\\Users\\u\\AppData\\Local\\opentp\\Cache",
    );
  });

  it("names a clone after the first 16 hex of sha256(<url>#<ref>)", () => {
    const dir = planCacheDir("/cache", gitSource("git+https://example.com/plan.git#v1.0.0"));
    // sha256("https://example.com/plan.git#v1.0.0")
    expect(dir).toBe(path.join("/cache", "plans", "208d0cf59fd7a968"));
    expect(planCacheDir("/cache", gitSource("git+https://example.com/plan.git#v1.0.1"))).not.toBe(
      dir,
    );
  });
});

describe("gitEnvironment", () => {
  it("disables prompts and drops the repository of the caller (e.g. inside a git hook)", () => {
    const env = gitEnvironment({
      PATH: "/usr/bin",
      GIT_DIR: "/app/.git",
      GIT_WORK_TREE: "/app",
      GIT_INDEX_FILE: "/app/.git/index",
      GIT_SSH_COMMAND: "ssh -i key",
    });
    expect(env).toEqual({
      PATH: "/usr/bin",
      GIT_SSH_COMMAND: "ssh -i key",
      GIT_TERMINAL_PROMPT: "0",
    });
  });
});

describe("runGit", () => {
  it("runs git in the given directory", () => {
    const repository = planRepository();
    const result = runGit(
      ["rev-parse", "--show-prefix"],
      gitEnvironment(),
      path.join(repository.dir, "events"),
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("events/");
  });
});

describe("fetchGitPlan", () => {
  it("fetches the tagged commit by its id with argument arrays and no prompts, then reuses the cache", () => {
    const repository = planRepository();
    const options = cacheOptions();
    const calls: string[][] = [];
    const envs: NodeJS.ProcessEnv[] = [];
    const cwds: string[] = [];
    const source = gitSource(`${repository.url}#v1.0.0`);
    const dir = fetchGitPlan(source, { ...options, git: recordingGit(calls, envs, cwds) });

    const root = options.env[CACHE_DIR_ENV] as string;
    expect(dir).toBe(planCacheDir(root, source));
    expect(fs.existsSync(path.join(dir, "opentp.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "events/auth/login.yaml"))).toBe(true);
    expect(git(dir, "rev-parse", "HEAD")).toBe(repository.sha);
    const url = pathToFileURL(repository.dir).href;
    // Cloned in a fresh temporary directory, then moved into the cache
    const work = cwds[0] as string;
    const tmp = path.join(work, "plan");
    const safe = ["-c", "safe.bareRepository=explicit"];
    expect(calls).toEqual([
      [...safe, "ls-remote", "--tags", url, "refs/tags/v1.0.0", "refs/tags/v1.0.0^{}"],
      [...safe, "-C", tmp, "init", "-q"],
      [...safe, "-C", tmp, "fetch", "-q", "--depth", "1", url, repository.sha],
      [...safe, "-C", tmp, "-c", "advice.detachedHead=false", "checkout", "-q", "FETCH_HEAD"],
      [...safe, "-C", tmp, "rev-parse", "--verify", `${repository.sha}^{commit}`],
      [...safe, "-C", tmp, "rev-parse", "--verify", "HEAD"],
    ]);
    for (const env of envs) expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    // git never runs in the current directory (a git.exe there would run on Windows) or the cache
    expect(cwds).toEqual(calls.map(() => work));
    expect([root, process.cwd()]).not.toContain(work);
    // The private fetch directory is gone; the clone has the usual permissions
    expect(fs.existsSync(work)).toBe(false);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o777 & ~process.umask());

    // A cached ref is never refreshed: no git, even when the repository is gone
    fs.rmSync(repository.dir, { recursive: true, force: true });
    const noGit: GitRunner = () => {
      throw new Error("git must not run for a cached ref");
    };
    expect(fetchGitPlan(source, { ...options, git: noGit })).toBe(dir);
    expect(planDirectory(source, { ...options, git: noGit })).toBe(dir);
  });

  it("clones an annotated tag: fetches the tag object and checks out its commit", () => {
    const repository = planRepository();
    // The tagged commit is no branch tip: a server that speaks git protocol version 0 refuses to
    // send it by its own id, but sends the (advertised) tag object
    git(repository.dir, "config", "uploadpack.allowAnySHA1InWant", "false");
    git(repository.dir, "tag", "-d", "v1.0.0");
    git(repository.dir, "commit", "-q", "--allow-empty", "-m", "Later commit");
    const calls: string[][] = [];
    const dir = fetchGitPlan(
      gitSource(`${repository.url}#v1.1.0`),
      cacheOptions({ git: recordingGit(calls) }),
    );
    expect(fs.existsSync(path.join(dir, "opentp.yaml"))).toBe(true);
    expect(git(dir, "rev-parse", "HEAD")).toBe(repository.sha);
    const tagObject = git(repository.dir, "rev-parse", "refs/tags/v1.1.0");
    expect(tagObject).not.toBe(repository.sha);
    expect(calls[2]?.at(-1)).toBe(tagObject);
  });

  it("reads SHA-256 object ids from ls-remote", () => {
    const id = "ab".repeat(32);
    const calls: string[][] = [];
    const fake: GitRunner = (args) => {
      calls.push(args);
      if (args.includes("ls-remote"))
        return { status: 0, stdout: `${id}\trefs/tags/v2\n`, stderr: "" };
      return { status: 0, stdout: args.includes("rev-parse") ? `${id}\n` : "", stderr: "" };
    };
    const dir = fetchGitPlan(
      gitSource("git+https://example.com/plan.git#v2"),
      cacheOptions({ git: fake }),
    );
    expect(fs.existsSync(dir)).toBe(true);
    expect(calls.find((args) => args.includes("fetch"))?.at(-1)).toBe(id);
  });

  it("fetches the tag, not a branch with the same name", () => {
    const repository = planRepository();
    branchNamedLikeTag(repository, "v1.0.0");
    branchNamedLikeTag(repository, "v1.1.0");
    for (const tag of ["v1.0.0", "v1.1.0"]) {
      const dir = fetchGitPlan(gitSource(`${repository.url}#${tag}`), cacheOptions());
      expect(fs.existsSync(path.join(dir, "branch-only.txt")), tag).toBe(false);
      expect(git(dir, "rev-parse", "HEAD"), tag).toBe(repository.sha);
    }
  });

  it("refuses a checkout that is not the commit ls-remote named, and caches nothing", () => {
    const repository = planRepository();
    const options = cacheOptions();
    const lying: GitRunner = (args, env, cwd) => {
      const result = runGit(args, env, cwd);
      return args.includes("rev-parse") ? { ...result, stdout: `${"0".repeat(40)}\n` } : result;
    };
    const error = sourceError(() =>
      fetchGitPlan(gitSource(`${repository.url}#v1.0.0`), { ...options, git: lying }),
    );
    expect(error.message).toBe(
      `git checkout v1.0.0 gave the commit ${"0".repeat(40)}, not the commit of the tag (${repository.sha})`,
    );
    expect(fs.readdirSync(path.join(options.env[CACHE_DIR_ENV] as string, "plans"))).toEqual([]);
  });

  it("hides credentials of the URL in messages and in git's output", () => {
    const secret = "ghp_SECRETTOKEN";
    const url = `https://user:${secret}@example.com/acme/plan.git`;
    // init and remote add work; the network commands fail with the URL in git's output
    const failing: GitRunner = (args) =>
      args.includes("fetch") || args.includes("ls-remote")
        ? {
            status: 128,
            stdout: "",
            stderr: `fatal: unable to access '${url}/': Could not resolve host\n`,
          }
        : { status: 0, stdout: "", stderr: "" };
    for (const ref of ["v1.0.0", "0123456789abcdef0123456789abcdef01234567"]) {
      const error = sourceError(() =>
        fetchGitPlan(gitSource(`git+${url}#${ref}`), cacheOptions({ git: failing })),
      );
      const text = [error.message, ...error.details].join("\n");
      expect(text).not.toContain(secret);
      expect(text).toContain("https://***@example.com/acme/plan.git");
    }
    // A tag that does not exist
    const empty: GitRunner = () => ({ status: 0, stdout: "", stderr: "" });
    expect(
      sourceError(() => fetchGitPlan(gitSource(`git+${url}#v9`), cacheOptions({ git: empty })))
        .message,
    ).toBe(
      "plan ref must be a tag or a commit SHA: 'v9' is not a tag of https://***@example.com/acme/plan.git",
    );
  });

  it("fetches a commit SHA with init, fetch and checkout", () => {
    const repository = planRepository();
    const calls: string[][] = [];
    const options = cacheOptions({ git: recordingGit(calls) });
    const dir = fetchGitPlan(gitSource(`${repository.url}#${repository.sha}`), options);
    expect(fs.existsSync(path.join(dir, "events/onboarding/step_view.yaml"))).toBe(true);
    expect(git(dir, "rev-parse", "HEAD")).toBe(repository.sha);
    const url = pathToFileURL(repository.dir).href;
    const tmp = calls[0]?.[3] as string;
    expect(path.basename(tmp)).toBe("plan");
    const safe = ["-c", "safe.bareRepository=explicit"];
    expect(calls).toEqual([
      [...safe, "-C", tmp, "init", "-q"],
      [...safe, "-C", tmp, "fetch", "-q", "--depth", "1", url, repository.sha],
      [...safe, "-C", tmp, "-c", "advice.detachedHead=false", "checkout", "-q", "FETCH_HEAD"],
      [...safe, "-C", tmp, "rev-parse", "--verify", `${repository.sha}^{commit}`],
      [...safe, "-C", tmp, "rev-parse", "--verify", "HEAD"],
    ]);
  });

  it("rejects a branch or a missing tag (refs that are not a tag or a commit SHA)", () => {
    const repository = planRepository();
    const url = pathToFileURL(repository.dir).href;
    for (const ref of [repository.branch, "v9.9.9"]) {
      const options = cacheOptions();
      const error = sourceError(() => fetchGitPlan(gitSource(`${repository.url}#${ref}`), options));
      expect(error.message).toBe(
        `plan ref must be a tag or a commit SHA: '${ref}' is not a tag of ${url}`,
      );
      expect(fs.existsSync(path.join(options.env[CACHE_DIR_ENV] as string, "plans"))).toBe(false);
    }
  });

  it("reports git's stderr for a commit that does not exist and leaves nothing behind", () => {
    const repository = planRepository();
    const options = cacheOptions();
    const missing = "0123456789abcdef0123456789abcdef01234567";
    const error = sourceError(() =>
      fetchGitPlan(gitSource(`${repository.url}#${missing}`), options),
    );
    expect(error.message).toMatch(
      /^git fetch file:\/\/.*#0123456789abcdef.* failed \(git exit code \d+\)$/,
    );
    expect(error.details.join("\n")).toMatch(/fatal/);
    expect(fs.readdirSync(path.join(options.env[CACHE_DIR_ENV] as string, "plans"))).toEqual([]);
  });

  it("reports a repository that cannot be reached", () => {
    const options = cacheOptions();
    const missing = path.join(tempDir(), "nothing-here");
    const error = sourceError(() =>
      fetchGitPlan(gitSource(`git+${pathToFileURL(missing).href}#v1.0.0`), options),
    );
    expect(error.message).toMatch(/^git ls-remote file:\/\/.* failed \(git exit code \d+\)$/);
    expect(error.details.length).toBeGreaterThan(0);
  });

  it("uses the clone of a run that won the race to the cache directory", () => {
    const repository = planRepository();
    const options = cacheOptions();
    const source = gitSource(`${repository.url}#v1.0.0`);
    const final = planCacheDir(options.env[CACHE_DIR_ENV] as string, source);
    // Another run finishes the same clone while this one is cloning
    const racing: GitRunner = (args, env, cwd) => {
      const result = runGit(args, env, cwd);
      if (args.includes("checkout")) {
        fs.cpSync(path.join(cwd, "plan"), final, { recursive: true });
        fs.writeFileSync(path.join(final, "winner.txt"), "the other run");
      }
      return result;
    };
    expect(fetchGitPlan(source, { ...options, git: racing })).toBe(final);
    expect(fs.readFileSync(path.join(final, "winner.txt"), "utf8")).toBe("the other run");
    // The losing clone is removed
    expect(fs.readdirSync(path.dirname(final))).toEqual([path.basename(final)]);
  });

  it("moves a checkout into the cache across file systems by copying it next to its place", () => {
    const from = tempDir();
    fs.mkdirSync(path.join(from, "events"));
    fs.writeFileSync(path.join(from, "opentp.yaml"), "opentp: 2026-09\n");
    fs.symlinkSync("opentp.yaml", path.join(from, "link.yaml"));
    const to = path.join(tempDir(), "plans", "0123456789abcdef");
    fs.mkdirSync(path.dirname(to));
    const renames: string[][] = [];
    // Only the copy next to `to` is on the same file system
    const rename = (source: string, target: string): void => {
      renames.push([source, target]);
      if (!source.startsWith(`${to}.tmp-`)) {
        throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
      }
      fs.renameSync(source, target);
    };
    expect(moveIntoCache(from, to, "plan", rename)).toBe(to);
    expect(renames[1]?.[0]).toMatch(new RegExp(`^${escapeRegExp(to)}\\.tmp-${process.pid}-`));
    expect(fs.readFileSync(path.join(to, "opentp.yaml"), "utf8")).toBe("opentp: 2026-09\n");
    expect(fs.readlinkSync(path.join(to, "link.yaml"))).toBe("opentp.yaml");
    expect(fs.readdirSync(path.dirname(to))).toEqual([path.basename(to)]);

    // Another run won: its directory is used, the copy is removed
    const later = tempDir();
    fs.writeFileSync(path.join(later, "opentp.yaml"), "the slower run\n");
    expect(moveIntoCache(later, to, "plan", rename)).toBe(to);
    expect(renames).toHaveLength(4);
    expect(fs.readFileSync(path.join(to, "opentp.yaml"), "utf8")).toBe("opentp: 2026-09\n");
    expect(fs.readdirSync(path.dirname(to))).toEqual([path.basename(to)]);

    // Neither works and nothing is there
    const missing = path.join(tempDir(), "missing", "dir");
    expect(sourceError(() => moveIntoCache(tempDir(), missing, "plan")).message).toMatch(
      new RegExp(`^cannot move the clone of plan into ${escapeRegExp(missing)}: `),
    );
  });

  it("explains a cache directory that cannot be created (before git runs)", () => {
    const repository = planRepository();
    const file = path.join(tempDir(), "a-file");
    fs.writeFileSync(file, "");
    const calls: string[][] = [];
    const error = sourceError(() =>
      fetchGitPlan(gitSource(`${repository.url}#v1.0.0`), {
        env: { ...process.env, [CACHE_DIR_ENV]: file },
        git: recordingGit(calls),
      }),
    );
    expect(error.message).toMatch(
      new RegExp(
        `^cannot create the cache directory ${escapeRegExp(file)} \\(set OPENTP_CACHE_DIR to another directory\\): `,
      ),
    );
    expect(calls).toEqual([]);
  });

  it("never lets git find a repository in the cache root or the current directory", () => {
    const repository = planRepository();
    const marker = path.join(tempDir(), "config-ran");
    const cache = tempDir();
    const cwd = tempDir();
    plantBareRepository(cache, marker);
    plantBareRepository(cwd, marker);
    // GIT_SSH_COMMAND would win over core.sshCommand and hide the problem
    const { GIT_SSH_COMMAND: _command, GIT_SSH: _ssh, ...rest } = process.env;
    const env = { ...rest, [CACHE_DIR_ENV]: cache };
    const previous = process.cwd();
    process.chdir(cwd);
    try {
      // ssh to a closed port fails at once (a discovered config would run its sshCommand first)
      const error = sourceError(() =>
        fetchGitPlan(gitSource("git+ssh://git@127.0.0.1:1/acme/plan.git#v1.0.0"), { env }),
      );
      expect(error.message).toMatch(
        /^git ls-remote ssh:\/\/\*\*\*@127\.0\.0\.1:1\/acme\/plan\.git/,
      );
      // A plan that can be fetched: init, fetch and checkout do not read them either
      for (const ref of ["v1.1.0", repository.sha]) {
        const dir = fetchGitPlan(gitSource(`${repository.url}#${ref}`), { env });
        expect(git(dir, "rev-parse", "HEAD"), ref).toBe(repository.sha);
      }
    } finally {
      process.chdir(previous);
    }
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("runs git in a fresh temporary directory, never above it, and refuses implicit bare repositories", () => {
    const repository = planRepository();
    const options = cacheOptions();
    const root = options.env[CACHE_DIR_ENV] as string;
    for (const ref of ["v1.0.0", repository.sha]) {
      const calls: string[][] = [];
      const envs: NodeJS.ProcessEnv[] = [];
      const cwds: string[] = [];
      fetchGitPlan(gitSource(`${repository.url}#${ref}`), {
        ...options,
        git: recordingGit(calls, envs, cwds),
      });
      const work = cwds[0] as string;
      expect(path.dirname(work), ref).toBe(fs.realpathSync(os.tmpdir()));
      expect(path.basename(work), ref).toMatch(/^opentp-plan-/);
      expect(cwds, ref).toEqual(calls.map(() => work));
      for (const [index, args] of calls.entries()) {
        expect(args.slice(0, 2), ref).toEqual(["-c", "safe.bareRepository=explicit"]);
        expect(envs[index]?.GIT_CEILING_DIRECTORIES, ref).toBe(path.dirname(work));
        // Every command after ls-remote names the new repository inside it
        if (!args.includes("ls-remote")) {
          expect(args.slice(2, 4), ref).toEqual(["-C", path.join(work, "plan")]);
        }
      }
      // The checkout was moved into the cache; nothing is left in the temporary directory
      expect(fs.existsSync(work), ref).toBe(false);
    }
    expect(fs.readdirSync(path.join(root, "plans"))).toHaveLength(2);
  });

  it("keeps no plan URL in the cached clone's git files", () => {
    const repository = planRepository();
    const url = pathToFileURL(repository.dir).href;
    for (const ref of ["v1.1.0", repository.sha]) {
      const dir = fetchGitPlan(gitSource(`${repository.url}#${ref}`), cacheOptions());
      for (const [file, content] of filesUnder(path.join(dir, ".git"))) {
        expect(content.includes(url) || content.includes(repository.dir), `${ref}: ${file}`).toBe(
          false,
        );
      }
      expect(git(dir, "remote"), ref).toBe("");
    }
  });

  it("never writes a URL with a token into git's configuration", () => {
    const secret = "ghp_SECRETTOKEN";
    const url = `https://user:${secret}@example.com/acme/plan.git`;
    const id = "ab".repeat(20);
    for (const ref of ["v1.0.0", id]) {
      const calls: string[][] = [];
      const fake: GitRunner = (args) => {
        calls.push(args);
        if (args.includes("ls-remote"))
          return { status: 0, stdout: `${id}\trefs/tags/v1.0.0\n`, stderr: "" };
        return { status: 0, stdout: args.includes("rev-parse") ? `${id}\n` : "", stderr: "" };
      };
      fetchGitPlan(gitSource(`git+${url}#${ref}`), cacheOptions({ git: fake }));
      // The URL goes only to the commands that contact the server, never into a remote or config
      const withUrl = calls.filter((args) => args.some((arg) => arg.includes(secret)));
      expect(
        withUrl.map((args) => args.find((arg) => arg === "ls-remote" || arg === "fetch")),
        ref,
      ).toEqual(ref === id ? ["fetch"] : ["ls-remote", "fetch"]);
      expect(
        calls.filter((args) => args.includes("remote") || args.includes("config")),
        ref,
      ).toEqual([]);
    }
  });

  it("accepts a commit SHA that names an annotated tag object, and checks out its commit", () => {
    const repository = planRepository();
    // What `git rev-parse v1.1.0` prints: the tag object, not the commit
    const tagObject = git(repository.dir, "rev-parse", "v1.1.0");
    expect(git(repository.dir, "cat-file", "-t", tagObject)).toBe("tag");
    const dir = fetchGitPlan(gitSource(`${repository.url}#${tagObject}`), cacheOptions());
    expect(git(dir, "rev-parse", "HEAD")).toBe(repository.sha);
    expect(fs.existsSync(path.join(dir, "opentp.yaml"))).toBe(true);
  });

  it("refuses a checkout that is not the commit a pinned SHA names", () => {
    const repository = planRepository();
    const options = cacheOptions();
    const other = "1".repeat(40);
    const lying: GitRunner = (args, env, cwd) => {
      const result = runGit(args, env, cwd);
      return args.at(-1) === "HEAD" ? { ...result, stdout: `${other}\n` } : result;
    };
    const tagObject = git(repository.dir, "rev-parse", "v1.1.0");
    expect(
      sourceError(() =>
        fetchGitPlan(gitSource(`${repository.url}#${repository.sha}`), { ...options, git: lying }),
      ).message,
    ).toBe(`git checkout ${repository.sha} gave the commit ${other}, not ${repository.sha}`);
    expect(
      sourceError(() =>
        fetchGitPlan(gitSource(`${repository.url}#${tagObject}`), { ...options, git: lying }),
      ).message,
    ).toBe(
      `git checkout ${tagObject} gave the commit ${other}, not the commit that the annotated tag ${tagObject} points to (${repository.sha})`,
    );
    expect(fs.readdirSync(path.join(options.env[CACHE_DIR_ENV] as string, "plans"))).toEqual([]);
  });

  it("explains a missing git and a timeout", () => {
    const source = gitSource("git+https://example.com/plan.git#v1.0.0");
    const failing =
      (code: string): GitRunner =>
      () => ({
        status: null,
        stdout: "",
        stderr: "",
        error: Object.assign(new Error(code), { code }),
      });
    expect(
      sourceError(() => fetchGitPlan(source, cacheOptions({ git: failing("ENOENT") }))).message,
    ).toBe("git is needed for a git URL in plan:, but it was not found on PATH");
    expect(
      sourceError(() => fetchGitPlan(source, cacheOptions({ git: failing("ETIMEDOUT") }))).message,
    ).toBe("git ls-remote https://example.com/plan.git timed out after 120 s");
  });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
