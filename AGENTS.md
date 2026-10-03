# opentp-cli — Agent Guide

This repo is the reference implementation of the OpenTrackPlan standard. It is a CLI that loads a
tracking plan (`opentp.yaml`, dictionaries and event YAML files), validates it, rewrites event keys,
and exports the plan through generators.

- **Command:** `opentp`, repo `github.com/opentrackplan/opentp-cli`, license Apache-2.0.
- **Distribution: binaries only** (owner decision, 2026-10-02, final). The CLI ships as the four Bun
  binaries + `SHA256SUMS` on GitHub Releases and through the install scripts. It is **not published to
  npm, now or later**; `package.json` is `"private": true` and the old npm package `opentp` (0.5.0) is
  obsolete. npm is only a development tool here. A Bun-only toolchain is a possible future direction,
  not decided.
- **Version:** `package.json` `version` (0.8.0). Current release and installer state: see
  "Distribution state" under Known issues.
- **Spec support:** **exactly `2026-01`** (`package.json` `specVersion`, read by `src/meta.ts`). Any
  other `opentp:` value is a hard error; older plans are not accepted.
- **Spec ownership:** the format (JSON Schemas, semantics, examples) is owned by
  `opentrackplan/opentp-spec`. This repo does **not** load those schemas at runtime. Every check is
  hand-written TypeScript.

## Rules

1. **English only.** This applies to code, comments, docs, commit messages and test names.
2. **Update code, docs and fixtures together.** CLI behaviour, `--help` (`printHelp` in `src/cli.ts`),
   `README.md`, `docs/*.md` and `tests/data/*` must agree in the same change. Record user-visible
   changes under `## [Unreleased]` in `CHANGELOG.md` (breaking ones under "Breaking changes"); the
   release notes are built from it.
3. **Spec semantics come from opentp-spec** (`docs/semantics.md`, `docs/schema/*.md`). Do not invent new
   semantics here. If the spec is unclear, change the spec repo as well.
4. **Never move, delete or re-push a published `v*` tag.** Pushing a tag publishes the release binaries
   and `SHA256SUMS` (the installers pick them up as "latest" at once, unless the tag has a pre-release
   suffix). If a release is broken, ship a new patch version.
5. **Never hand-edit generated content.** `dist/` and `releases/` are gitignored build output, and
   `build/` is a gitignored, hand-written local-only `Dockerfile` (no workflow uses it); the website
   copies of `docs/` live in `opentp-website` and are overwritten by its sync script.
6. **Run every command from `opentp-cli/`.** `esbuild/esbuild.js` and `src/core/fixtures.spec.ts` use
   cwd-relative paths (elsewhere: `Could not resolve "src/index.ts"`, failing fixture tests).
7. **Publish only when the user asks** (pushing tags, GitHub releases).
8. **Do not "fix" deliberate behaviour by accident.** Several traps listed below are pinned by fixtures,
   for example ignore widening.
9. **Never add npm distribution.** No npm publish job or `prepublishOnly` script, no removal of
    `"private": true`, no `npm install -g opentp` / `npx opentp` instructions, no npm badge. Users
    install the binaries (installers or GitHub Releases); docs show `opentp ...` commands, and
    "from source" means `npm ci && npm run build && node dist/index.cjs`. npm as a dev tool (`npm ci`,
    `npm test`, `npm run ...`, `package-lock.json`) stays.

## Quick facts

| Item | Value |
|---|---|
| Language | TypeScript (strict). Source is ESM (`"type": "module"`) |
| Node bundle | esbuild `src/index.ts` -> `dist/index.cjs` (CJS, target node18, `#!/usr/bin/env node`). Used for development, CI smoke tests and `npm link`; never published. `main` and `bin.opentp` both point to it (`files` is kept, but `private: true` blocks `npm publish`). No `exports`, no `types`, no `.d.ts`. The esbuild target only sets the syntax level; it is deliberately left below `engines` |
| Binaries | `bun build src/cli.ts --compile` (the entry is `cli.ts`, not `index.ts`). The only distributed artifact |
| Runtime deps | `yaml` ^2.8.1, `@modelcontextprotocol/server` ^2.3.0 (MCP SDK v2) and `zod` ^4 (its schema library, also imported directly); all bundled |
| Dev tooling | vitest 4.0.16, Biome 2.3.11, esbuild 0.25.x, TypeScript 5.9.x, `bun` ^1.3.5 as an npm devDependency, `@modelcontextprotocol/client` (MCP tests only) |
| Node | `engines`: `^20.19.0 \|\| >=22.12.0` (what vite 7 / vitest 4 need; Node 18 is EOL). It describes only the development toolchain (build from source, tests); users run the binaries, which embed the Bun runtime and need no Node.js. Documented in README and getting-started ("From source") and CONTRIBUTING. The bundle's node18 syntax target does not make older runtimes supported, they are not tested. CI tests Node 20 and 22. Verified on 22.15 |
| TypeScript configs | `tsconfig.json`: `src/` without specs (`resolveJsonModule` for `src/meta.ts`). `tsconfig.test.json` extends it and adds `*.spec.ts`. Both must have 0 errors |
| CI (`ci.yml`) | Push/PR to main, Node 20 + 22 matrix; also called by `release.yml` (`workflow_call`). `npm ci`, lint, `tsc` (both configs), test, build, smoke tests (fixtures + opentp-spec `examples/{simple,full}` at the tag that equals `specVersion`) |
| Release (`release.yml`) | On `v*` tags: tag = `package.json` version check, CI as `verify`, four bun binaries (each smoke-tested on its own runner), `SHA256SUMS`, GitHub Release (notes from `CHANGELOG.md`; `-` in the tag = pre-release). Nothing goes to npm. See Release process |

## Commands

Run everything from `opentp-cli/`. All results below were verified on 2026-10-02 against a scratch copy.

```bash
npm ci                          # install (same as CI)
npm test                        # vitest run -> 33 files / 322 tests pass
npx vitest run src/core/fixtures.spec.ts                 # integration fixtures only (6 tests)
npx vitest run src/cli.spec.ts                           # argv parsing, exit codes, stdout/stderr split, generate/fix refusals (in-process main)
npx vitest run src/external-plugins.spec.ts              # loadExternal{Rules,Transforms,Generators} with temp dirs
npx vitest run src/core                                  # fixtures + config/event loader unit tests
npx vitest run src/rules src/transforms src/generators   # plugin unit tests only
npm run lint                    # biome check src/ -> "Checked 85 files ... No fixes applied."
npm run lint:fix                # biome check --write src/ (also sorts imports)
npm run format                  # biome format --write src/
npm run typecheck               # tsc --noEmit -p . && tsc --noEmit -p tsconfig.test.json -> 0 errors (CI runs both)
npm run build                   # node ./esbuild/esbuild.js -> dist/index.cjs (gitignored)
npm run compile:mac             # bun --compile -> releases/opentp-mac (also :mac-intel, :linux, :win)
npm run compile                 # all four into releases/ (gitignored, local only)
```

Smoke tests. After the build, CI runs the first four (the first three on the combined stdout +
stderr), plus a `--json -v` parse, a `cmp` of piped vs `-o` `generate json` output, and the MCP smoke
script, all on `coverage-valid`. `release.yml` runs a similar set (MCP smoke included) against every
compiled binary (see Release process). `dist/` is not committed and can be stale, so run
`npm run build` first:

```bash
node dist/index.cjs --version   # "opentp v<package.json version> (spec 2026-01)" + "Schemas: https://opentp.dev/schemas/2026-01"
node dist/index.cjs validate --root tests/data/coverage-valid     # stderr "✓ All events are valid count=4", empty stdout, exit 0
node dist/index.cjs validate --root tests/data/coverage-invalid   # report on stdout, "... errorCount=35 eventCount=19" on stderr, exit 1
node dist/index.cjs valdiate                                      # "✗ Unknown command 'valdiate'" + usage on stderr, exit 2
node dist/index.cjs validate --json -v --root tests/data/coverage-invalid 2>/dev/null   # stdout = one JSON document
# same errors as fixtures.spec.ts (otherwise check_throws.yaml reports "Unknown check: throwing-check"):
node dist/index.cjs validate --root tests/data/coverage-invalid --external-rules tests/data/coverage-invalid/external-rules
node dist/index.cjs generate json --root tests/data/coverage-invalid   # refuses: load errors on stderr, empty stdout, exit 1
node dist/index.cjs generate json --root tests/data/coverage-valid
# opentp mcp over stdio: raw JSON-RPC (no dependencies), 9 tools, 3 calls, exit 0 on stdin EOF; the
# noisy plugins print to stdout at import, and the smoke fails on any non-JSON-RPC stdout line
node tests/mcp-smoke.mjs node dist/index.cjs mcp --root tests/data/coverage-valid \
  --external-transforms tests/data/mcp-noisy-plugins/transforms --external-rules tests/data/mcp-noisy-plugins/rules
./releases/opentp-mac validate --root tests/data/coverage-valid   # after compile:mac
```

The binary smoke step of `release.yml` can be replayed locally: extract its `run` script (e.g. with
`node -e` and the `yaml` package) and run it with `BIN=<binary>` and `RUNNER_TEMP=<scratch dir>` from
`opentp-cli/` (verified 2026-10-02 with a `compile:mac`-style build in a scratch dir).

Truncation check (macOS pipes are asynchronous; the fixtures are too small to show it): build a plan
with a few thousand events in a scratch dir, then `node dist/index.cjs generate json --root <plan> | wc -c`
must equal the size of the `-o` file (verified 2026-10-02: 3000 events, 1809643 bytes both ways;
0.7.4 printed 65536).

Cross-repo check (local workspace with `../opentp-spec`). `validate` is read-only, so no copy is
needed; copy first only when running `fix`. CI runs `simple` and `full` from a checkout of
`opentrackplan/opentp-spec` at the tag equal to `package.json` `specVersion` (exit 0 and a non-zero
`count=` required), not from the spec's `main`:

```bash
for e in simple full extensions; do node dist/index.cjs validate --root ../opentp-spec/examples/$e; done
# simple: count=1, full: count=5 (both exit 0); extensions: exit 1 (see traps)
```

## Repository layout

```
src/
  index.ts           esbuild entry. `import "./cli"` (side effect!) + re-exports VERSION, SPEC_VERSION,
                     SPEC_SCHEMAS_URL, createTransform(s), getStep, getStepNames, transform types
  cli.ts             Whole CLI: EXIT_OK/EXIT_FAILURE/EXIT_USAGE, CliOptions, UsageError, OPTIONS +
                     COMMAND_OPTIONS, parseCliArgs (node:util parseArgs), printHelp, printVersion,
                     runValidate (also fix), runGenerate, runMcp, main (returns the exit code), bootstrap guard
                     (`require.main === module`; sets process.exitCode, EPIPE handler). Bun binaries
                     compile THIS file
  cli.spec.ts        parseCliArgs cases and in-process main() runs (exit codes, stdout vs stderr, --json,
                     generate refusing a broken plan, fix rewriting nothing on config issues)
  external-plugins.spec.ts  loadExternal{Rules,Transforms,Generators}: ESM/CJS, relative/absolute, missing dir
  meta.ts            VERSION / SPEC_VERSION from package.json; SPEC_SCHEMAS_URL
  core/
    index.ts         barrel (config, dict, event, validator); unused; does not export payload.ts
    config.ts        findConfigFile, loadConfig (throws), validateConfig -> ConfigIssue[] (never throws),
                     getKeygenProblems, resolvePath, getEventsPath, getDictsPath, getEventsTemplate
    dict.ts          loadDictionaries -> { dictionaries: Map, issues: DictionaryIssue[] }, getDictValues
    event.ts         loadEvents -> { events, issues: EventLoadIssue[] }; createEventLoadContext +
                     loadEventDocument (one parsed document as if it were a file at a path: used by
                     loadEvents and by the MCP draft tools) (+ private prepareKeygen, extractTaxonomy,
                     extractFragments, generateEventKey, parseTypedValue)
    payload.ts       resolveEventPayload, resolveEffectivePayload (base -> spec.targets -> event schema per
                     target and version, the merge order of validatePayload), mergeSchemaMaps, mergeField,
                     UNVERSIONED_VERSION_KEY ("__unversioned__")
    validator.ts     configIssuesToErrors, loadIssuesToErrors, buildIgnoreSet, validateEvents (+ private
                     validateTaxonomyDictionaries), validateEvent, validateTaxonomy, validatePayload (with
                     nested validateEffectiveValue, validatePii), groupErrorsByEvent, formatErrors (~1550 lines)
    fixtures.spec.ts integration over tests/data/* (exhaustive coverage-invalid list, config-level cases)
    config.spec.ts   validateConfig unit tests
    event.spec.ts    loadEvents unit tests (temp dirs: broken files, keygen failures, unusable template)
  types/index.ts     all spec + CLI types (OpenTPConfig, Field, TaxonomyField, EventFile, ResolvedEvent
                     (with keygenError), ValidationError, payload types); ResolvedConfig is unused
  util/
    index.ts         barrel
    files.ts         scanDirectory (recursive, UNSORTED readdir order), filterByExtension, loadYaml
                     (yaml.parse), isYamlMapping, formatLoadError (one-line YAML errors with line/col),
                     saveYaml (runtime require("yaml")), fileExists, ensureDir (unused)
    logger.ts        tiny logger; every level -> stderr (console.error); OPENTP_LOG_LEVEL (LOG_LEVELS,
                     isLogLevel, getLogLevelEnvProblem: the CLI rejects an invalid value with exit 2)
    pattern.ts       parsePattern, getMatchTemplateProblems (path/composite template checks), patternToRegex
                     (vars .+?), templateToRegex (vars = one path segment), extractTemplateVariables,
                     applyPattern (keygen)
  transforms/        types.ts, registry.ts, factory.ts (getStepProblem, createStepFn/createTransform(s): throw on
                     unknown or malformed steps), index.ts (registers built-ins), index.spec.ts;
                     12 step folders (index.ts + transform.spec.ts): collapse keep lower replace
                     to-camel-case to-kebab to-snake-case to-underscore transliterate trim truncate upper
  rules/             = x-opentp.checks. types.ts, registry.ts (+ validateWithRules), validation.ts
                     (validateFieldExclusivity), index.ts, index.spec.ts; 8 folders (index.ts + rule.spec.ts):
                     contains ends-with max-length min-length not-empty pattern starts-with webhook
  generators/        types.ts, registry.ts, index.ts, json/ yaml/ template/ (index.ts + generator.spec.ts)
  mcp/               `opentp mcp` (see "MCP server"): plan.ts (PlanStore, PlanSnapshot, PlanError),
                     search.ts (TrigramIndex, eventDocument), tools.ts (the 9 tools as plain functions,
                     ToolError), server.ts (buildMcpServer, serveMcpStdio) + search/tools/server specs
tests/mcp-smoke.mjs  dependency-free stdio smoke test for `opentp mcp` (CI and the release binary smoke)
tests/data/mcp-noisy-plugins/  a transform and a check that print to stdout at import (MCP smoke only)
tests/data/coverage-valid/    fixture plan that must produce zero errors (4 events)
tests/data/coverage-invalid/  fixture plan with intentional errors (22 matching event files, 19 load;
                              external-rules/throwing-check is an ESM check that throws)
docs/*.md            Starlight pages synced to opentp.dev: index, getting-started, validate, fix,
                     generate, mcp, transforms, rules
esbuild/esbuild.js   bundle script (cwd-relative paths, not linted)
install/install.sh, install/install.ps1    one-line installers (latest GitHub release by default,
                     OPENTP_VERSION pin, OPENTP_DOWNLOAD_BASE mirror, SHA256SUMS verification)
.github/workflows/ci.yml (also a reusable workflow), release.yml; .github/ISSUE_TEMPLATE/*.yaml
biome.json, tsconfig.json, tsconfig.test.json (adds *.spec.ts), vitest.config.ts, CONTRIBUTING.md, README.md,
CHANGELOG.md (Keep a Changelog; `## [Unreleased]` until a release, copied into the release notes)
```

Gitignored local artifacts: `dist/`, `releases/` (4 binaries), `build/Dockerfile` (no workflow uses
it), `.idea/`.

## Architecture: the validate pipeline

`main` calls `parseCliArgs` (usage errors: exit 2), checks `OPENTP_LOG_LEVEL` and that every
`--external-*` directory exists, then calls `runValidate` (for validate and fix) or `runGenerate`.

1. **Config discovery.** `findConfigFile(root)` tries `opentp.yaml`, then `opentp.yml`, in `root` only.
2. **Config load** (`loadConfig`). Parses YAML, checks `YYYY-MM`, requires `opentp === SPEC_VERSION`,
   then requires `info.title/version`, `spec.paths.events.root/template`, `spec.events.taxonomy`,
   `spec.events.payload.targets.all` and `spec.events.payload.schema`. No JSON-Schema validation. A
   throw (or a missing `opentp.yaml`) means exit 2 (logged on stderr, no `--json` document). A leading
   `/` in config paths is root-relative.
   **Config sanity** (`validateConfig`, never throws) returns `ConfigIssue[]` that `validateEvents`
   reports **once** with `event: "opentp.yaml"`: an unusable path template (`getMatchTemplateProblems`:
   unclosed/empty/non-identifier/duplicate placeholder, transforms), invalid regexes
   (`spec.events.key.pattern`, taxonomy and fragment `pattern`), taxonomy field/fragment definitions
   that are not mappings, unusable composite `template`s, keygen problems (`getKeygenProblems`: missing
   or unparsable template, a variable that is not a taxonomy field or fragment, an undefined pipeline,
   a pipeline that is not a list, an unknown or malformed step at `keygen.transforms.<pipeline>[<i>]`
   (checked against the step registry, so external transforms must be loaded first; unused pipelines
   are checked too), a non-empty-list `targets.all`, group members and `spec.targets`
   keys that are not in `targets.all`. Per-event code skips whatever these make unusable, so nothing is
   reported again per file.
3. **External transforms** (validate, fix and generate): `loadExternalTransforms` per
   `--external-transforms`, before events are loaded and before `validateConfig` runs (keygen steps are
   checked against the registry). A load failure exits 2.
4. **Dictionaries** (if `spec.paths.dictionaries` is set): `loadDictionaries` scans recursively; the key
   is the relative path without extension (`taxonomy/areas`). Issues (YAML syntax error or a document
   that is not a mapping, missing or mismatched `opentp`, missing or non-array `dict.values`,
   duplicates) become errors with `event: "dictionaries/<file>"`. A file with a syntax error, a
   non-mapping document or bad `dict.values` is not loaded (so references to it are unknown).
5. **Event discovery** (`loadEvents` -> `{ events, issues }`): `.yaml`/`.yml` files under the events
   root are matched with `templateToRegex(spec.paths.events.template)`. Each `{var}` is exactly one
   path segment. Non-matching files are **skipped silently** (no `--strict` yet). With an unusable
   template nothing is loaded and nothing is reported here (validateConfig reports it); a missing
   events root is one issue against `opentp.yaml` (`spec.paths.events.root`). A matching file that
   cannot be read or parsed (YAML errors as `Invalid YAML at line L, column C: <reason>` with path
   `""`), is not a mapping, or has no `event` / `event.taxonomy` mapping is **not loaded** and becomes
   an `EventLoadIssue` (`file` = path relative to the events root).
6. **Taxonomy** (`extractTaxonomy`): only fields declared in `spec.events.taxonomy` are read. A path
   value **wins** over `event.taxonomy`. `parseTypedValue` coerces path strings to integer, number or
   boolean (the raw string is kept on failure). Composite fields (`template` + `fragments`) are split by
   `extractFragments` (via `patternToRegex`, vars may span `/`) and merged **flat** into the taxonomy.
   An unexpected throw here is an `EventLoadIssue` at `event.taxonomy`.
7. **Keygen** (`prepareKeygen`, only when `getKeygenProblems` is empty): `createTransforms(keygen.transforms)`
   builds named pipelines (a throwing step factory is one issue against `opentp.yaml`; unknown or
   malformed steps never get here, and `createStepFn` throws on them instead of returning identity) and
   `applyPattern` evaluates `{var | pipelineA | pipelineB}`, producing `expectedKey`. Pipeline names
   are keys of `keygen.transforms`, **not** step names. A per-event failure (a variable with no value
   for this event, a throwing step) keeps the event with `expectedKey: null` and `keygenError`, which
   `validateEvent` reports at `event.key` as `Cannot generate the expected key: <reason>` (inside the
   `key` ignore guard).
8. **Fix mode** sets `event.key = expectedKey` via `loadYaml` + `saveYaml`, then runs full validation.
   With any `validateConfig` issue it rewrites nothing (`Event keys were not fixed: ...`).
9. **Validation** (`validateEvents`): loads external rules, reports `validateConfig` issues and unknown
   taxonomy/fragment dictionaries (`validateTaxonomyDictionaries`, path
   `spec.events.taxonomy.<f>[.fragments.<frag>].dict`) once against `opentp.yaml`, finds duplicate keys,
   reports `spec.targets.<t>.schema` vs base-schema conflicts, then runs `validateEvent` per event:
   - the spec version, then key checks (missing, `spec.events.key.minLength/maxLength/pattern`, keygen
     failure or mismatch);
   - `validateTaxonomy`: required, type, enum, dict (unknown dicts skipped: reported once), constraints,
     `x-opentp.checks`, composite fragments;
   - `validatePayload`: `resolveEventPayload`, then per **target id x version** on the merged schema
     (base `spec.events.payload.schema` -> `spec.targets.<t>.schema` -> event schema): layer conflicts
     (type change, weakened `required`/`valueRequired`), enum/dict/value exclusivity, dicts,
     `valueRequired`, fixed-value type and constraints, checks (only on fixed scalar values), PII.
10. **Output**: see the CLI reference. For validate/fix the errors are
    `[...loadIssuesToErrors(dictIssues, eventIssues), ...validateEvents(...)]` and the exit code is
    `errors.length === 0 ? 0 : 1`, computed in `runValidate` (2 only for the config/usage cases above). `count=` / `eventCount=` count loaded
    events only.

Payload resolution (`src/core/payload.ts`; normative semantics: `opentp-spec/docs/semantics.md`):
- A raw payload that is itself a version (`payload.schema`) or a versioned target (`payload.current`)
  becomes `{ all: raw }` ("implicit all"); otherwise every key is a selector.
- A selector is a group from `spec.events.payload.targets` (groups win) or a target id in `targets.all`.
  Each target may be covered at most once. Group members not in `all` are ignored here (reported once
  by `validateConfig`); a selector that covers no target in `all` is an event error at
  `payload.<selector>`. An invalid `targets.all` is reported only by `validateConfig`.
- Unversioned payloads are stored under `UNVERSIONED_VERSION_KEY`. Versioned ones are `current` plus
  version objects plus string aliases.
- `$ref: "<versionOrAlias>"` stays within the selector. `$ref: "<selector>::<versionOrAlias>"` crosses
  selectors, where `<selector>` is the key written in this event's payload, not a target id.
- `mergeField`: override keys win; `pii` and `x-opentp` are shallow-merged; `value`/`enum`/`dict` are
  mutually exclusive across layers (value > enum > dict).

## CLI reference

Usage: `opentp [validate | fix | generate <name> | mcp | help | version] [options]`. Arguments are parsed by
`parseCliArgs` (`node:util` `parseArgs` with `strict: true`, `allowPositionals`, `tokens`; Node and Bun
behave the same). The first positional is the command (default `validate`); options may appear
anywhere. Anything unexpected is a `UsageError`: `✗ <message>` plus a two-line usage on stderr, exit 2.

| Command | Behaviour |
|---|---|
| `validate` (default) | Pipeline above |
| `fix` (or `validate --fix`/`-f`) | Needs `spec.events.x-opentp.keygen` (else exit 2). Rewrites keys (none while `validateConfig` reports anything), then validates; the exit code comes from validation |
| `generate <name>` | `<name>` is the second positional, wherever it appears (`generate -o x.json json` works); missing name or extra positionals exit 2. Built-ins: `json`, `yaml`, `template`; an unknown name exits 2. Does **not** validate events or load rules, but **refuses (exit 1)** when the plan cannot be loaded completely: any `validateConfig` issue (including unknown keygen steps, hence `--external-transforms` is accepted here), any dictionary issue, or any event load issue. The problems go to stderr (`formatErrors` via `console.error`), stdout stays empty, nothing is written. Generator `stdout` is written verbatim (`process.stdout.write`, no added newline), so piped output equals the `-o` file; json and yaml output end with a newline |
| `mcp` | Serves the plan over MCP on stdin/stdout until stdin closes (exit 0). The plan must load at start: `opentp.yaml` missing or invalid exits 2 before serving. Accepts `--external-rules` and `--external-transforms`. See "MCP server" |
| `help`, `--help`, `-h` | Prints help on stdout, exit 0. The `help` command takes no arguments (`help validate` exits 2). `-h`/`--help` win over the command, its options and its arguments (checked after unknown commands and options) |
| `version`, `--version`, `-V` | Prints version and schemas URL on stdout, exit 0. The `version` command takes no arguments; `-V`/`--version` win like `--help`. `-v` is verbose, not version |

`export` (a hidden alias of `generate json` up to 0.7.4) was removed: it is an unknown command now
(exit 2). Use `generate json`.

| Flag | Commands | Notes |
|---|---|---|
| `--root <p>`, `-r <p>`, `--root=<p>` | all | Project root. Default: `$OPENTP_ROOT`, otherwise cwd. Resolved relative to cwd |
| `--verbose`, `-v` | all | Debug logs (stderr) |
| `--json` | validate, fix | Prints `{ "success": bool, "events": <loaded count>, "errors": ValidationError[] }` to stdout and nothing else (also with `-v` and `fix`). No document on exit 2 |
| `--fix`, `-f` | validate, fix | Same as the `fix` command |
| `--external-rules <dir>` | validate, fix, mcp | Repeatable; loaded inside `validateEvents` |
| `--external-transforms <dir>` | validate, fix, generate, mcp | Repeatable; loaded before the plan |
| `--external-generators <dir>` | generate | Repeatable |
| `--output <p>`, `-o <p>` | generate | Generator output file, resolved **relative to `--root`**. Default: stdout |
| `--file <p>` | generate | Template generator input, resolved **relative to cwd** |
| `--pretty` / `--no-pretty` | generate | Read only by the json generator. Default: pretty; the last one wins (token order) |

- Every value flag also takes `--flag=value`. An empty value (`--root=`), a missing value (`--root` at
  the end) or a value that starts with `-` (`--root --json`: "ambiguous") is a usage error; use
  `--root=-dir` for such paths.
- A flag that the command does not accept (per `COMMAND_OPTIONS`) is a usage error, e.g. `validate -o x`
  or `generate json --json`. `help`/`version` accept every known flag.
- `--external-*` directories are resolved against cwd and must exist (`main` checks them before running
  anything: `✗ --external-rules: directory not found: <abs path>`, exit 2).
- **Env vars:** `OPENTP_ROOT` (default root); `OPENTP_LOG_LEVEL` = `trace|debug|info|warn|error|fatal`
  (exact lowercase; default `info`; empty = unset). Any other value exits 2 (`Invalid OPENTP_LOG_LEVEL
  'foo'. Expected one of: ...`), except for `help`/`version`.
- **Exit codes** (`EXIT_OK`, `EXIT_FAILURE`, `EXIT_USAGE` in `cli.ts`; documented in `docs/index.md`,
  `printHelp`, README):
  - `0`: success, help, version.
  - `1`: validation errors (including `validateConfig` issues, dictionary and event load issues),
    generate refusing an incompletely loaded plan, a throwing generator (`Generator failed`), an
    unexpected crash (`✗✗ Fatal error`).
  - `2`: usage errors (unknown command/option, missing/empty/ambiguous value, option not accepted by the
    command, missing or extra positional, invalid `OPENTP_LOG_LEVEL`, missing `--external-*` directory,
    an external transforms/generators load failure, unknown generator) and configuration errors that
    stop a run before it starts (`opentp.yaml` not found or `loadConfig` throws; `fix` without keygen).
- **Exit and streams:** `main()` returns the code and the bootstrap sets `process.exitCode` on the
  **global** `process` (there is no `import * as process`; that namespace is read-only in the bundle).
  The bootstrap runs only when `require.main === module`: true for the CJS bundle run as the entry
  point (`node dist/index.cjs`, the bin after `npm link`, `bun dist/index.cjs`) and, because Bun leaves
  both undefined in an ES module, for `bun src/cli.ts` and the compiled binaries; false under vitest
  (`module` is an object, `require.main` undefined) and for `require("opentp")` (the host's module).
  Nothing calls `process.exit`, so stdout is flushed completely into pipes, except the bootstrap's
  `process.stdout` `EPIPE` handler (reader went away, e.g. `| head`), which exits quietly.
- **`ValidationError`:** `{ event, path, message, severity: "error" }`. Path format: see Coding
  conventions. `event` is a **display label, not a file path**:
  - event errors: path relative to the events root (`path.join(getEventsPath(config, root), event)`);
  - `"opentp.yaml"` (config issues, unknown taxonomy dictionaries, a missing events root) is literal
    even when the file is `opentp.yml` (use `findConfigFile`);
  - `"dictionaries/<file>"` has a literal prefix whatever `spec.paths.dictionaries.root` is (join
    `<file>` to `getDictsPath(...)`).
- **Positions:** only YAML syntax errors carry a line and column, inside the message
  (`formatLoadError` reads `YAMLParseError.linePos`); such file-level errors have `path: ""`. Other
  errors have no position, because `loadYaml` uses `yaml.parse` (positions would need `parseDocument`
  plus `LineCounter`).
- **Human output:** `[<event>]` blocks with `  ✗ <path>: <message>` lines (just `  ✗ <message>` when the
  path is empty) on stdout (`formatErrors`, printed with `console.log`), then
  `✗ ✗ Validation failed errorCount=N eventCount=M` on stderr (a logger line).
  Success: `✓ All events are valid count=N` on stderr (logger info), so a valid plan prints nothing to
  stdout. Every logger line (info/debug/warn/error, including the `fix` and `Generated file=...` lines)
  goes to stderr; stdout carries only the report, the `--json` document, help/version, or generator
  output.

## MCP server (`opentp mcp`)

stdio only for now; an HTTP mode (`opentp serve` with `/mcp` and a web UI) is the
planned next step ("phase 2" below).

- **SDK:** `@modelcontextprotocol/server` v2 (`McpServer`, `ResourceTemplate`, `serveStdio` from the
  `/stdio` subpath, found through the package's `typesVersions` under `moduleResolution: node`). It
  serves MCP revision 2026-07-28 and 2025-era clients (`initialize` handshake) on the same connection
  type. Tool input schemas are `zod/v4` objects. Bundled by esbuild (its CJS build) and by
  `bun --compile` (verified with Bun 1.3.5 and 1.3.6; the binary grew by about 0.8 MB).
- **Read-only by design:** no tool writes a file (owner decision 2026-10-03). Agents write event files
  themselves; `suggest_event` and `validate_event_draft` tell them where and whether it is right. Every
  tool has `readOnlyHint: true`. Do not add write tools without the owner (planned only behind an
  opt-in `mcp.write` in `opentp.cli.yaml`).
- **PlanStore** (`plan.ts`): loads the plan like `runValidate` (config, dictionaries, events) into a
  `PlanSnapshot`. Each `current()` call compares mtime and size of `opentp.yaml` and of every file
  under the events and dictionaries roots with the last load and reloads the whole plan on any change.
  The snapshot caches the search index and the full validation result.
  Events are sorted by relative path; `byKey` keeps the first event for a duplicate key.
  `PlanError` (opentp.yaml missing or not loadable) becomes an error result of every tool; `runMcp`
  checks the plan once before serving and exits 2 instead.
- **Tools** (`tools.ts`) are plain functions over a snapshot, unit-tested without MCP. `ToolError` (an
  unknown key, target, version or dictionary, an absolute path or one with `..`, an unusable path
  template) becomes an error result; any other exception is logged and returned as
  `Internal error: ...`. Draft tools load YAML text through `loadEventDocument` with a context from
  `createEventLoadContext`, then run `validateEvents([draft])` and add a duplicate-key check against
  the plan (validateEvents only sees the list it gets). `generate` refuses an incompletely loaded plan
  (like the CLI).
  - **Drafts never trigger requests:** `validate_event_draft` deletes every `checks.webhook` that the
    draft YAML defines before validating (`removeDraftWebhooks`), so a prompt-injected draft cannot
    send `${ENV}` values to its own URL. Webhook checks from `opentp.yaml` still run, so the
    validating tools (`validate_event_draft`, `validate_plan`, `suggest_event`) have
    `openWorldHint: true`.
  - **Limits:** one response is at most `MAX_RESPONSE_BYTES` (256 KB of UTF-8 text), checked in
    `run()` for every tool and in the resource handlers. `generate` sends the export once, as the
    text; its structured content is metadata only.
  - **Inputs read defensively:** `aliases` is not schema-checked, so alias lookups accept any shape;
    versions and aliases are looked up with `Object.hasOwn` (no `toString`, no `__unversioned__`).
  - `validate_plan` with `files` reports each file's status (`loaded`, `load-error`, `not-loaded` =
    on disk but skipped by the path template or not YAML, `not-found`) and `filesValid`, because
    `loadEvents` skips non-matching files silently. `suggest_event` refuses a path that the template
    would read back with different values (placeholders sharing a segment).
- **Search** (`search.ts`): BM25 (k1 1.2, b 0.75) over character trigrams of words (letters and
  digits, Unicode), text normalized with NFKD + combining marks removed + lowercase; no stemming, no
  locale (the CLI is language-agnostic). The event document is the key, taxonomy values and the
  names/titles/descriptions/fixed values/enums (up to 10 values) of the payload fields the event
  defines. The file path is deliberately left out: its values are already taxonomy values, and
  repeating them only skews the ranking.
- **stdout is the protocol.** `runMcp` calls `reserveStdoutForProtocol()` right after `opentp.yaml`
  loads and before plugins are imported: every console method is rebound to a `Console` on stderr
  (needed for Bun, whose console writes to fd 1 directly) and `process.stdout.write` goes to stderr;
  the SDK's `StdioServerTransport` gets a private `Writable` over the real stdout. The redirect is
  global and permanent for the process, so it runs only in `mcp` (not before the config check, which
  `cli.spec.ts` exercises in-process). `tests/data/mcp-noisy-plugins` (a transform and a check that
  print at import) are passed to the smoke test in CI and in the release binary smoke.
- **Exit:** the server returns from `main` (exit 0) when stdin ends or closes.
- **Tests:** `src/mcp/{search,tools,server}.spec.ts` (the server spec uses the SDK client over
  `InMemoryTransport`), `cli.spec.ts` (argument cases, exit 2 without a plan), and `tests/mcp-smoke.mjs`
  for the bundle (CI) and every binary (`release.yml`). The draft-webhook test runs a local HTTP
  server and asserts zero requests (without the removal the check fires once per target).
- **Before HTTP (`opentp serve`, phase 2), still open:** a draft's own `pattern` (or `checks.pattern`)
  runs on the main thread, so a catastrophic-backtracking regex blocks every client (run draft
  validation in a worker with a timeout, or skip draft-defined patterns); `scanDirectory` follows
  symlinks, so a link under the events root can expose files outside the plan (resolve with
  `realpathSync` and skip targets outside the roots); `opentp mcp` finds the plan only through
  `--root`, `$OPENTP_ROOT` or the cwd, and clients do not all start servers in the project folder
  (owner decision 2026-10-03: keep this for now and check with real clients; MCP roots, where the
  client tells the server its project folders, are the candidate if that is not enough).

## Plugin systems (transforms, rules, generators)

All three systems share one design:
- **Registry:** a module-level `Map` in `<system>/registry.ts`, filled by the **import side effect** of
  `<system>/index.ts` (`registerStep` / `registerRule` / `registerGenerator`). `cli.ts` imports
  `./transforms` and `./generators`; rules arrive via `core/validator.ts`.
- **Interfaces:** `src/{transforms,rules,generators}/types.ts`. `RuleContext.specField` is never set;
  the CLI fills only `output`, `file` and `pretty` in `GeneratorOptions`.
- **Naming:** a plugin registers under `definition.name`, not its folder name. `Map.set` means **a
  same-named plugin silently replaces the built-in** (verified with an external `starts-with`).
- **External loading** (`loadExternal{Transforms,Rules,Generators}(dir)`): `dir` is resolved against
  cwd (`path.resolve`), and each first-level `<dir>/<anyName>/index.js` is loaded with
  `await import(pathToFileURL(path.resolve(dir, name, "index.js")).href)` (a file URL: a bare path would
  be a module specifier, and breaks on Windows; esbuild keeps this `import()` native in the CJS bundle).
  The plugin is `module.default || module[<folderName>]` and must have `factory` / `validate` /
  `generate`. ESM or CJS follows the nearest `package.json` `type` (Node 22 also detects ESM syntax);
  for CJS, `module.exports = { ... }` works, but TS-style `exports.default = ...` is skipped silently
  (the namespace `default` is the whole `module.exports`). `.mjs`/`.cjs`/`.ts` are ignored. A missing
  dir (or a file) throws `External <kind> directory not found: <abs path>` (the CLI checks this up front,
  exit 2). A module that fails to import is logged with `console.error` and skipped; its checks then
  report `Unknown check`, its steps `Unknown transform step`, its generator `Unknown generator`.
  Tested in `src/external-plugins.spec.ts` (works under vitest too).
- **Transforms** (keygen only): a step is a string or a single-key object `{ stepName: params }`.
  `getStepProblem(step)` reports unknown steps (`Unknown transform step '<name>' (custom steps are loaded
  with --external-transforms)`) and malformed ones (`Invalid transform step <json>: expected a step name
  or a single-key mapping { <step>: <params> }`); `getKeygenProblems` turns them into config issues and
  `createStepFn` throws them (library callers of `createTransform(s)` get an exception, never identity).
  Bad **params** of a known step are still not checked (most steps fall back to identity).
  - Existing case steps are **ASCII-oriented**: `to-snake-case`, `to-kebab`, `to-underscore` and
    `collapse` drop or split on every char outside `[A-Za-z0-9]` (`"Вход"` -> `""`); `to-camel-case`
    splits only on `-`, `_` and whitespace and lowercases everything first (`loginButton` ->
    `loginbutton`). Keygen does not report an empty segment, so different events can end up with the
    same key (then reported as duplicate keys).
    New steps should use Unicode classes (`/[^\p{L}\p{N}]+/u`) or document ASCII-only behaviour in
    `docs/transforms.md`.
  - Do not copy the `@example { step: 'x' }` JSDoc from existing steps; that syntax is obsolete (the
    real form is `- x` or `- { x: params }`).
- **Rules** (`validateWithRules`) run sequentially in YAML key order. Unknown check gives
  `Unknown check: <name>` (`code` is not printed). A rule that throws, rejects or returns a non-object
  gives `check <name> failed: <message>` (`code: "CHECK_FAILED"`) for that value and the run continues.
  Portable constraints (`minLength`, `pattern`, ...) live in `validator.ts`, not rules.
- **Generators** get the **raw** `event.payload` (no base/target merge, no `$ref`). json/yaml export
  `{ opentp, info, events: [{ key, taxonomy, lifecycle, payload }], dictionaries }`. `template` is a
  mustache subset (`{{a.b}}`, `{{#each}}`, `{{#if}}`, `{{@index}}`). The CLI prints `stdout` and writes
  `files[]` (relative paths against `--root`, directories created).

## Ignore mechanism

`buildIgnoreSet` (validator.ts) turns `event.ignore: [{ path, reason }]` into a set matched literally
against check paths, plus these aliases:
- `key` and `event.key` are equivalent (skip the missing, constraint and keygen key checks).
- `opentp` skips the event spec-version check; `taxonomy.<field>` / `taxonomy.<fragment>` skip that field.
- **Any** `payload.*.schema.<field>...` path adds `payload::<field>`, ignoring that field for **every
  target and version**. Deliberate (commit a74be5a) and pinned by
  `coverage-valid/events/auth/2/false/ignored_application_id_dict.yaml`
  (`payload.all.1.0.0.schema.application_id.value`).
- **Never ignorable:** load issues, `opentp.yaml` problems (`validateConfig`, unknown taxonomy
  dictionaries), duplicate keys, payload resolution issues (alias/`$ref`/selector, zero-target
  selectors), event-vs-base layer conflicts and `spec.targets.<t>.schema` conflicts. A per-event keygen
  failure (`Cannot generate the expected key`) is a key check, so `ignore: key` hides it.
- `reason` is not enforced, stale entries are not reported, and `fix` ignores the list entirely.

## Tests and fixtures

- **Harness:** `runFixture(name, { externalRules?, mutateConfig? })` in `fixtures.spec.ts` mirrors the
  CLI pipeline (`loadConfig` -> `loadDictionaries` -> `loadEvents` -> `validateEvents`, errors =
  `loadIssuesToErrors(...)` + validation errors, exactly like `runValidate`) but does **not** go through
  `cli.ts`. It reads `process.cwd()/tests/data/<name>` (so cwd must be `opentp-cli/`) and returns the
  loaded event count and all errors.
- **coverage-valid** (4 events): errors (dictionary, load and validation) must be exactly `[]`.
- **coverage-invalid** (22 matching event files, 19 load): the assertion is **exhaustive**. The sorted
  `[event, path, message]` tuples must equal `COVERAGE_INVALID_ERRORS` in `fixtures.spec.ts` (35
  entries, sorted by code point in the test, so the literal's order is free), so a missing, extra or
  duplicated error fails. Every new invalid case needs its tuples added there. The harness loads
  `coverage-invalid/external-rules` (`throwing-check`, ESM `export default`, used by
  `check_throws.yaml`); the CLI needs `--external-rules "$PWD/tests/data/coverage-invalid/external-rules"`
  to match (without it that event reports `Unknown check: throwing-check`, same error count).
- **Config-level cases** that would break a whole fixture (an unusable path template, an unknown keygen
  pipeline or transform step) are tested with `mutateConfig` on `coverage-valid` (they must yield exactly one
  `opentp.yaml` error and no per-file errors) and in `config.spec.ts`. Per-event keygen failures cannot
  occur in `coverage-invalid` (all its keygen variables come from the path) and are covered by
  `event.spec.ts` (temp directories under `os.tmpdir()`).
- **Path template (both):** `{area}/{priority_level}/{is_internal}/{event}.yaml`, with `area` (string,
  `dict: taxonomy/areas`), `priority_level` (integer, enum `[1,2,3]`), `is_internal` (boolean, enum
  `[true,false]`), `event` (file name). `events/auth/2/false/x.yaml` = area auth, priority 2, not
  internal. Deliberately bad dirs in invalid: `auth/1/maybe/`, `auth/5/false/`, `badarea/1/false/`.
- **The two `opentp.yaml` files differ** (diff before copying an event across):
  - valid: keygen `{area | slug}::{event | slug}::{verb | slug}::{object | slug}::p{priority_level}::internal-{is_internal}`,
    key `minLength`/`maxLength` + 6-part pattern, fragment patterns, `custom_id` check
    `starts-with: "cid_"`, richer base schema, `retention_days` PII meta, `spec.targets.ios`;
  - invalid: keygen `{area | slug}::{event | slug}::p{priority_level}::internal-{is_internal}`, 4-part
    pattern, `custom_id` check `unknown-check: true`, `ticket` check `throwing-check: true`, `team`
    (`dict: taxonomy/teams`, missing) and fragment `verb` (`dict: taxonomy/verbs`, missing), extra
    groups `web_ios: [web, ios]` and `legacy: [desktop]` (not in `all`), `spec.targets.desktop`
    (unknown), smaller base schema, and the broken dictionary `dictionaries/broken/invalid_yaml.yaml`.
- Every fixture file uses `opentp: 2026-01`; valid event keys must equal the keygen output.
- Broken event files (`yaml_syntax_error`, `missing_event`, `missing_taxonomy` in invalid) are errors
  and are not counted as loaded; files that do not match the path template are skipped with no message,
  so a new fixture file must match the template. After adding one, confirm the loaded count with
  `node dist/index.cjs validate --root tests/data/<fixture>` (and update the `eventCount` assertions).
- **`src/cli.spec.ts`** imports `./cli` (safe at any checkout path: under vitest `require.main` is
  undefined, so the bootstrap guard does not fire; the first test asserts `process.exitCode` is still
  unset, which catches a guard that fires on import) and tests `parseCliArgs`
  (pass an `env` object for `OPENTP_ROOT`) and `main(args)` in-process: `main` returns the exit code and
  never exits, so specs spy on `console.log`/`console.error`/`process.stdout.write` to check the
  stdout/stderr split. Plans that need a changed `opentp.yaml` are copied from `coverage-valid` into a
  temp dir (`planCopy`); `breakEventKey` gives one of its events a wrong key for the `fix` cases. The
  bundle itself (`dist/`) is only exercised by the CI smoke step, because CI runs `npm test` before
  `npm run build`, and the binaries only by the release smoke step.
- **`src/external-plugins.spec.ts`** writes ESM and CJS plugin folders (with a `package.json` that fixes
  the module type) under `os.tmpdir()`, loads them by absolute and cwd-relative path, and checks a
  missing directory and a plugin that fails to import. Registries are module-level and shared within a
  spec file, so plugin names carry a per-run id.
- **`*.spec.ts` are type-checked only by `tsconfig.test.json`** (`npm run typecheck`, CI). `tsconfig.json`
  excludes them, vitest strips types and Biome does not check types, so a spec that only runs under
  vitest can still fail CI. `RuleDefinition.validate` and `GeneratorDefinition.generate` return
  `T | Promise<T>`: specs `await` the result (`const result = await rule.validate(...)` in an `async`
  test) before reading fields.

## Recipes

**Add a built-in transform step**
1. `src/transforms/<step-name>/index.ts`: `export const myStep: StepDefinition = { name: "<step-name>",
   factory: (params?) => (value) => ... }`. Return identity on bad params; escape user strings used in
   RegExp; mind the case-step note under Plugin systems.
2. `transform.spec.ts` next to it (`myStep.factory(params)(input)`).
3. Import + `registerStep` in `src/transforms/index.ts`; add the name to the `getStepNames` test in
   `src/transforms/index.spec.ts`. Imports must stay sorted (Biome `organizeImports`), or `npm run lint`
   fails; run `npm run lint:fix`, which also moves the `// Import built-in ...` comment (expected).
4. Step names are also listed in the README "Transforms" table, the `docs/transforms.md` "Built-in
   Steps" list and this file's layout block. Find them with
   `grep -rn to-camel-case . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=releases`.
   The README rows for `collapse` (it removes every non-`[A-Za-z0-9]` char) and `to-underscore` (every
   non-alphanumeric run becomes `_`, no lowercasing) are wrong; fix them while there.
5. If the spec should validate the step's params, extend `definitions.transformStep` in
   `opentp-spec/schemas/opentp.schema.json` (a spec change; today only `replace` and `truncate` params
   are validated there).

**Add a built-in rule (`x-opentp.checks`)**
1. `src/rules/<rule-name>/index.ts` exporting a `RuleDefinition`: return
   `{ valid: false, error, code: "UPPER_SNAKE" }`, guard `typeof value` (`TYPE_MISMATCH`), **never throw**.
2. `rule.spec.ts` with `ctx = { fieldName: "test", fieldPath: "test", eventKey: "test" }`.
3. Register in `src/rules/index.ts` (sorted imports, as above); add to the `getRuleNames` test in
   `src/rules/index.spec.ts`.
4. Update `docs/rules.md` and the README "Validation Checks" list; optionally exercise it in
   `coverage-valid` (like `custom_id`).

**Add a built-in generator**
1. `src/generators/<name>/index.ts` exporting a `GeneratorDefinition`: return `{ stdout }`, or
   `{ files: [...] }` when `options.output` is set. A throw becomes `Generator failed`, exit 1.
2. `generator.spec.ts` (copy `mockContext` from `json/generator.spec.ts`).
3. Register in `src/generators/index.ts`; add to the hard-coded "Generators:" list and examples in `printHelp`.
4. New options need an `OPTIONS` entry, a `COMMAND_OPTIONS.generate` entry and a `case` in
   `parseCliArgs` that sets `generatorOptions` (no generic passthrough).
5. Update `docs/generate.md` and the README "CLI Commands" table. For typed/SDK output, build on
   `resolveEventPayload`, not the raw `event.payload`.

**Add an MCP tool**
1. A plain function in `src/mcp/tools.ts` that takes a `PlanSnapshot` and returns a JSON-able object;
   throw `ToolError` for a bad request. Keep it read-only (see "MCP server").
2. Register it in `buildMcpServer` (`src/mcp/server.ts`) with a `zod/v4` input schema, a description an
   agent can act on, and `annotations: READ_ONLY`.
3. Tests in `src/mcp/tools.spec.ts` (and `server.spec.ts` if the wire format matters); add the name to
   `TOOLS` in `server.spec.ts` and `EXPECTED_TOOLS` in `tests/mcp-smoke.mjs`.
4. Document it in the tools table of `docs/mcp.md`, the README tool list and `CHANGELOG.md`.

**Add a CLI flag:** `CliOptions` + an `OPTIONS` entry (`type`, optional `short`, `multiple`; `--flag v`
and `--flag=v` come for free) + the commands that accept it in `COMMAND_OPTIONS` (or `GLOBAL_OPTIONS`) +
a `case` in the `parseCliArgs` token loop + `parseCliArgs` cases in `src/cli.spec.ts` + `printHelp` +
`docs/<command>.md` + `docs/index.md` (global flags) + README "Options". Unknown flags and flags a
command does not accept exit 2, so the new flag is unusable until it is in both tables.

**Add or change a validation check**
1. Edit `validateTaxonomy`, `validatePayload` or `validateEffectiveValue` in `src/core/validator.ts`.
   Respect the ignore guards (`ignore.has(checkPath)`, `payload::<field>`) and the existing path format.
2. Add a negative case at `coverage-invalid/events/<area>/<1-3>/<true|false>/<name>.yaml` (key consistent
   with the *invalid* keygen, so it adds no unintended key errors) and its tuples to
   `COVERAGE_INVALID_ERRORS` in `fixtures.spec.ts` (exhaustive). If it is valid usage, extend
   `coverage-valid` too (must stay at zero errors).
3. Payload shape changes go through `payload.ts` and `src/types/index.ts`, in sync with
   `opentp-spec/schemas/event.schema.json` (payload shape) and `docs/semantics.md`. Field keywords: see
   the next recipe.

**Support a new field keyword from opentp-spec**
- Spec sources: `schemas/field.schema.json` (payload fields and `items`) and the `opentp.schema.json`
  definitions `taxonomyField`, `piiConfig` and `eventKeyConstraints`; prose in `docs/schema/events.md`,
  `docs/schema/opentp-yaml.md`, `docs/semantics.md`. Find the change with
  `git -C ../opentp-spec log -p -- schemas docs`.
- Types: constraint keywords are repeated in `ArrayItems`, `Field`, `TaxonomyField`,
  `PiiReservedFieldConfig`, `PiiMetaFieldConfig` and `EventKeyConstraints` (`src/types/index.ts`), plus
  the legacy `FieldDefinition` in `src/rules/types.ts`.
- Checks exist **twice** in `validator.ts`: the nested `validateStringConstraints` /
  `validateNumberConstraints` inside `validateTaxonomy` (fields and fragments), and the copies inside
  `validatePayload` (effective `value`, `enum` entries, array items via `validateArrayItems`, PII
  kind/masker/meta). Key constraints are a separate block in `validateEvent`.
- `mergeField` inherits new keys automatically; the layer-conflict checks cover only `type`, `required`
  and `valueRequired`.
- A metadata-only keyword needs only types, fixture usage and docs. Precedent: CLI 885ef4d paired with
  spec 27b1a4c ("added missing fields": `name`, `example`). The spec is tracked by version string only
  (2026-01 was edited in place in 27b1a4c); bump `specVersion` only if the spec version itself changed.
- Unknown keywords are ignored silently (no JSON Schema validation), so a new keyword has no effect until
  it is coded. Already unimplemented: `format` (typed as `StringFormat`, never checked, including
  `spec.events.key.format`); `lifecycle`, `aliases`, `meta` and extra keys; `dict.type` (never compared
  with the values). Unknown `type` values (e.g. `object`) are not rejected: payload checks skip them,
  and taxonomy `validateType` falls through to the boolean check.

**Report a load-time or configuration problem as an error**
Pick the layer by where the problem lives, so that each problem is reported exactly once:
1. **A problem in `opentp.yaml` alone** (no dictionaries needed): add it to `validateConfig` in
   `src/core/config.ts` as a `ConfigIssue` (`path` = dotted config path, e.g.
   `spec.events.payload.targets.<group>`). `validateEvents` reports it once against `opentp.yaml`, `fix`
   then rewrites nothing and `generate` refuses. Make the per-event code skip whatever the problem makes
   unusable (as `loadEvents` does for the path template and keygen, and `validateTaxonomy` for regexes
   and composite templates), or it will be reported again per file. Unit-test it in `config.spec.ts`.
2. **A config problem that needs dictionaries**: report it in `validateEvents` next to
   `validateTaxonomyDictionaries`, with `event: "opentp.yaml"`.
3. **A problem in one event file that prevents loading it**: push an `EventLoadIssue` in `loadEvents`
   (`src/core/event.ts`) and `continue` (the event is not loaded; `generate` refuses). Use
   `formatLoadError` for thrown errors (YAML errors keep the line and column). A problem that does not
   prevent loading belongs in `validateEvent` instead (like `keygenError`), so the rest of the event is
   still validated and `generate` still works.
4. **A problem in one dictionary file**: push a `DictionaryIssue` in `loadDictionaries`.
5. Callers map issues with `loadIssuesToErrors` / `configIssuesToErrors` (`runValidate`, `runGenerate`,
   `runFixture`); there is no other mapping to keep in sync. Add fixture cases as in "Add or change a
   validation check", or a `mutateConfig` test when the problem would break the whole fixture.

**Bump the spec version**
1. `package.json` `specVersion`. `loadConfig` requires `opentp === SPEC_VERSION`. `loadDictionaries`
   (called with `config.opentp`) and `validateEvent` then compare dictionary and event files against
   `config.opentp`, so loosening the `loadConfig` check also loosens theirs.
2. `opentp:` in every file under `tests/data/` and in the `src/generators/*/generator.spec.ts` mocks.
3. Format changes in `src/types/index.ts`, `config.ts` (required fields, format-error example),
   `payload.ts`, `validator.ts`; `2026-01` snippets and schema URLs in `README.md` and `docs/*.md`.
4. Old plans are rejected outright; say so in the release notes.
5. CI checks out `opentrackplan/opentp-spec` at the tag named like the new `specVersion` and validates its
   `examples/simple` and `examples/full`. Cut that spec tag first, or CI fails.

## Release process

1. Make sure `main` is green in CI (lint, both type-checks, tests on Node 20 and 22, build, smoke tests).
   `release.yml` runs the same workflow again as its `verify` job and runs every compiled binary before
   uploading it, so a tag cannot ship untested code.
2. `npm version X.Y.Z --no-git-tag-version` updates `package.json` and both `version` fields in
   `package-lock.json` without committing or tagging. There is no release-commit convention: past bumps
   went into the change commit itself (e.g. a74be5a `fix: respect dictionary ignores`). While the
   version is `0.x`, a release with breaking changes bumps the minor version (the breaking changes
   after 0.7.4 made the next version 0.8.0, owner decision 2026-10-02).
   In `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and add a new empty
   `## [Unreleased]` above it.
3. The installers need no change: they install the latest GitHub Release unless `OPENTP_VERSION` pins
   one. Do not reintroduce a hard-coded version.
4. Commit and tag `vX.Y.Z` (existing tags are lightweight). Only when asked (Rule 7), push `main` and the
   tag. The binaries print the `package.json` version.
5. On a `v*` tag push, `release.yml` runs these jobs:

   | Job | What it does |
   |---|---|
   | `check-version` | Fails unless the tag equals `v` + `package.json` `version` and `package-lock.json` has the same version |
   | `verify` | Calls `ci.yml` (`workflow_call`): the whole CI, both Node versions |
   | `build` (needs both) | Per runner: `npm ci --omit=dev`, then `bun build src/cli.ts --compile --target=bun-<target>` with Bun 1.3.5, then "Smoke test the binary" (bash, also on Windows): `--version`; `coverage-valid` exit 0 + `count=4`; `coverage-invalid` exit 1 + `Validation failed`; `valdiate` exit 2; `--external-rules` loads `throwing-check`; piped `generate json` = `-o` file; `tests/mcp-smoke.mjs` against `opentp mcp`. A failure uploads nothing, so nothing is released |
   | `release` | `sha256sum` of the four binaries -> `SHA256SUMS`; the `## [X.Y.Z]` section of `CHANGELOG.md` (a warning and only generated notes when it is missing) + generated notes; GitHub Release with the five files (`fail_on_unmatched_files`), `prerelease` when the tag contains `-` |

   | Runner | Bun target | Artifact (fixed name) |
   |---|---|---|
   | ubuntu-latest | linux-x64 | `opentp-linux` |
   | windows-latest | windows-x64 | `opentp.exe` |
   | macos-latest | darwin-arm64 | `opentp-mac` |
   | macos-15-intel | darwin-x64 | `opentp-mac-intel` |

   Artifact names appear in `release.yml` (matrix and the `sha256sum` line), both installers, the
   `compile:*` scripts, README "Enterprise Installation", the "Manual download" instructions in README
   and `docs/getting-started.md`, and company mirrors, so never rename them casually.
6. After `release.yml` finishes, check that every asset returns 200 and that "latest" moved:

   ```bash
   for a in opentp-linux opentp.exe opentp-mac opentp-mac-intel SHA256SUMS; do curl -sIL -o /dev/null -w "%{http_code} $a\n" https://github.com/opentrackplan/opentp-cli/releases/download/vX.Y.Z/$a; done
   curl -fsSL https://github.com/opentrackplan/opentp-cli/releases/latest/download/SHA256SUMS
   ```

7. There is no npm step: the release is the GitHub Release (binaries + `SHA256SUMS`), nothing else
   (Rule 9). The workflow needs no secrets or repository variables.
8. Installers (`install/install.sh`, `install/install.ps1`):
   - URL: `OPENTP_DOWNLOAD_BASE` (default `https://github.com/opentrackplan/opentp-cli/releases/download`).
     Pinned: `<base>/v<OPENTP_VERSION>/<asset>`. Latest (only when the base ends with
     `/releases/download`; any other base needs `OPENTP_VERSION`): one request **without following
     redirects** to `<base minus /download>/latest/download/<asset>`; the redirect must end in
     `/v<semver>/<asset>`, and that tag is then installed exactly like a pinned version (binary and
     `SHA256SUMS` from `<base>/v<version>/`), so both files always come from the same release.
     `install.ps1` needs `curl.exe` for this step (shipped with Windows 10 1803+). `OPENTP_VERSION`
     accepts `0.7.4`, `v0.7.4` or `latest`.
   - Checksums: `SHA256SUMS` next to the asset. 200 -> verify (`sha256sum`, else `shasum -a 256`;
     `Get-FileHash` on Windows), fail on mismatch or a missing entry; 403/404/410 -> warn and install
     unverified **only for versions <= 0.7.4** (`predates_sha256sums` / `Test-PredatesChecksums`; those
     releases have no `SHA256SUMS`), fail for any later version (a release still uploading, an
     incomplete mirror); any other status -> fail. With no hash tool at all, `install.sh` warns and
     installs.
   - `install.sh` was tested on macOS (bash 3.2) against a local GitHub-layout mirror (a small Node
     server with a `latest/download` 302): latest verified, trailing slash, latest without
     `SHA256SUMS` for 0.9.1 (fails) and for 0.7.4 (warns), a new release published between the
     requests (installs the resolved release, verified), mismatch, no release at all, pinned old/new/
     pre-release versions, HTTP 500, missing asset, non-GitHub base, invalid version, `latest`; temp
     files are always removed. The live GitHub redirect was checked (`latest/download/opentp-mac` ->
     `.../download/v0.7.4/opentp-mac`). `install.ps1` has never been run (no PowerShell here): run it
     under Windows PowerShell 5.1 and pwsh 7 (latest, pinned, mismatch, missing `SHA256SUMS`) before
     relying on it.
   - Test with `HOME` and `TMPDIR` pointed into a scratch dir (and `SHELL=/bin/sh` to skip rc edits);
     never against the real `~/.opentp` or shell rc files.
9. opentp.dev docs are not tied to tags; they change only when the website re-syncs (see Docs and
   website sync). There are no signatures and no linux-arm64 or musl builds.

## Docs and website sync

- `docs/*.md` are copied into the private `opentp-website` repo (`src/content/docs/docs/cli/`) by its
  manual `scripts/sync-docs.sh` (sparse clone of this repo's default branch) or `sync-docs-local.sh`.
  The copies are committed there, so a docs change reaches opentp.dev only after a re-sync and
  redeploy. Edit docs **here**, never the website copy.
- Every CLI doc needs Starlight frontmatter: `title` (required), `description`, `sidebar.order`. The sync
  script adds frontmatter only to spec docs. The website sidebar lists CLI slugs explicitly in
  `opentp-website/astro.config.mjs`, so a new page needs an entry there (`docs/mcp.md` needs
  `{ label: 'mcp', slug: 'docs/cli/mcp' }` after `generate` when the release that ships it is synced).
- **Cross-page links are fragile.** Root-absolute links are rewritten **one by one** by `perl` lines in
  `opentp-website/scripts/sync-docs*.sh` (for `index.md`, `getting-started.md` and `generate.md`). A new
  absolute link needs a matching rewrite there, and the rewritten target must also resolve on the built
  site. Only `index.md`'s `/cli/<page>` rewrites work today; the `getting-started.md` rewrites
  (`./transforms`, `./rules`, `../spec/schema/opentp-yaml`) resolve under `/docs/cli/getting-started/`
  and already 404 on opentp.dev. Avoid new cross-page links, or check them on the built or live site.
- Keep README/docs examples runnable against the current CLI; paste real output, not hand-written samples.

## Coding conventions

- **Biome 2** (`biome.json`, `src/**/*.ts` only): 2 spaces, lineWidth 100, double quotes, semicolons,
  trailing commas; `recommended` rules with `noExplicitAny` and `noNonNullAssertion` off.
  `organizeImports` is enforced by `npm run lint`; fix it with `npm run lint:fix`. Moving the
  `// Import built-in ...` comments in `*/index.ts` is expected.
- **TypeScript** strict; `node:`-prefixed built-in imports; `_`-prefix unused bindings.
- **Plugins:** one kebab-case folder named exactly like the registry `name`; `index.ts` exports a
  camelCase const (`toSnakeCase` for `to-snake-case`); specs are `transform.spec.ts` / `rule.spec.ts` /
  `generator.spec.ts` and import `describe/expect/it` from `vitest` explicitly.
- **`RuleResult.code`** values are UPPER_SNAKE (`TYPE_MISMATCH`, `PATTERN_NO_MATCH`, ...).
- **Validation messages** are plain sentences. Paths are dotted check paths (`taxonomy.<f>`,
  `event.key`, `payload.<targetId>[.<versionKey>].schema.<f>[.value|.enum[<i>]|.pii.<k>]`). Payload
  schema paths use resolved target ids, not the selector written in the file. Payload resolution issues
  use the selector name (`payload.<selector>.current`, `.aliases.<a>`, `.<v>.$ref`). Config-level
  problems use `event: "opentp.yaml"` and the dotted config path, reported once (never per event).
  Problems with a whole file (YAML syntax errors, a document that is not a mapping) use `path: ""`.
- **Logging:** use `logger` (`src/util/logger.ts`); every level goes to stderr. stdout is only for
  command output (report, `--json` document, help/version, generator output): never add other stdout
  output. User-facing exit codes come from `EXIT_*` in `cli.ts`; never call `process.exit`.
- **Commits:** conventional prefixes per CONTRIBUTING.md (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`).

## Known issues & traps (verified 2026-10-02)

- **Lockfile platforms.** `package-lock.json` must contain the optional platform packages for every OS (`@rollup/rollup-linux-x64-gnu`, `@esbuild/linux-x64`, `@biomejs/cli-linux-x64`, `@oven/bun-linux-x64`, ...). npm 10 on macOS can drop the non-macOS entries when it updates the lockfile, and then `npm ci` on the Linux CI runners misses native binaries (vitest, esbuild and Biome fail). Update dependencies with npm 11 or later (`npx npm@11 install`) and check with `grep -c '"node_modules/@rollup/rollup-linux-x64-gnu"' package-lock.json` (must be 1).

- **Files that do not match the path template are skipped with no message** (for example a file one
  directory too deep, or `.yml` vs a `.yaml` template). Broken matching files are errors now, but a
  misplaced file is invisible: check `count=`. An optional `--strict` (report non-matching files
  under the events root) is not implemented.
- **A null payload field definition crashes the run.** An empty YAML key under a payload schema (base,
  `spec.targets.<t>.schema` or event) throws a TypeError during validation. The run ends with
  `✗✗ Fatal error`, exit 1, and no other event is reported, because `validateEvents` has no per-event
  try/catch. (A null taxonomy field or fragment definition is reported once by `validateConfig`,
  `Field definition must be a mapping`, and skipped.)
- **Dictionary failures cascade.** A dictionary that is not loaded (YAML syntax error, not a mapping,
  missing or non-array `dict.values`) is one dictionary issue, and every reference to it is reported
  too: once for taxonomy/fragment dicts (`opentp.yaml`), but per event and per target for payload and
  PII dicts.
- **`generate` refuses on any dictionary issue,** including content issues that do not stop the
  dictionary from loading (duplicate values, a wrong `opentp` version), and on any `validateConfig`
  issue, even ones that do not change the export (e.g. an unknown `spec.targets` key). It still does
  not run event validation.
- **Some config problems are still reported per event:** an invalid regex in a payload field `pattern`
  (base, target or event schema; reported per event and target against the event file) and invalid
  base-schema or PII dictionary references.
- **Never call `process.exit` on a normal path.** On macOS, stdout to a pipe is asynchronous: 0.7.4
  called `process.exit` right after `console.log`, and `generate json | wc -c` printed 65536 for a
  1.8 MB export. `main` returns the code and the bootstrap sets `process.exitCode` on the global
  `process`. Do not reintroduce `import * as process from "node:process"` for that: the namespace
  binding is read-only in the esbuild bundle. Lingering timers or sockets now delay the exit (the
  webhook rule clears its timeout in `finally` for that reason).
- **`generate` needs `--external-transforms` when keygen uses custom steps,** although it does not
  generate keys: an unknown step is a `validateConfig` issue, and `generate` refuses on any of them.
- **Exit code 2 is new in 0.8.0.** Up to 0.7.4 every failure was 1 (including a missing or invalid
  `opentp.yaml` and `fix` without keygen), unknown commands ran `validate`, and logger info and debug
  lines went to stdout. CI scripts that test `$? -eq 1` must accept 2 as well. All breaking changes
  since 0.7.4 are listed in `CHANGELOG.md` (`## [0.8.0]`).
- **`fix` rewrites whole files with `yaml.stringify`.** Comments (including `# yaml-language-server`),
  blank lines and quoting are lost, and it overwrites keys even for events with `ignore: event.key`.
  `docs/fix.md` wrongly says that formatting is preserved and only the key changes, and its sample
  output does not match the real `Fixed event key file=...` / `Events fixed count=N` lines.
- **Payload errors are coarse.** Ignores are widened to all targets (pinned by a fixture). Errors repeat
  once per covered target (3x for implicit `all` over web/ios/android) and use target ids rather than the
  selector written in the file. If `current` cannot be resolved, all checks for that target are skipped.
- **Importing the package still loads the whole CLI** (`src/index.ts` imports `./cli` and the
  registries) but no longer runs it: the bootstrap guard is only `require.main === module` (0.7.4 also
  fired when `process.argv[1]` contained `"index"`, e.g. a host `index.js` or a checkout path with
  "index"). A host that bundles opentp into its own entry bundle would still run it (the bundle is
  then the main module). Do not reintroduce argv matching.
- **The Bun binaries rely on `undefined === undefined`.** In an ES module Bun leaves `module` and
  `require.main` undefined, so the guard is true for the compiled `src/cli.ts`; a guard such as
  `typeof module !== "undefined" && ...` makes every binary a silent no-op (exit 0, no output). Tested
  2026-10-02 with Bun 1.3.5; a Bun upgrade that changes this is caught by the release smoke step
  (`count=4`), not by CI, which never compiles a binary.
- **Generator limitations.** Generators get raw, unresolved payloads, with events in unsorted readdir
  order (which differs between node and bun). The template engine cannot nest `#each` or `#if`, and its
  header comment documents a `{{@key}}` that is not implemented. `--output` resolves against root, while
  `--file` resolves against cwd.
- **Unknown checks are always errors.** opentp-spec's own `examples/extensions` therefore fails with
  `Unknown check: mytool.not-empty`.
- **Webhook rule:** any 2xx counts as valid (`docs/rules.md` documents a `{ "valid": false }` contract
  that the code ignores). `${ENV}` in url/headers is interpolated, so untrusted plan changes can
  exfiltrate CI secrets.
- **`saveYaml` uses a runtime `require("yaml")`**, which works only in the CJS bundle or under bun (not
  in plain ESM). `tsc` does not catch this.
- **CI smoke checks match output text** (in `ci.yml` and in the binary smoke step of `release.yml`,
  which also requires exit code exactly 1 for `coverage-invalid` and `check throwing-check failed:`
  with `--external-rules`). `ci.yml` requires `count=4` at the end of a line for
  `coverage-valid`, a non-zero `count=` for the spec examples, and `Validation failed` for
  `coverage-invalid` (combined stdout + stderr), exit 2 for `valdiate`, a parseable stdout for
  `validate --json -v`, and identical bytes for `generate json` to stdout and to `-o`. Changing those
  messages, the fixture event count, the output streams or the exit codes means updating `ci.yml` and
  `release.yml` in the same change.
- **Pushing a `v*` tag publishes the GitHub Release at once** (the installers serve it as latest
  immediately). A tag that contains `-` (`v1.0.0-rc.1`) becomes a GitHub pre-release (never "latest",
  so only `OPENTP_VERSION=1.0.0-rc.1` installs it). A `+build` suffix alone is not treated as a
  pre-release.
- **Installer "latest" window:** `softprops/action-gh-release` uploads assets one by one after creating
  the release, so "latest" points at the new release before its files are there. An install in that
  window fails (404 on the binary, or a missing `SHA256SUMS`, which is fatal for versions after
  0.7.4); it never installs unverified, and it never mixes the files of two releases (the tag is
  resolved once).
- **Distribution state (as of 2026-10-02).** The latest release is `v0.8.0` (tag = `01c27ce`): four
  binaries plus `SHA256SUMS`, each binary smoke-tested on its own runner. The installers install the
  latest release and verify it (they used to pin 0.7.3); releases up to `v0.7.4` have no `SHA256SUMS`
  and install with a warning. The npm package `opentp` (`0.0.1`, `0.5.0`; spec 2025-06, cannot read
  2026-01 plans) is obsolete and will not be updated (Rule 9); README and `docs/getting-started.md`
  say so once and tell users to `npm uninstall -g opentp`. opentp.dev serves `/install` and
  `/install.ps1` (302 to `raw.githubusercontent.com/.../main/install/...`) and the per-version schema
  URLs, and its CLI docs are re-synced from `v0.8.0` (website `6d5a517`).

- **`install.ps1` has never been run** (no PowerShell in this environment). It mirrors `install.sh`
  line by line, but PowerShell specifics (native `curl.exe` output capture, `throw` under
  `irm | iex`, `[Version]` comparison) are unverified.

## Definition of done

- [ ] `npm run lint` is clean.
- [ ] `npm test` passes. New behaviour has unit tests and/or a fixture case whose errors are listed in
      the exhaustive `COVERAGE_INVALID_ERRORS`, and `coverage-valid` still has zero errors.
- [ ] `npm run typecheck` passes with 0 errors (`tsconfig.json` and `tsconfig.test.json`); specs and
      mocks were updated after any signature or type change.
- [ ] `npm run build` succeeds and the smoke tests pass: `coverage-valid` exits 0 with `count=4` (or
      the new count, also in `ci.yml`), and `coverage-invalid` exits 1.
- [ ] If the CLI surface changed, `printHelp`, `README.md` and `docs/<command>.md` are updated.
      Frontmatter is intact, and no new cross-page link 404s after the website sync.
- [ ] If spec semantics changed, they are consistent with `opentp-spec` (schemas and
      `docs/semantics.md`), and the spec examples `simple` and `full` still validate.
- [ ] For a release, `package.json`/`package-lock.json` version and the tag agree (`release.yml`
      enforces it), the artifact names are unchanged, and all five assets (four binaries and
      `SHA256SUMS`) return 200.
- [ ] User-visible changes are listed under `## [Unreleased]` in `CHANGELOG.md`.
- [ ] This `AGENTS.md` is updated if layout, commands, conventions or known issues changed.
- [ ] The commit message is in English and uses a conventional prefix.

## Related repositories (optional local-workspace context)

In a local workspace they sit next to this repo (`../opentp-spec`, `../opentp-website`).
- **`opentrackplan/opentp-spec`**: format source of truth (schemas, `docs/semantics.md`,
  `docs/schema/*.md`, examples); its check is `bun scripts/validate.ts`.
- **`opentrackplan/opentp-website`** (private): opentp.dev; syncs `docs/` from here and owns the
  `/install` and `/schemas/*` redirects.
- **`opentrackplan/opentp-sdk`**: TypeScript runtime SDK `@opentp/sdk` 0.1.0 (GA4, Snowplow, Amplitude
  adapters). Its README expects a typed tracker "generated by opentp-cli"; **no such generator exists
  yet**. It would belong in `src/generators/`, built on `resolveEventPayload`.
