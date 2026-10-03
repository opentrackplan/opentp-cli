# opentp-cli — Agent Guide

This repo is the reference implementation of the OpenTrackPlan standard. It is a CLI that loads a
tracking plan (`opentp.yaml`, dictionaries and event YAML files) plus its own settings file
(`opentp.cli.yaml`), validates the plan, rewrites event keys, exports the plan through generators,
upgrades old plans (`opentp migrate`) and serves the plan to AI agents (`opentp mcp`).

- **Command:** `opentp`, repo `github.com/opentrackplan/opentp-cli`, license Apache-2.0.
- **Distribution: binaries only** (owner decision, 2026-10-02, final). The CLI ships as the four Bun
  binaries + `SHA256SUMS` on GitHub Releases and through the install scripts. It is **not published to
  npm, now or later**; `package.json` is `"private": true` and the old npm package `opentp` (0.5.0) is
  obsolete. npm is only a development tool here. A Bun-only toolchain is a possible future direction,
  not decided.
- **Version:** `package.json` `version` (**0.10.0**, not released yet; the latest release is 0.9.1).
  Release and installer state: see "Distribution state" under Known issues.
- **Spec support:** **exactly `2026-09`** (`package.json` `specVersion`, read by `src/meta.ts`). A
  `2026-01` plan gets the migrate guidance (exit 2); any other `opentp:` value is a hard error.
  `opentp migrate` upgrades `2026-01` plans; 0.9.1 is the last release that reads `2026-01`.
- **Spec ownership:** the format (JSON Schemas, semantics, examples) is owned by
  `opentrackplan/opentp-spec`. This repo does **not** load those schemas at runtime. Every check is
  hand-written TypeScript. CLI settings (`opentp.cli.yaml`) are owned here; their JSON Schema is
  generated from `src/cliconfig/schema.ts` into `schemas/opentp.cli.schema.json`.

## Rules

1. **English only.** This applies to code, comments, docs, commit messages and test names.
2. **Update code, docs and fixtures together.** CLI behaviour, `--help` (`printHelp` in `src/cli.ts`),
   `README.md`, `docs/*.md`, `tests/data/*`, `schemas/opentp.cli.schema.json` (`npm run schema`) and
   the CI smoke greps must agree in the same change. Record user-visible changes under
   `## [Unreleased]` in `CHANGELOG.md` (breaking ones under "Breaking changes"); the release notes
   are built from it.
3. **Spec semantics come from opentp-spec** (`docs/semantics.md`, `docs/schema/*.md`). Do not invent new
   semantics here. If the spec is unclear, change the spec repo as well. Tool settings (keygen,
   check bindings, tracker binding, plugins, generator runs, MCP) belong in `opentp.cli.yaml`, never
   in the plan: they may add strictness or produce artifacts, never change which hits belong to an
   event or which values are valid.
4. **Never move, delete or re-push a published `v*` tag.** Pushing a tag publishes the release binaries
   and `SHA256SUMS` (the installers pick them up as "latest" at once, unless the tag has a pre-release
   suffix). If a release is broken, ship a new patch version.
5. **Never hand-edit generated content.** `dist/` and `releases/` are gitignored build output,
   `schemas/opentp.cli.schema.json` is generated (`npm run schema`), `build/` is a gitignored,
   hand-written local-only `Dockerfile` (no workflow uses it), and the website copies of `docs/` live
   in `opentp-website` and are overwritten by its sync script.
6. **Run every command from `opentp-cli/`.** `esbuild/esbuild.js`, `scripts/generate-cli-schema.ts`
   and the fixture specs use cwd-relative paths (elsewhere: `Could not resolve "src/index.ts"`,
   failing fixture tests).
7. **Publish only when the user asks** (pushing tags, GitHub releases).
8. **Do not "fix" deliberate behaviour by accident.** Several traps listed below are pinned by fixtures,
   for example ignore widening and the exact `migrate` output.
9. **Never add npm distribution.** No npm publish job or `prepublishOnly` script, no removal of
   `"private": true`, no `npm install -g opentp` / `npx opentp` instructions, no npm badge. Users
   install the binaries (installers or GitHub Releases); docs show `opentp ...` commands, and
   "from source" means `npm ci && npm run build && node dist/index.cjs`. npm as a dev tool (`npm ci`,
   `npm test`, `npm run ...`, `package-lock.json`) stays.
10. **Plugins and webhooks are a trust boundary.** Never load plugins named in `opentp.cli.yaml`
    without `--allow-plugins` / `OPENTP_ALLOW_PLUGINS=1`, never let the plan (or a draft) define a
    webhook, never read `OPENTP_WEBHOOK_ENV` (or anything that widens it) from a file, and never run
    anything from a plan repository in an application repository (its plugins and its webhook
    bindings).

## Quick facts

| Item | Value |
|---|---|
| Language | TypeScript (strict). Source is ESM (`"type": "module"`) |
| Node bundle | esbuild `src/index.ts` -> `dist/index.cjs` (CJS, target node18, `#!/usr/bin/env node`). Used for development, CI smoke tests and `npm link`; never published. `main` and `bin.opentp` both point to it (`files` is kept, but `private: true` blocks `npm publish`). No `exports`, no `types`, no `.d.ts`. The esbuild target only sets the syntax level; it is deliberately left below `engines` |
| Binaries | `bun build src/cli.ts --compile --no-compile-autoload-bunfig --no-compile-autoload-dotenv` (the entry is `cli.ts`, not `index.ts`; the two flags are mandatory, see Known issues). The only distributed artifact |
| Runtime deps | `yaml` ^2.8.4, `@modelcontextprotocol/server` ^2.3.0 (MCP SDK v2), `zod` ^4 (MCP input schemas and the `opentp.cli.yaml` shape), `semver` ^7.8 (the `cli` range); all bundled. Application repositories also use the system `git` (never bundled) |
| Dev tooling | vitest 4.0.16, Biome 2.3.11, esbuild 0.25.x, TypeScript 5.9.x, `bun` ^1.4.2 as an npm devDependency (same version as `bun-version` in both workflows; also runs `npm run schema`), `@modelcontextprotocol/client` (MCP tests only) |
| Node | `engines`: `^20.19.0 \|\| >=22.12.0` (what vite 7 / vitest 4 need; Node 18 is EOL). It describes only the development toolchain (build from source, tests); users run the binaries, which embed the Bun runtime and need no Node.js. Documented in README and getting-started ("From source") and CONTRIBUTING. CI tests Node 20 and 22 |
| TypeScript configs | `tsconfig.json`: `src/` without specs (`resolveJsonModule` for `src/meta.ts`). `tsconfig.test.json` extends it and adds `*.spec.ts`. Both must have 0 errors |
| CI (`ci.yml`) | Push/PR to main, Node 20 + 22 matrix; also called by `release.yml` (`workflow_call`). `npm ci`, lint, `tsc` (both configs), test, build, smoke tests (fixtures; overlap; application repository; migrate; MCP + noisy plugins; opentp-spec `examples/{simple,full,extensions}` at the tag that equals `specVersion`); the Node 22 job also compiles a linux-x64 binary with Bun 1.4.2 and smoke-tests it |
| Release (`release.yml`) | On `v*` tags: tag = `package.json` version check, CI as `verify`, four bun binaries (each smoke-tested on its own runner, migrate and application mode included), `SHA256SUMS`, GitHub Release (notes from `CHANGELOG.md`; `-` in the tag = pre-release). Nothing goes to npm. See Release process |

## Commands

Run everything from `opentp-cli/`. All results below were verified on 2026-10-03.

```bash
npm ci                          # install (same as CI)
npm test                        # vitest run -> 54 files / 905 tests pass
npx vitest run src/core/fixtures.spec.ts                 # integration fixtures only (11 tests)
npx vitest run src/cli.spec.ts                           # argv parsing, exit codes, stdout/stderr split, generate/fix refusals (in-process main)
npx vitest run src/cliconfig                             # opentp.cli.yaml, tracker, application repositories, git plans (256 tests)
npx vitest run src/migrate                               # opentp migrate (fixture byte comparison, resume, refusals)
npx vitest run src/core/overlap.spec.ts                  # overlap rule, incl. a generated 1,000-event plan against a naive reference and 3,000/5,000-event plans with millions of pairs (~10 s)
npx vitest run src/external-plugins.spec.ts              # loadExternal{Rules,Transforms,Generators} with temp dirs
npx vitest run src/rules src/transforms src/generators   # plugin unit tests only
npm run lint                    # biome check src/ -> "Checked 139 files ... No fixes applied."
npm run lint:fix                # biome check --write src/ (also sorts imports)
npm run format                  # biome format --write src/
npm run typecheck               # tsc --noEmit -p . && tsc --noEmit -p tsconfig.test.json -> 0 errors (CI runs both)
npm run build                   # node ./esbuild/esbuild.js -> dist/index.cjs (gitignored)
npm run schema                  # bun scripts/generate-cli-schema.ts -> schemas/opentp.cli.schema.json (a test fails when stale)
npm run compile:mac             # bun --compile -> releases/opentp-mac (also :mac-intel, :linux, :win)
npm run compile                 # all four into releases/ (gitignored, local only)
```

Smoke tests. `dist/` is not committed and can be stale, so run `npm run build` first. CI runs these
(on the combined stdout + stderr) after the build; `release.yml` runs a similar set against every
compiled binary (see Release process):

```bash
node dist/index.cjs --version   # "opentp v0.10.0 (spec 2026-09)" + "Schemas: https://opentp.dev/schemas/2026-09"
node dist/index.cjs validate --root tests/data/coverage-valid     # stderr "✓ All events are valid count=4", empty stdout, exit 0
node dist/index.cjs validate --root tests/data/coverage-invalid   # report on stdout, "✗ Validation failed errorCount=88 warningCount=61 eventCount=36" on stderr, exit 1
node dist/index.cjs valdiate                                      # "✗ Unknown command 'valdiate'" + usage on stderr, exit 2
node dist/index.cjs validate --json -v --root tests/data/coverage-invalid 2>/dev/null   # stdout = one JSON document
# same errors as fixtures.spec.ts (otherwise check_throws.yaml reports an unknownCheck warning for throwing-check):
node dist/index.cjs validate --root tests/data/coverage-invalid --external-rules tests/data/coverage-invalid/external-rules   # errorCount=89 warningCount=60
node dist/index.cjs generate json --root tests/data/coverage-invalid   # refuses: load errors on stderr, empty stdout, exit 1
node dist/index.cjs generate json --root tests/data/coverage-valid
node dist/index.cjs validate --root tests/data/overlap               # 4 overlap warnings, "✓ All events are valid warnings=4 count=12", exit 0
node dist/index.cjs validate --root tests/data/overlap --fail-on overlap   # "errorCount=4 warningCount=0 eventCount=12", exit 1
node dist/index.cjs validate --root tests/data/application          # application repository (plan: ../tracker): "count=2", exit 0
node dist/index.cjs validate --root tests/data/migrate-2026-01      # the 2026-01 guidance, exit 2
cp -R tests/data/migrate-2026-01 /tmp/m && node dist/index.cjs migrate --root /tmp/m && diff -r tests/data/migrate-2026-01.expected /tmp/m
node dist/index.cjs validate --root /tmp/m                          # "✓ All events are valid warnings=1 count=3"; a second migrate: "Nothing to migrate"
# opentp mcp over stdio: raw JSON-RPC (no dependencies), 9 tools, 3 calls, exit 0 on stdin EOF; the
# noisy plugins print to stdout at import, and the smoke fails on any non-JSON-RPC stdout line
node tests/mcp-smoke.mjs node dist/index.cjs mcp --root tests/data/coverage-valid \
  --external-transforms tests/data/mcp-noisy-plugins/transforms --external-rules tests/data/mcp-noisy-plugins/rules
./releases/opentp-mac validate --root tests/data/coverage-valid   # after compile:mac
```

(Use a scratch directory instead of `/tmp/m` and delete it afterwards.)

The smoke steps of `ci.yml` and the binary smoke step of `release.yml` can be replayed locally:
extract each step's `run` script (e.g. with `node -e` and the `yaml` package) and run it with bash
from a scratch directory that has symlinks to `dist`, `tests`, `src`, `package.json` and
`node_modules` (plus `opentp-spec` -> `../opentp-spec` for the spec examples step), with
`RUNNER_TEMP=<scratch dir>` and, for `release.yml`, `BIN=./<binary>`. The binary steps need a binary
for the local platform (`npx bun build src/cli.ts --compile ... --target=bun-darwin-arm64`). Verified
2026-10-03. The `diff -r --strip-trailing-cr` of the release migrate smoke was also checked against a
CRLF copy of both fixture directories (what a Windows checkout has).

Truncation check (macOS pipes are asynchronous; the fixtures are too small to show it): build a plan
with a few thousand events in a scratch dir, then `node dist/index.cjs generate json --root <plan> | wc -c`
must equal the size of the `-o` file (verified 2026-10-02 with 0.8.0: 3000 events, 1809643 bytes both
ways; 0.7.4 printed 65536).

Cross-repo check (local workspace with `../opentp-spec`). `validate` is read-only, so no copy is
needed; copy first only when running `fix` or `migrate`. CI runs the examples from a checkout of
`opentrackplan/opentp-spec` at the tag equal to `package.json` `specVersion`, not from the spec's
`main`:

```bash
for e in simple full extensions; do node dist/index.cjs validate --root ../opentp-spec/examples/$e; done
# simple: count=1, full: count=5 (both exit 0, no warnings); extensions: exit 0, "warnings=2 count=1"
# (the unknownCheck warnings of mytool.not-empty and mytool.starts-with)
```

## Repository layout

```
src/
  index.ts           esbuild entry. `import "./cli"` (side effect!) + re-exports VERSION, SPEC_VERSION,
                     SPEC_SCHEMAS_URL, createTransform(s), getStep, getStepNames, transform types
  cli.ts             Whole CLI: EXIT_OK/EXIT_FAILURE/EXIT_USAGE, CliOptions, UsageError, OPTIONS +
                     GLOBAL_OPTIONS + COMMAND_OPTIONS, parseCliArgs (node:util parseArgs), printHelp,
                     printVersion, loadProject (opentp.yaml first, then opentp.cli.yaml; application
                     mode), loadPlugins (--external-* + gated opentp.cli.yaml plugins), checkBindings,
                     runValidate (also fix), runGenerate (name or generate.run), runMcp, main (returns the
                     exit code; migrate goes to migrate/command.ts), bootstrap guard (`require.main ===
                     module`; sets process.exitCode, EPIPE handler). Bun binaries compile THIS file
  cli.spec.ts        parseCliArgs cases and in-process main() runs (exit codes, stdout vs stderr, --json,
                     generate refusing a broken plan, fix rewriting nothing on config issues)
  external-plugins.spec.ts  loadExternal{Rules,Transforms,Generators}: ESM/CJS, relative/absolute, missing dir
  meta.ts            VERSION / SPEC_VERSION from package.json; SPEC_SCHEMAS_URL
  checks/
    index.ts         CheckEnvironment (resolves a check id: spec.checks > checks.bindings > rules;
                     classify = the unknownCheck / reserved `webhook` / portable-params problems of a
                     written `checks` entry; run; withoutWebhooks for drafts; shadowWarnings),
                     getBindingProblems (exit-2 binding collisions), TOOL_RULES (overlap,
                     unknownCheck), Severity, DEFAULT_SEVERITIES (warning), CHECK_ID_PATTERN
    webhook.ts       callWebhook (a webhook binding: request body { field, value, params, context },
                     2xx = valid), getWebhookEnvAllowlist (OPENTP_WEBHOOK_ENV; unset = none), cache
  cliconfig/
    schema.ts        zod shape of opentp.cli.yaml (opentp, cli, plan, keygen, checks, tracker, generate,
                     mcp, x-*; NOT_SUPPORTED_YET_KEYS serve/search); MCP_TOOL_GROUPS; TRACKER_TYPES
    index.ts         findCliConfigFile (--cli-config or <root>/opentp.cli.y{a,}ml), readCliConfig
                     (zod issues -> lines), checkCliConfig (opentp header, cli range, plan:),
                     loadCliConfig, CliConfigError (exit 2), getSeverities (--fail-on >
                     checks.severity > warning), buildCheckEnvironment, cliPluginDirectories,
                     pluginsAllowed (--allow-plugins / OPENTP_ALLOW_PLUGINS=1), mcpToolGroups,
                     findApplicationFile / declaresPlan (application mode detection)
    json-schema.ts   buildCliConfigJsonSchema / renderCliConfigJsonSchema (zod -> draft-07,
                     $id https://opentp.dev/schemas/cli/opentp.cli.schema.json)
    tracker.ts       the tracker binding: resolveTracker (problems + per-target binding),
                     getTrackerProblems, resolveTrackerBinding, mergeTrackerSections (application mode),
                     path grammar per tracker type, globs, Iglu URIs
    application.ts   application repository mode: openApplication (the file, plan: located/cloned),
                     completeApplication (headers, the plan repository's opentp.cli.yaml, merge),
                     mergeApplicationConfig, keygenIgnoredWarning, planPluginsWarning
    plan-source.ts   plan: values: parsePlanSource (path / git+ssh|https|file URL#ref), cacheRoot
                     (OPENTP_CACHE_DIR / XDG / macOS / Windows), planCacheDir, fetchGitPlan (spawnSync
                     git only in a fresh os.tmpdir() dir, GIT_CEILING_DIRECTORIES, -c
                     safe.bareRepository=explicit, no shell, GIT_TERMINAL_PROMPT=0, 120 s, fetch by
                     object id from the URL (no remote), HEAD verified), moveIntoCache (rename, EXDEV
                     copy + rename, lost race), gitEnvironment, redactCredentials, planLabel
    paths.ts         containedPathProblem: generate.run output/file stay inside the directory of
                     opentp.cli.yaml (no absolute path, no .git segment, realpath of the deepest
                     existing entry inside the directory)
    run.ts           getRunEntryProblems: one generate.run entry (generator, containment, template
                     file, target/events filters) as generate.run[i].<key> lines
  core/
    index.ts         barrel (config, dict, event, validator); unused; does not export payload.ts
    config.ts        findConfigFile, loadConfig (throws; version check first: previousVersionMessage /
                     pinnedPreviousVersionMessage for 2026-01), validateConfig -> ConfigIssue[] (never
                     throws; also unique non-empty targets.all ids, the check-id pattern of every
                     `checks` key, enum + dict on taxonomy/fragments/pii settings), getKeygenProblems (opentp.cli.yaml keygen, paths keygen.*),
                     fileVersionMessage (+ the migrate hint), resolvePath, getEventsPath, getDictsPath,
                     getEventsTemplate, rootToolFiles (opentp(.cli).y{a,}ml never read as plan files)
    constraints.ts   code-point lengths, compilePattern (u flag), the seven `format` checks,
                     string/number constraint messages, portableCheckProblems
    document.ts      one walk per raw document: YAML merge keys (`<<`, anywhere), removed keywords
                     (x-opentp, valueRequired), non-mapping
                     field definitions, value/enum/dict together, invalid field regexes, empty enums,
                     `policy` in events, every `checks` entry and `dict` reference (reported once where
                     written, with the payload field key they belong to); knows which maps are keyed by
                     user names (in events also the payload selectors, version keys and aliases)
    dict.ts          loadDictionaries -> { dictionaries: Map, issues }, getDictValues (.yaml wins over .yml)
    event.ts         loadEvents -> { events, issues: EventLoadIssue[] }; createEventLoadContext +
                     loadEventDocument (one parsed document as if it were a file at a path: used by
                     loadEvents and the MCP draft tools; runs walkEventDocument) (+ private
                     prepareKeygen, extractTaxonomy, extractFragments, generateEventKey, parseTypedValue)
    fix.ts           setEventKey: `opentp fix` replaces only the text of the event.key scalar (located
                     with parseDocument, re-parsed and compared; else a skip reason)
    payload.ts       the 2026-09 merge: resolveEventPayload (selectors, versions, aliases, $ref;
                     options.dictionaryValues for refMerge), refMerge/refMergeField ($ref, 0.9.1
                     override semantics; an inherited example the narrowing (dict values from the
                     lookup) no longer allows is dropped), layerMerge (the merge
                     table: type, value/enum/dict narrowing, items, required, policy, checks/pii by key,
                     x-*, stale examples), baseLayers/mergeBaseLayers/BaseFieldCache (catalog ->
                     spec.targets.all -> spec.targets.<T>, declaring layer of a policy), effectiveFields,
                     resolveEffectivePayload (with `layers`), UNVERSIONED_VERSION_KEY ("__unversioned__")
    fields.ts        valueProblems/exampleProblems/piiProblems, analyzeBaseLayers (opentp.yaml-only
                     problems), presenceReason, isDeprecatedVersion, codeName, naturalCompare,
                     suggestNames/didYouMean/unknownFieldMessage (closed vocabulary)
    validator.ts     ValidationSettings ({ keygen, tracker, checks, severities, keyChecks }),
                     validateEvents (config-level problems once, base values, duplicate keys, per event,
                     overlap), validateEvent, validateTaxonomy, validatePayload, payloadFieldOf (2026-09
                     ignore grammar), ignoresOverlap, errorsOnly/warningsOnly, configIssuesToErrors,
                     cliConfigIssuesToErrors, loadIssuesToErrors, formatErrors/errorLines,
                     formatWarnings/warningLines (one block per file, 20-line overlap cap)
    overlap.ts       the overlap rule: version predicates, intersects/isWithin/compareVersions,
                     OverlapIndex (.pairs() streams every pair one participant at a time, .all() =
                     summarizeOverlaps(pairs), .pairsWith(draft)/.with(draft) for MCP), findOverlaps,
                     overlapResults, overlapMessage/overlapSummaryMessage, overlapIgnores
    select.ts        generate.run filters: getEventFilterProblems, filterEvents (target from the
                     selectors: resolveEventPayload().covered; taxonomy values)
    fixtures.spec.ts integration over tests/data/coverage-* (exhaustive coverage-invalid lists)
    semantics.spec.ts  field rules through main(["validate", "--json"]) on small temp plans ($ref
                     examples, payload names, typed keywords, merge keys, pii/item checks, ...)
    *.spec.ts        config, constraints, dict, event, fields, fix, overlap, payload, select, validator
  types/index.ts     all spec + CLI types (OpenTPConfig, Field, FieldPolicy, TaxonomyField, EventFile,
                     ResolvedEvent (with keygenError), ValidationError (+ optional rule), payload types)
  util/
    files.ts         scanDirectory (recursive, UNSORTED readdir order), filterByExtension, loadYaml
                     (parseYaml, YAML 1.2 core, unique keys), isYamlMapping, formatLoadError (one-line
                     YAML errors with line/col), fileExists
    yaml.ts          parseYaml (= yaml.parse plus the source key order of mappings that JavaScript
                     reorders: integer-like keys, and the paths of plain `<<` keys),
                     keysInSourceOrder (payload version order), mergeKeyPaths
    output.ts        printLines (stdout in chunks of 1,000 lines), jsonLines (JSON.stringify(doc, null,
                     2) produced element by element); used by validate for large reports
    logger.ts        tiny logger; every level -> stderr (console.error); OPENTP_LOG_LEVEL
    objects.ts       setOwn/getOwn: maps keyed by plan names (a `__proto__` key stays an own key)
    pattern.ts       parsePattern, getMatchTemplateProblems, patternToRegex (vars .+?), templateToRegex
                     (vars = one path segment; a .yaml/.yml ending matches both), applyPattern (keygen)
  transforms/        types.ts, registry.ts, factory.ts (getStepProblem, createStepFn/createTransform(s): throw on
                     unknown or malformed steps), index.ts (registers built-ins), index.spec.ts;
                     12 step folders (index.ts + transform.spec.ts): collapse keep lower replace
                     to-camel-case to-kebab to-snake-case to-underscore transliterate trim truncate upper
  rules/             built-in checks (historical name). types.ts, registry.ts (runRule, loadExternalRules),
                     validation.ts, index.ts, index.spec.ts; 7 folders (index.ts + rule.spec.ts):
                     contains ends-with max-length min-length not-empty pattern starts-with
  generators/        types.ts (GeneratorContext with effective/cliConfig/tracker), registry.ts, index.ts,
                     context.ts (generatorContext: frozen cliConfig, effective resolver), effective.ts
                     (createEffectiveResolver: per target/version effective fields), export.ts
                     (buildExportData: opentp, info, catalog, targets, checks, events + effectivePayload,
                     sorted dictionaries), json/ yaml/ template/ (index.ts + generator.spec.ts)
  migrate/           opentp migrate: index.ts (migrate(): scan, plan, edit in memory, verify, write in
                     order), command.ts (output, --json, exit codes), scan.ts, analysis.ts (catalog, types,
                     slot families, valueRequired -> policy, webhook ids), config.ts (opentp.yaml
                     splices), events.ts + definitions.ts (event/dictionary text edits), cli-config.ts
                     (create/merge opentp.cli.yaml), text.ts (range-based splicing), verify.ts (the
                     `manual` list: validate a migrated temp copy), report.ts; migrate.spec.ts,
                     command.spec.ts
  mcp/               `opentp mcp` (see "MCP server"): plan.ts (PlanStore, PlanSnapshot, PlanError),
                     search.ts (TrigramIndex, eventDocument), tools.ts (the 9 tools as plain functions,
                     ToolError), server.ts (buildMcpServer with tool groups, serveMcpStdio,
                     reserveStdoutForProtocol) + search/tools/server specs
scripts/generate-cli-schema.ts   writes schemas/opentp.cli.schema.json (npm run schema; Bun)
schemas/opentp.cli.schema.json   generated JSON Schema of opentp.cli.yaml, served through
                     opentp.dev/schemas/cli/* (website redirect to this repo's release tag on jsDelivr)
tests/mcp-smoke.mjs  dependency-free stdio smoke test for `opentp mcp` (CI and the release binary smoke;
                     tied to coverage-valid's keys)
tests/data/coverage-valid/    plan + opentp.cli.yaml that must produce zero errors and zero warnings (4 events)
tests/data/coverage-invalid/  intentional errors (39 matching event files, 36 load; external-rules/
                              throwing-check is an ESM check that throws)
tests/data/overlap/           12 events, no errors, exactly 4 overlap warnings (+ replacedBy and ignore cases)
tests/data/tracker/           a valid plan with a Snowplow tracker binding (2 events, keygen {area}::{event})
tests/data/application/       an application repository: only opentp.cli.yaml with plan: ../tracker
tests/data/migrate-2026-01/   a 2026-01 plan (3 events, a skeleton under templates/, a non-plan file
                              under notes/); migrate-2026-01.expected/ = its migrate output, byte for byte
tests/data/mcp-noisy-plugins/ a transform and a check that print to stdout at import (MCP smoke only)
docs/*.md            Starlight pages synced to opentp.dev: index, getting-started, config, validate, fix,
                     generate, migrate, mcp, transforms, rules
esbuild/esbuild.js   bundle script (cwd-relative paths, not linted)
install/install.sh, install/install.ps1    one-line installers (latest GitHub release by default,
                     OPENTP_VERSION pin, OPENTP_DOWNLOAD_BASE mirror, SHA256SUMS verification)
.github/workflows/ci.yml (also a reusable workflow), release.yml; .github/ISSUE_TEMPLATE/*.yaml
biome.json, tsconfig.json, tsconfig.test.json (adds *.spec.ts), vitest.config.ts, CONTRIBUTING.md, README.md,
CHANGELOG.md (Keep a Changelog; `## [Unreleased]` until a release, copied into the release notes)
```

Gitignored local artifacts: `dist/`, `releases/` (4 binaries), `build/Dockerfile` (no workflow uses
it), `.idea/`, `.DS_Store`.

## Architecture: the validate pipeline

`main` calls `parseCliArgs` (usage errors: exit 2), checks `OPENTP_LOG_LEVEL` and that every
`--external-*` directory exists, then calls `runValidate` (validate and fix), `runGenerate`, `runMcp`
or `runMigrateCommand`.

1. **Project** (`loadProject`). If `opentp.cli.yaml` (or `--cli-config`) declares `plan:`
   (`findApplicationFile`; without an `opentp.yaml` in the root it throws the file's find or read
   error as `CliConfigError`, exit 2, instead of letting `opentp.yaml not found` hide it; next to an
   `opentp.yaml` those errors wait for step 3), this is an application repository: `openApplication` reads the file,
   refuses an `opentp.yaml` in `--root`, and locates the plan (a local directory, or a git clone in
   the cache). `fix` refuses before any of this (`refusesApplicationRepository`).
2. **opentp.yaml** (`findConfigFile` + `loadConfig`, in the plan's directory). The version is checked
   first: `2026-01` throws the migrate guidance (`pinnedPreviousVersionMessage` in application
   mode), anything else that is not `2026-09` throws too. `opentp.yaml` next to `opentp.yml` throws.
   Then `info.title/version`, `spec.paths.events.root/template`, `spec.events.taxonomy` and
   `spec.events.payload.targets.all` are required (`spec.events.payload.schema`, the catalog, is
   optional). No JSON-Schema validation. A throw (or a missing `opentp.yaml`) means exit 2 (logged on
   stderr, no `--json` document). A leading `/` in config paths is root-relative.
3. **opentp.cli.yaml** (`loadCliConfig`, or `completeApplication` in application mode). Shape errors
   (zod), unknown keys, `opentp` that differs from the plan's, an invalid or unsatisfied `cli` range,
   `mcp.write: true` and an empty `mcp.tools` (both shape errors: `z.literal(false)` with a custom
   message, `.min(1)`), `plan:` next to `opentp.yaml`: `CliConfigError`, exit 2. In application mode
   the plan repository's own file is read too (its `opentp` and `cli` must fit; only `tracker`, its
   rule bindings and `checks.severity` are merged in, never its webhook bindings; `keygen` of the application file is dropped with a
   warning; key checks are turned off). `fix` without `keygen` exits 2 here.
4. **Plugins** (`loadPlugins`): `--external-transforms` and, when allowed, `keygen.plugins` (before
   events load: keygen steps are checked against the registry); `--external-rules` and
   `checks.plugins`; for generate, `--external-generators` and `generate.plugins`. Plugins named in
   `opentp.cli.yaml` without `--allow-plugins`/`OPENTP_ALLOW_PLUGINS=1`: one warning, not loaded. A
   load failure or a missing allowed directory exits 2. Then `checkBindings`
   (`getBindingProblems`: reserved `webhook`, ids that collide with rules or `spec.checks`, rule
   bindings to unknown rules unless check plugins were skipped): exit 2.
5. **Dictionaries** (if `spec.paths.dictionaries` is set): `loadDictionaries` scans recursively, skipping
   the root tool files; the key is the relative path without extension (`taxonomy/areas`). Issues
   (YAML errors, not a mapping, missing or mismatched `opentp` (with the migrate hint for
   `2026-01`), missing or non-array `dict.values`, duplicates, a `.yaml`/`.yml` pair, removed
   keywords) become errors with `event: "dictionaries/<file>"`.
6. **Event discovery** (`loadEvents` -> `{ events, issues }`): `.yaml`/`.yml` files under the events
   root (minus the root tool files) are matched with `templateToRegex(spec.paths.events.template)`.
   Each `{var}` is exactly one path segment; a template ending in `.yaml` or `.yml` matches both.
   Non-matching files are **skipped silently** (no `--strict` yet). A matching file that cannot be
   read or parsed (YAML errors as `Invalid YAML at line L, column C: <reason>` with path `""`;
   duplicate keys are YAML errors), is not a mapping, or has no `event` / `event.taxonomy` mapping is
   **not loaded** and becomes an `EventLoadIssue`. `loadEventDocument` runs `walkEventDocument` on
   every loaded file (removed keywords, `policy` in events, non-mapping field definitions, empty
   enums, value/enum/dict conflicts, regexes, `checks` entries, `dict` references), reported once per
   file at the written path.
7. **Taxonomy** (`extractTaxonomy`): only fields declared in `spec.events.taxonomy` are read. A path
   value **wins** over `event.taxonomy`. `parseTypedValue` coerces path strings to integer, number or
   boolean (the raw string is kept on failure). Composite fields (`template` + `fragments`) are split
   by `extractFragments` and merged **flat** into the taxonomy.
8. **Keygen** (`prepareKeygen`, only when `keygen` is set and `getKeygenProblems` is empty):
   `createTransforms(keygen.transforms)` builds the pipelines and `applyPattern` evaluates
   `{var | pipelineA | pipelineB}` into `expectedKey`. A per-event failure keeps the event with
   `expectedKey: null` and `keygenError` (`Cannot generate the expected key: <reason>` at `event.key`).
9. **Fix mode** sets `event.key = expectedKey` with `setEventKey` (`src/core/fix.ts`): it locates the
   key's scalar with `parseDocument`, replaces only that range of the text (same quoting style, else
   double quotes) and parses the result again, which must equal the original with only `event.key`
   changed; otherwise the file is skipped with a `⚠ Event key was not fixed` warning. Then it runs
   full validation. With any `validateConfig`, keygen or tracker problem it rewrites nothing (`Event
   keys were not fixed: ...`).
10. **Validation** (`validateEvents(events, config, dictionaries, settings)`), in this order:
    `validateConfig` issues and keygen/tracker problems (once, against `opentp.yaml` /
    `opentp.cli.yaml`); unknown `dict` references written in `opentp.yaml`; dictionary-dependent base
    problems (`analyzeBaseLayers` with a lookup); checks on values written in `opentp.yaml`
    (`checkBaseValues`); `spec.checks` shadow warnings; `unknownCheck` for `checks` entries in
    `opentp.yaml`; duplicate event keys; `validateEvent` per event (the event file's version, key
    checks unless `keyChecks: false`, `validateTaxonomy`, `validatePayload` per **target id x
    version**: closed vocabulary, the layer merge, presence, policy, values/enum/examples, names,
    checks, PII, the per-file walk results); then overlap (`findOverlaps`) unless
    `severities.overlap` is `off`.
11. **Output**: errors are `[...loadIssuesToErrors(dictIssues, eventIssues), ...validateEvents(...)]`
    split into `errorsOnly` / `warningsOnly`; the exit code is `errors.length === 0 ? 0 : 1`
    (warnings never count). `count=` / `eventCount=` count loaded events only.

Payload resolution and the merge (`src/core/payload.ts`; normative: `opentp-spec/docs/semantics.md`):
- A raw payload that is itself a version (`payload.schema`) or a versioned target (`payload.current`)
  becomes `{ all: raw }` ("implicit all"); otherwise every key is a selector (a group from
  `spec.events.payload.targets`, groups win, or a target id). Each target may be covered at most once;
  a selector that covers no target is an event error at `payload.<selector>`.
- Unversioned payloads are stored under `UNVERSIONED_VERSION_KEY`. Versioned ones are `current` plus
  version objects plus string aliases. `$ref: "<versionOrAlias>"` stays within the selector,
  `$ref: "<selector>::<versionOrAlias>"` crosses selectors. `refMerge`: the referencing version's
  keywords win; only a type change and `required: true` -> `false` are errors.
- Effective field = `layerMerge` folded over catalog -> `spec.targets.all` -> `spec.targets.<T>` ->
  the event layer. The field set of an event version is the common fields of the target plus the
  fields the version lists; a catalog field the event does not list is not part of it.
  `BaseFieldCache` memoizes the base layers per target (one per `validateEvents` call).
- Problems are tagged by kind: narrowing problems are ignorable with `payload::<f>`; type conflicts,
  changed or replaced fixed values and weakened `required` are not.
- An `example` is checked where it is written: `ResolvedPayloadVersion.ownSchema` holds what the
  version writes before `$ref`, and `refMergeField` drops an inherited example that a narrowing
  override no longer allows (a `dict`/`items.dict` only when the caller passes
  `resolveEventPayload(..., { dictionaryValues })`: validatePayload, the generators' `effective()`
  and `resolveEffectivePayload` do; overlap and `select.ts` do not need examples). Keywords that the effective type does not allow
  (`typedKeywordProblems` in `fields.ts`) are checked per base site in `analyzeBaseLayers` and, for
  events, on `ownSchema`, reported once per file at `ResolvedPayloadVersion.writtenPath` (the
  selector as written).

## CLI reference

Usage: `opentp [validate | fix | generate [<name>] | mcp | migrate | help | version] [options]`.
Arguments are parsed by `parseCliArgs` (`node:util` `parseArgs` with `strict: true`,
`allowPositionals`, `tokens`; Node and Bun behave the same). The first positional is the command
(default `validate`); options may appear anywhere. Anything unexpected is a `UsageError`:
`✗ <message>` plus a two-line usage on stderr, exit 2.

| Command | Behaviour |
|---|---|
| `validate` (default) | Pipeline above |
| `fix` (or `validate --fix`/`-f`) | Needs `keygen` in `opentp.cli.yaml` (else exit 2); refuses in an application repository (exit 2). Rewrites keys (none while opentp.yaml, keygen or tracker problems exist), then validates; the exit code comes from validation |
| `generate <name>` | `<name>` is the second positional, wherever it appears (`generate -o x.json json` works). Built-ins: `json`, `yaml`, `template`; an unknown name exits 2. Does **not** validate events or load check plugins, but **refuses (exit 1)** when the plan cannot be loaded completely: any `validateConfig` issue, keygen or tracker problem, dictionary issue or event load issue. The problems go to stderr, stdout stays empty, nothing is written. Generator `stdout` is written verbatim (`process.stdout.write`), so piped output equals the `-o` file. Events are sorted by `relativePath` before any generator runs |
| `generate` (no name) | Runs `generate.run` entries of `opentp.cli.yaml` (outputs and `file` relative to that file and inside its directory). Every entry is checked before any runs (`getRunEntryProblems`: generator, containment, template `file`, `target`/`events`); any problem: exit 2. No entries: exit 2. `-o`, `--file`, `--pretty` without a name: usage error |
| `migrate` | `src/migrate` (see "migrate"). Options `--check`, `--dry-run`, `--json`, `-v`, `--cli-config`. Exit 0 (migrated, nothing to do, dry run), 1 (`--check` found work, or nothing could be written), 2 (no opentp.yaml, both .yaml/.yml, version not 2026-01/2026-09, `plan:` present, an existing opentp.cli.yaml with the wrong shape) |
| `mcp` | Serves the plan over MCP on stdin/stdout until stdin closes (exit 0). See "MCP server" |
| `help`, `--help`, `-h` | Prints help on stdout, exit 0. The `help` command takes no arguments (`help validate` exits 2). `-h`/`--help` win over the command, its options and its arguments (checked after unknown commands and options) |
| `version`, `--version`, `-V` | Prints version and schemas URL on stdout, exit 0. `-v` is verbose, not version |

| Flag | Commands | Notes |
|---|---|---|
| `--root <p>`, `-r <p>` | all | Project root. Default: `$OPENTP_ROOT`, otherwise cwd |
| `--cli-config <p>` | all (`GLOBAL_OPTIONS`) | opentp.cli.yaml to use, relative to cwd; must exist (exit 2). Default: `<root>/opentp.cli.y{a,}ml` |
| `--verbose`, `-v` | all | Debug logs (stderr) |
| `--json` | validate, fix, migrate | validate/fix: `{ success, events, errors, warnings }` (entries `{ event, path, message, severity, rule? }`); migrate: `{ changed, created, warnings, manual, summary[, errors] }`. stdout holds only the document; no document on exit 2 |
| `--fix`, `-f` | validate, fix | Same as the `fix` command |
| `--fail-on <id>[,<id>]` | validate, fix, mcp | Repeatable; ids `overlap`, `unknownCheck` (others: usage error). Wins over `checks.severity` |
| `--allow-plugins` | validate, fix, generate, mcp | Load the plugins named in opentp.cli.yaml (also `OPENTP_ALLOW_PLUGINS=1`) |
| `--external-rules <dir>` | validate, fix, mcp | Repeatable; always loaded |
| `--external-transforms <dir>` | validate, fix, generate, mcp | Repeatable; loaded before the plan |
| `--external-generators <dir>` | generate | Repeatable |
| `--output <p>`, `-o <p>` | generate (with a name) | Output file, resolved **relative to `--root`**. Default: stdout |
| `--file <p>` | generate (with a name) | Template file, resolved **relative to cwd** |
| `--pretty` / `--no-pretty` | generate (with a name) | json generator only. Default pretty; the last one wins |
| `--check`, `--dry-run` | migrate | Write nothing; `--check` exits 1 when a file would change |

- Every value flag also takes `--flag=value`. An empty value, a missing value or a value that starts
  with `-` (`--root --json`: "ambiguous") is a usage error; use `--root=-dir` for such paths.
- A flag that the command does not accept (per `COMMAND_OPTIONS`) is a usage error, e.g. `validate -o x`
  or `generate json --json`. `help`/`version` accept every known flag.
- `--external-*` directories are resolved against cwd and must exist (`✗ --external-rules: directory
  not found: <abs path>`, exit 2).
- **Env vars:** `OPENTP_ROOT` (default root); `OPENTP_LOG_LEVEL` = `trace|debug|info|warn|error|fatal`
  (exact lowercase; default `info`; any other value exits 2, except for `help`/`version`);
  `OPENTP_ALLOW_PLUGINS` (exactly `1`); `OPENTP_WEBHOOK_ENV` (variable names for webhook `${VAR}`,
  commas or spaces; unset/empty = none); `OPENTP_CACHE_DIR` (git plan cache). git variables such as
  `GIT_SSH_COMMAND` pass through to the plan clone; repository variables (`GIT_DIR`, ...) are removed.
- **Exit codes** (`EXIT_OK`, `EXIT_FAILURE`, `EXIT_USAGE` in `cli.ts`; documented in `docs/index.md`,
  `printHelp`, README):
  - `0`: success, help, version. Warnings never change it.
  - `1`: validation errors (including config, keygen and tracker problems, load issues, tool rules
    raised to `error`), generate refusing an incompletely loaded plan, a throwing generator
    (`Generator failed`), an unexpected crash (`✗✗ Fatal error`), `migrate --check` with work left or
    a migration that cannot be written.
  - `2`: usage errors, and configuration errors that stop a run before it starts: `opentp.yaml` not
    found or `loadConfig` throws (incl. the 2026-01 guidance), `opentp.cli.yaml` unusable
    (`CliConfigError`), binding collisions, a missing allowed plugin directory, a failed plugin load,
    an unknown generator or a bad `generate.run` entry, `plan:` that cannot be found or fetched,
    `fix` without keygen, `fix`/`migrate` in an application repository.
- **Exit and streams:** `main()` returns the code and the bootstrap sets `process.exitCode` on the
  **global** `process`. The bootstrap runs only when `require.main === module`: true for the CJS
  bundle run as the entry point and, because Bun leaves both undefined in an ES module, for
  `bun src/cli.ts` and the compiled binaries; false under vitest and for `require("opentp")`.
  Nothing calls `process.exit`, except the bootstrap's `process.stdout` `EPIPE` handler.
- **`ValidationError`:** `{ event, path, message, severity: "error" | "warning", rule? }`. `rule` is
  set for tool rules (`overlap`, `unknownCheck`). `event` is a **display label, not a file path**:
  - event errors: path relative to the events root;
  - `"opentp.yaml"` (config issues) is literal even when the file is `opentp.yml`;
  - `"opentp.cli.yaml"` (keygen and tracker problems) is literal whatever the file is called;
  - `"dictionaries/<file>"` has a literal prefix whatever `spec.paths.dictionaries.root` is.
- **Positions:** only YAML syntax errors carry a line and column, inside the message; such
  file-level errors have `path: ""`.
- **Human output:** errors as `[<event>]` blocks with `  ✗ <path>: <message>` lines on stdout
  (`errorLines`), then warnings (`warningLines`: one block per file, its non-overlap warnings then
  its overlap warnings; files with only overlap warnings last; at most 20 overlap warnings, from
  the events with the most attached overlap warnings first (a summary weighs its `<n>`), then `… N more
  overlap warnings (--json lists all; set checks.severity.overlap in opentp.cli.yaml)`), then the
  summary on stderr. The report and the `--json` document (`jsonLines`) are printed in chunks
  (`printLines`), never built as one string:
  `✓ All events are valid count=N`, `✓ All events are valid warnings=W count=N`, or
  `✗ Validation failed errorCount=E warningCount=W eventCount=N`. `count=` is always the last field
  of a success line (CI greps `count=N$`). Every logger line goes to stderr; stdout carries only the
  report, the `--json` document, help/version, generator output, migrated file names, or MCP.

## opentp.cli.yaml

Docs: `docs/config.md` (every section, the keygen template grammar, plugin gating, application
repositories, error classes). Implementation notes:

- **Shape** (`src/cliconfig/schema.ts`, zod v4): top-level `opentp` (required), `cli`, `plan`,
  `keygen`, `checks`, `tracker`, `generate`, `mcp`, `x-*`; every section is a strict object. Unknown
  top-level keys get `Unknown key '<k>' (extensions start with 'x-')`, `serve`/`search` get
  `'<k>' is not supported yet`. `readCliConfig` turns zod issues into lines (`issueLines`: for a
  union it reports the branch the input was meant for). After any change: `npm run schema`, and the
  `docs/config.md` tables.
- **Error classes** (keep them apart): shape and header problems throw `CliConfigError` (exit 2,
  printed line by line before anything loads); keygen and tracker problems are `ConfigIssue`s that
  become validation errors with `event: "opentp.cli.yaml"` (validate exit 1, fix rewrites nothing,
  generate refuses), or `event: ConfigIssue.file` when set: in application mode a tracker problem
  at a key that only the plan repository's file has gets `opentp.cli.yaml of the plan '<plan>'`
  (`TrackerOrigin` in `ApplicationMode.trackerOrigin`, passed to `resolveTracker`/
  `getTrackerProblems` by validate, generate and `PlanStore`); warnings (plugins not allowed,
  keygen ignored in application mode, plan repository plugins) are logger lines.
- **Severity** (`getSeverities`): defaults `warning` for `overlap` and `unknownCheck`;
  `checks.severity` overrides; `--fail-on` wins (error).
- **Tracker** (`tracker.ts`): types snowplow/ga4/amplitude/segment/generic with their path grammar,
  containers and unmapped defaults; resolution order (exact in `targets.T.map`, exact in `map`, globs
  in `targets.T.map`, globs in `map`, default); problems are grouped across targets. Paths written
  in a map follow the segment grammar; an appended field name (container entry or unmapped default)
  is one segment of any text, so each field binding has `segments` (`path` is the display string)
  and collisions are compared by segments. Globs match with prefix/suffix/`indexOf`, never a regex
  (no backtracking). The zod shape accepts `event`/`contexts` for every type; on a non-snowplow
  type they are `ConfigIssue`s. The resolved binding is `GeneratorContext.tracker`, template data
  `tracker`, MCP `describe_plan.tracker`.
- **Application mode** (`application.ts`, `plan-source.ts`): a value is a git URL iff it starts with
  `git+ssh://`, `git+https://` or `git+file://` and has `#<ref>` (other `git+` forms and URL-like
  values without `git+` exit 2 with a hint); refs are tags (`git ls-remote --tags <url>
  refs/tags/<ref> refs/tags/<ref>^{}`: without the second pattern ls-remote omits the peeled line)
  or 40-hex SHAs (lowercased). Both are fetched by object id with `init` + `fetch --depth 1 <url>
  <id>` (no `remote add`: the URL, maybe with a token, never reaches `.git/config`) + `checkout
  FETCH_HEAD`; then `rev-parse HEAD` must equal `rev-parse <id>^{commit}` (a SHA pin may name an
  annotated tag object, as `git rev-parse <tag>` prints it) and FETCH_HEAD is deleted. For a tag the
  id of the `refs/tags/<ref>` line is fetched (the tag object of an annotated tag: protocol-v0
  servers send only advertised ids, and the peeled commit is not one) and HEAD must also equal the
  `^{}` id (else the same id). Never `clone --branch`: it prefers a branch with the tag's name.
  git never starts repository discovery in a directory someone else controls (the cache root can be
  inside a PR checkout via `OPENTP_CACHE_DIR`, and a committed bare-repo layout there would run its
  `core.sshCommand`): each fetch makes `mkdtemp(os.tmpdir()/opentp-plan-)` (0700), runs
  `ls-remote` with `cwd` = that dir and `GIT_CEILING_DIRECTORIES` = its parent, creates the clone in
  `<it>/plan` and names it with `-C` in every later command; `GIT_SAFETY_OPTIONS` (`-c
  safe.bareRepository=explicit`) precede every git command. Never the user's cwd either (Windows
  looks up `git.exe` in the cwd). `redactCredentials` hides URL userinfo
  (`scheme://***@`) and scp-like passwords in every message, log line and git stderr line;
  `ApplicationMode.plan` / `OpenedApplication.plan` hold the redacted value (display only), and
  `describe_plan.pinnedPlan` shows it. Cache dir `<root>/plans/<first 16 hex of
  sha256("<url>#<ref>")>` (URL without `git+`), never refreshed; `moveIntoCache` renames the clone
  into place, or on `EXDEV` (tmp on another file system) copies it to `<dir>.tmp-<pid>-<random>`
  and renames that (a lost race uses the winner). Tested with real `git+file://` repositories in
  temp dirs (git 2.23 and 2.50), including a branch named like a tag, a SHA pin of an annotated tag
  object, and a bare-repository layout planted at `OPENTP_CACHE_DIR` and at the cwd whose
  `core.sshCommand` must never run.

## MCP server (`opentp mcp`)

Released in 0.9.0; stdio only. An HTTP mode (`opentp serve` with `/mcp` and a web UI) is the planned
next step ("phase 2" below); `serve` is a reserved key in `opentp.cli.yaml`.

- **SDK:** `@modelcontextprotocol/server` v2 (`McpServer`, `ResourceTemplate`, `serveStdio` from the
  `/stdio` subpath). It serves MCP revision 2026-07-28 and 2025-era clients (`initialize` handshake)
  on the same connection type. Tool input schemas are `zod/v4` objects. Bundled by esbuild and by
  `bun --compile`.
- **Read-only by design:** no tool writes a file (owner decision 2026-10-03). Agents write event files
  themselves; `suggest_event` and `validate_event_draft` tell them where and whether it is right. Every
  tool has `readOnlyHint: true`. `mcp.write: true` in `opentp.cli.yaml` exits 2 (reserved; the JSON
  Schema has `const: false`). Do not add
  write tools without the owner. MCP `generate` returns text and never writes (also with `run`).
- **Start** (`runMcp`): application mode is opened first (a git plan is fetched now); no `opentp.yaml`
  at all exits 2; a plan that exists but cannot be loaded (the 2026-01 guidance, any `loadConfig`
  error) does **not** stop the server: `PlanStore` reports it from every tool. `opentp.cli.yaml`
  problems exit 2 (its `opentp` is compared with the plan only when the plan loads). Plugins
  (`keygen.plugins`, `checks.plugins` when allowed, `--external-*`) and the `mcp` section are read
  once; `mcp.tools` selects the registered groups (`describe`, `search`, `validate`, `generate`;
  at least one), and `mcpInstructions(groups)` builds the server instructions from them, naming
  only registered tools. Tool descriptions (`search_events` -> `get_event`, the `path` of
  `validate_event_draft` -> `suggest_event`) and `describePlan(plan, groups).howTo` name another
  tool only when its group is served (tests check every subset).
- **PlanStore** (`plan.ts`): loads the plan like `runValidate` into a `PlanSnapshot`. Each
  `current()` compares mtime and size of `opentp.yaml`, `opentp.cli.yaml` (both candidates or
  `--cli-config`) and every file under the events and dictionaries roots with the last load and
  reloads on any change (in application mode: the plan's directory, and a new `plan:` ref is fetched
  on the next request). The snapshot caches the search index, the full validation, the tracker
  binding and an `OverlapIndex` for drafts. Events are sorted by relative path; `byKey` keeps the
  first event for a duplicate key. `PlanError` becomes an error result of every tool.
- **Tools** (`tools.ts`) are plain functions over a snapshot, unit-tested without MCP. `ToolError` (an
  unknown key, target, version, dictionary or run entry, an absolute path or one with `..`, an
  unusable path template) becomes an error result; any other exception is logged and returned as
  `Internal error: ...`.
  - `describe_plan`: `catalog`, `commonFields` (per target, merged, with `policy`), `targetSettings`,
    `checks`, `key.keygen`, `tracker`, `pinnedPlan` (application mode); `baseSchema`/`targetSchemas`
    are gone (0.10.0).
  - `get_event`: the 2026-09 effective fields per target group and version, with `layers`.
  - `suggest_event`: key from `keygen`; skeleton with every policy field (`value: <...>` fixed,
    `enum: ["<...>"]` restricted, `value: ["<...>"]` for both on an array field, `{}` specified,
    the base value when `opentp.yaml` fixes it); one implicit payload when all targets agree, else
    one per target. Its tool description and the `describe_plan` policy note say that a restricted
    field takes enum values (or a dict) or a value, and an array field only a value.
  - `validate_event_draft`: `loadEventDocument` + `validateDrafts` (a `CheckEnvironment` without
    webhooks: drafts never call a webhook binding; skipped ids are listed in `note`) + a duplicate-key
    check + overlap via the cached `OverlapIndex.with(draft)` (severity and the draft's `ignore`
    apply; the event at the same path is left out). Warnings carry `rule`.
  - `validate_plan`: errors and warnings (separate limits); with `files`, per-file status (`loaded`,
    `load-error`, `not-loaded`, `not-found`) and `filesValid`.
  - `generate`: `generator` (json|yaml) and/or `run` (a `generate.run` index: its generator,
    `target`, `events`, `file`; output not written; `getRunEntryProblems` without the output and
    generator checks, so the `file` is contained and an error names `generate.run[i].file`; must
    agree with `generator`); `keys` must lie
    inside the entry's selection; plugin generators are not loaded; a generator that returns only
    `files` is refused; refuses an incompletely loaded plan.
  - The validating tools (`validate_event_draft`, `validate_plan`, `suggest_event`) have
    `openWorldHint: true`: plan-level webhook bindings run for files on disk and values in
    `opentp.yaml`.
  - **Limits:** one response is at most `MAX_RESPONSE_BYTES` (256 KB of UTF-8 text). `generate`
    sends the export once, as the text; its structured content is metadata only.
- **Search** (`search.ts`): BM25 (k1 1.2, b 0.75) over character trigrams of words, NFKD + combining
  marks removed + lowercase; no stemming, no locale. The event document is the key, taxonomy values
  and the names/titles/descriptions/fixed values/enums (up to 10 values) of the payload fields the
  event defines (not the file path).
- **stdout is the protocol.** `runMcp` calls `reserveStdoutForProtocol()` after the config checks
  and before plugins are imported: every console method is rebound to a `Console` on stderr and
  `process.stdout.write` goes to stderr; the SDK transport gets a private `Writable` over the real
  stdout. The redirect is global and permanent, so it runs only in `mcp`.
- **Exit:** the server returns from `main` (exit 0) when stdin ends or closes.
- **Tests:** `src/mcp/{search,tools,server}.spec.ts` (the server spec uses the SDK client over
  `InMemoryTransport`), `cli.spec.ts`, `src/cliconfig/application.spec.ts` (PlanStore reload in
  application mode), and `tests/mcp-smoke.mjs` for the bundle (CI) and every binary (`release.yml`).
- **Before HTTP (`opentp serve`, phase 2), still open:** a draft's own `pattern` runs on the main
  thread, so a catastrophic-backtracking regex blocks every client (run draft validation in a worker
  with a timeout, or skip draft-defined patterns); `scanDirectory` follows symlinks, so a link under
  the events root can expose files outside the plan; `opentp mcp` finds the plan only through
  `--root`, `$OPENTP_ROOT` or the cwd (owner decision 2026-10-03: keep this for now; MCP roots are
  the candidate if that is not enough).

## Plugin systems (transforms, rules, generators) and checks

All three plugin systems share one design:
- **Registry:** a module-level `Map` in `<system>/registry.ts`, filled by the **import side effect** of
  `<system>/index.ts`. `cli.ts` imports `./transforms` and `./generators`; rules arrive via
  `src/checks` / `core/validator.ts`.
- **Interfaces:** `src/{transforms,rules,generators}/types.ts`. `RuleContext.specField` is never set.
  `GeneratorContext` = `config`, `events` (sorted by path), `dictionaries`, `options` (`output`,
  `file`, `pretty`), `effective(event)`, `cliConfig` (deep-frozen copy or null), `tracker`.
- **Naming:** a plugin registers under `definition.name`, not its folder name. `Map.set` means **a
  same-named plugin silently replaces the built-in**.
- **Sources and gating:** `--external-{rules,transforms,generators} <dir>` (cwd-relative, always
  loaded) and `checks.plugins` / `keygen.plugins` / `generate.plugins` in `opentp.cli.yaml`
  (relative to that file, loaded only with `--allow-plugins` or `OPENTP_ALLOW_PLUGINS=1`; else
  `pluginsNotLoadedWarning`). Each first-level `<dir>/<anyName>/index.js` is loaded with
  `await import(pathToFileURL(...).href)`; the plugin is `module.default || module[<folderName>]`
  and must have `factory` / `validate` / `generate`. ESM or CJS follows the nearest `package.json`
  `type`; TS-style `exports.default = ...` in CJS is skipped silently. A module that fails to import
  is logged and skipped. Plugins of a plan repository never load in an application repository.
- **Transforms** (keygen only): a step is a string or a single-key object `{ stepName: params }`.
  `getStepProblem(step)` reports unknown steps (`Unknown transform step '<name>' (custom steps:
  keygen.plugins in opentp.cli.yaml, or --external-transforms)`) and malformed ones;
  `getKeygenProblems` turns them into `keygen.transforms.<pipeline>[<i>]` issues; `createStepFn`
  throws them. Bad **params** of a known step are not checked.
  - Existing case steps are **ASCII-oriented**: `to-snake-case`, `to-kebab`, `to-underscore` and
    `collapse` drop or split on every char outside `[A-Za-z0-9]` (`"Вход"` -> `""`); `to-camel-case`
    lowercases first (`loginButton` -> `loginbutton`). New steps should use Unicode classes
    (`/[^\p{L}\p{N}]+/u`) or document ASCII-only behaviour in `docs/transforms.md`.
  - Do not copy the `@example { step: 'x' }` JSDoc from existing steps; that syntax is obsolete.
- **Checks** (`src/checks/index.ts`, `CheckEnvironment`): an id resolves to `spec.checks` (portable,
  params `true`/`false`, wins over a rule with a warning) > `checks.bindings` (a rule binding:
  `true` = binding params, other params replace them; a webhook binding: `callWebhook`) > a
  built-in or plugin rule. `webhook` is reserved (error in the plan, in `spec.checks` and as a
  binding id). Params `false` disable. Unknown ids: `classify` reports `unknownCheck` (severity from
  `checks.severity`/`--fail-on`) once per file from the document walk; at run time they are skipped.
  A rule binding to a rule that is not loaded counts as unknown (its own message,
  `unloadedRuleMessage`, names the plugin gating). Portable checks run wherever
  constraints apply (values, enum members, examples, taxonomy, PII); every other check only on fixed
  values (arrays per item), taxonomy values and PII values (`checkBaseValues` runs the pii-setting
  checks on PII values written in `opentp.yaml`; array examples also get the portable checks of
  `items`). A rule that throws, rejects or returns a
  non-object gives `check <name> failed: <message>` (`CHECK_FAILED`) and the run continues.
- **Webhooks** (`src/checks/webhook.ts`): `url` and `headers` interpolate `${VAR}` only for names in
  `OPENTP_WEBHOOK_ENV` (any other: `WEBHOOK_ENV_NOT_ALLOWED`, no request); body `{ field, value,
  params, context: { eventKey, fieldPath } }` (no body for GET); 2xx = valid, else the response's
  `error`/`message` or `Webhook returned <status>`; `retries` only after network errors/timeouts;
  `cache` TTL per url+field+value+params. Timers are cleared in `finally` (the CLI waits for the
  event loop to drain).
- **Generators**: json/yaml export `buildExportData` (`opentp, info, catalog, targets, checks,
  events: [{ key, taxonomy, lifecycle, payload, effectivePayload }], dictionaries` sorted by name; YAML
  with `aliasDuplicateObjects: false`). `template` is a mustache subset (`{{a.b}}`, `{{#each}}`,
  `{{#if}}`, `{{@index}}`) over the export data plus `tracker` and `config`. The CLI prints `stdout`
  and writes `files[]` (relative paths against `--root`, directories created).

## Ignore mechanism

`buildIgnoreList` (validator.ts) turns `event.ignore: [{ path, reason? }]` into literal paths plus
payload fields (the 2026-09 grammar, `payloadFieldOf`):
- `key` and `event.key` are equivalent (skip the missing, constraint and keygen key checks).
- `opentp` skips the event spec-version check; `taxonomy.<field>` / `taxonomy.<fragment>` skip that field.
- `payload::<f>`, any `payload.….schema.<f>[…]` (the segment after the first `.schema.`) and
  `payload.<f>[.<keyword>]` silence the field-level checks of `<f>` on **every target and version**
  (values, enum members, examples, policy, names, checks, event dictionaries, narrowing). Pinned by
  `coverage-valid/events/auth/2/false/ignored_application_id_dict.yaml`
  (`payload.all.1.0.0.schema.application_id.value` and `payload.device_model`).
- `overlap` / `overlap.<key>` silence overlap warnings (either event of the pair may carry them).
- **Never ignorable:** load issues, duplicate YAML keys and event keys, YAML merge keys (`<<`),
  payload resolution issues, unknown fields (closed vocabulary), `policy`/`x-opentp`/`valueRequired`
  in an event, `required: false` contradictions, null field definitions, type conflicts, keywords
  the effective type does not allow (`typedKeywordProblems`), changed or replaced fixed values,
  weakened `required`, everything in `opentp.yaml` and `opentp.cli.yaml`.
- Unknown check ids and unknown dictionaries in an event are matched against the ignore list by the
  field key the document walk recorded (`CheckRef.field`, `DictRef.field`), so `payload::a.b` works.
- `reason` is optional, stale entries are not reported, and `fix` ignores the list entirely.

## Overlap (`src/core/overlap.ts`)

Normative: opentp-spec `docs/semantics.md` ("Event predicate and overlap"); user docs:
`docs/validate.md` "Overlapping events". Version predicates come from the shared merge
(`resolveEventPayload`, `effectiveFields`, `BaseFieldCache`, `presenceReason`); there is no second
merge. Comparison is pairwise per target with an index on each predicate's most selective
constrained field (candidates always include predicates that leave that field free). One warning per
event pair at path `payload`, rule `overlap`; `contains` goes to the broader event (the first
target, then the first versions in **file order** decide: `ResolvedTargetPayload.versionOrder`,
recorded by `parseYaml` because object key order puts integer-like keys such as `"2"`/`"1"` first),
other kinds to the event whose path sorts first. Pairs linked by `lifecycle.replacedBy` or
`aliases[].key` are skipped. Severity `off` skips the computation.

**Bounded output:** pairs grow quadratically (an event without its identity field contains every
event), so `OverlapIndex.pairs()` produces them one participant at a time (only that participant's
pair states in memory) and `summarizeOverlaps` keeps, per attached event, counters plus at most 21
overlaps. An event with more than 20 (`OVERLAP_PAIR_LIMIT`) attached pairs gets one summary result
instead (only the pairs attached to it count: in 22 identical events only the first by path gets one):
`Overlaps with <n> other events on <targets> (<a> identical, <b> contained in this event, <c>
containing this event, <d> partial); for example '<k>' (<path>), ...` (zero counts left out, the
first three other events by path; `containing` only for drafts). Results come in the path order of
the attached event. The equality test against the naive reference compares `pairs()` (before
summaries). Timings (2026-10-03, `--json`): a 3,000-event plan with distinct events 0.35 s;
3,000 events without identity (4,498,500 pairs, 3,189 results) 2.5 s and 250 MB; 5,000 events with
10% identity-less (2,374,750 pairs, 500 summaries) 2.0 s and 300 MB (before: `RangeError: Invalid
string length` at 4 GB). Add large result lists with a loop, never `push(...results)`.

## migrate (`src/migrate/`)

User docs: `docs/migrate.md`. Contract points that the code and the fixture pin:
- Files: `opentp.yaml` and every `*.yaml`/`*.yml` under the plan root (and the events/dictionaries
  roots, even outside it) with `opentp: 2026-01` and an `event` or `dict` key; dot-directories,
  `node_modules` and the root tool files are skipped; other `2026-01` files are listed as warnings.
  Each file is migrated by its own header (resume works).
- **Symlinks** (`scan.ts`): the events and dictionaries roots are walked first, through their
  configured paths (links followed, like validate), and every directory is walked once by its real
  path, so files keep their configured-path names. Links to YAML files inside those roots are read
  through the link (validate's `scanDirectory` reads them too); a file reached by two paths is listed
  once (inside a root first, then its own path; the other link is a warning), and `verify.ts` finds
  its migrated text by real path. Other links (files outside the roots, directories) are not
  followed (warnings). A directory of the events or dictionaries root that cannot be read, or a
  missing events root, stops the run; any other unreadable directory is a warning
  (`skippedDirectories`). `writeAtomically` writes the realpath, so a symlinked
  `opentp.yaml`/`opentp.cli.yaml` keeps its link. YAML files that cannot be loaded and are not plan
  files are skipped with a warning.
- **Text edits, not trees:** nodes are located with `parseDocument` ranges and only changed parts
  are spliced (`text.ts`); comments, quoting, key order, anchors, CRLF and file modes stay. The new
  catalog and moved nodes are rendered with the Document API (`toString({ lineWidth: 0 })`).
- All edits are computed in memory, every migrated text is parsed and loaded again (`parseYaml` runs
  `toJS`, so an unresolved alias is an error), and the `manual` list comes from validating a migrated
  temp copy (`verify.ts`: no webhooks, no key comparison, no overlap). Nothing is written when a text
  does not load (an alias whose anchor moved after it or was removed is named with both places,
  `aliases.ts`), when the migrated `opentp.yaml` or the shape of `opentp.cli.yaml` does not load in
  verify (`fatal`), or on any error while edits are computed (`MigrationError` with file and path;
  `EditError` and unexpected errors are converted, never a stack trace). Writes: temp file + rename;
  event and dictionary files, then `opentp.cli.yaml`, then `opentp.yaml`.
- **Aliases:** `WebhookIds.collect` and `x-opentp` edits resolve aliases (an aliased webhook config
  shares its anchor's id and is rewritten too; `x-opentp: *a` gets `checks` rendered from the
  resolved mapping); configs and keygen that use aliases are rendered from data into
  `opentp.cli.yaml`. An anchor on `spec.events.payload.schema` or an alias in its place stops the run.
  Plain `<<` keys in migrated files are listed under `manual` (`MERGE_KEY_MESSAGE`).
- Decisions (`analysis.ts`): catalog = fields events use that are not common on every covered target
  (type from typed `spec.targets` definitions, else the majority of event-declared types, else values,
  enum members, the dictionary, else `string` with a warning); slot families `<prefix>_<n>` are
  completed only with at least two used members covering at least half the numbers up to the highest;
  `valueRequired: true` -> `policy: fixed` when the field is required or every non-deprecated event
  version (skeletons outside the events root excluded) pins a value, else dropped with a warning;
  webhook ids `webhook-<n>` in first-seen order (files by path, then document order), identical
  configurations share an id (compared after `normalizeWebhook`: a GET/POST/PUT method in another
  case upper-cased, keys that are not binding settings dropped with a warning at their source; a
  normalized block mapping is copied with text edits, anything else from its data). A configuration
  that `webhookShapeProblems` (the binding's zod schema) still rejects stops the run with one error
  per problem at every source (file and path), never at the generated id in opentp.cli.yaml.
- `opentp.cli.yaml` is created only when keygen or webhook bindings move (modeline, `opentp: 2026-09`,
  `cli: ">=0.10 <0.11"`, LF line endings); an existing file is shape-checked first (`readCliConfig`;
  a shape error is exit 2) and merged (equal section = no-op, a different keygen = error, nothing
  written). Flow-style mappings that need an insertion stop the run (exit 1, `rewrite <path> in
  block style and run opentp migrate again`).

## Tests and fixtures

- **Harness:** `runFixture(name, { externalRules?, mutateConfig?, mutateCli?, severities? })` in
  `fixtures.spec.ts` mirrors the CLI pipeline (`loadConfig` -> `loadCliConfig` -> rule plugins ->
  `loadDictionaries` -> `loadEvents` -> `validateEvents`, errors and warnings split like
  `runValidate`) but does **not** go through `cli.ts`. It reads `process.cwd()/tests/data/<name>`.
- **coverage-valid** (4 events, with `opentp.cli.yaml`: keygen and a rule binding): errors and
  warnings must be exactly `[]`. It exercises the catalog model with policies, type inheritance,
  `spec.checks`, a rule binding, a dropped example, item narrowing, `payload.<f>` ignores, a
  deprecated version, a date format, a `.yml` dictionary and an `x-acme-team` extension.
- **coverage-invalid** (39 matching event files, 36 load): the assertion is **exhaustive**. The sorted
  `[event, path, message]` tuples must equal `COVERAGE_INVALID_ERRORS` (89 entries) and the
  non-overlap warnings `COVERAGE_INVALID_WARNINGS` (3 entries). Overlap warnings (57 pairs from its
  minimal events, reported as 2 summaries: `policy_deprecated.yaml` contains 29 events,
  `policy_violations.yaml` 28) are left out of that comparison on purpose; overlap has its own
  fixture. The harness loads `coverage-invalid/external-rules` (`throwing-check`); the CLI needs
  `--external-rules tests/data/coverage-invalid/external-rules` to match (89 errors, 5 warnings;
  without it the event's check is an `unknownCheck` warning: 88 errors, 6 warnings). Its text output
  ends with the 2 overlap summaries (no "more" line).
- **Config-level cases** that would break a whole fixture are tested with `mutateConfig` /
  `mutateCli` on `coverage-valid` (exactly one `opentp.yaml` or `opentp.cli.yaml` error, no per-file
  errors) and in `config.spec.ts` / `cliconfig/index.spec.ts`. Per-event keygen failures are in
  `event.spec.ts` (temp directories under `os.tmpdir()`).
- **Path template (coverage-*):** `{area}/{priority_level}/{is_internal}/{event}.yaml`, with `area`
  (string, `dict: taxonomy/areas`), `priority_level` (integer, enum `[1,2,3]`), `is_internal` (boolean,
  enum `[true,false]`), `event` (file name). Deliberately bad dirs in invalid: `auth/1/maybe/`,
  `auth/5/false/`, `badarea/1/false/`.
- **The two coverage plans differ** (diff `opentp.yaml` and `opentp.cli.yaml` before copying an event
  across): different keygen templates and key patterns, different catalogs and `spec.targets`, and
  invalid-only cases (unknown dictionaries, unknown checks, a removed `valueRequired`, extra groups,
  an unknown `spec.targets` key, a broken dictionary).
- Every fixture file uses `opentp: 2026-09` except `tests/data/migrate-2026-01` (on purpose). Valid
  event keys must equal the keygen output.
- **overlap** (12 events): exactly 4 warnings (identical, identical with free fields, contains,
  overlaps on web only), a pair skipped through `replacedBy` and a pair silenced with `ignore`.
  `overlap.spec.ts` also runs a generated plan (1,000 events x 3 targets x 2 versions, 10% missing the
  identity field) against a naive reference, and writes two plans with millions of pairs (3,000
  events without identity; 5,000 events, 10% without) that it validates in-process with `--json`
  and `--fail-on overlap` (bounded results, about 10 s together).
- **tracker** + **application**: `tracker.spec.ts` (144 tests: grammar per type, globs, resolution,
  merge) and `tracker.cli.spec.ts` (in-process `main()` with a probe generator);
  `application.spec.ts` and `plan-source.spec.ts` create real `git+file://` repositories in temp
  dirs (tags, annotated tags, SHAs with `uploadpack.allowAnySHA1InWant`, a SHA pin of an annotated
  tag object, branch refused, cache reuse with git forbidden, rename race, cross-device move, git
  missing or timing out, no plan URL left in the clone's `.git`, a planted bare repository at the
  cache root and the cwd whose `core.sshCommand` must not run: the test `process.chdir`s, which
  vitest's default `forks` pool allows); tracker problems of the plan repository's file keep its
  label in validate, generate and MCP.
- **migrate-2026-01** (+ `.expected`): `migrate.spec.ts` compares byte for byte, runs twice, resumes
  from half-migrated copies, checks CRLF and files without a final newline, and validates the output
  (zero errors). Regenerate `.expected` only for an intended output change, and review the diff.
- Files that do not match the path template are skipped with no message, so a new fixture file must
  match the template. After adding one, confirm the loaded count with
  `node dist/index.cjs validate --root tests/data/<fixture>` (and update the counts in the specs,
  `ci.yml`, `release.yml` and this file).
- **`src/cli.spec.ts`** imports `./cli` (under vitest `require.main` is undefined, so the bootstrap
  does not fire; the first test asserts `process.exitCode` is still unset) and tests `parseCliArgs`
  and `main(args)` in-process, spying on `console.log`/`console.error`/`process.stdout.write`.
  Plans that need a changed `opentp.yaml` are copied from `coverage-valid` into a temp dir. The
  bundle (`dist/`) is only exercised by the CI smoke steps, and the binaries only by the binary smoke
  steps.
- **`*.spec.ts` are type-checked only by `tsconfig.test.json`** (`npm run typecheck`, CI).
  `RuleDefinition.validate` and `GeneratorDefinition.generate` return `T | Promise<T>`: specs `await`
  the result.

## Recipes

**Add a built-in transform step**
1. `src/transforms/<step-name>/index.ts`: `export const myStep: StepDefinition = { name: "<step-name>",
   factory: (params?) => (value) => ... }`. Return identity on bad params; escape user strings used in
   RegExp; mind the case-step note under Plugin systems.
2. `transform.spec.ts` next to it (`myStep.factory(params)(input)`).
3. Import + `registerStep` in `src/transforms/index.ts`; add the name to the `getStepNames` test in
   `src/transforms/index.spec.ts`. Imports must stay sorted (`npm run lint:fix`).
4. Step names are also listed in the README "Transforms" table, the `docs/transforms.md` "Built-in
   Steps" table and this file's layout block
   (`grep -rn to-camel-case . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=releases`).
5. `keygen` is a CLI setting: if the step takes params, the zod shape (`transformStep` in
   `src/cliconfig/schema.ts`) accepts any single-key mapping; no spec change is needed.

**Add a built-in check (rule)**
1. `src/rules/<rule-name>/index.ts` exporting a `RuleDefinition`: return
   `{ valid: false, error, code: "UPPER_SNAKE" }`, guard `typeof value` (`TYPE_MISMATCH`), **never throw**.
2. `rule.spec.ts` with `ctx = { fieldName: "test", fieldPath: "test", eventKey: "test" }`.
3. Register in `src/rules/index.ts` (sorted imports); add to the `getRuleNames` test in
   `src/rules/index.spec.ts`.
4. A new built-in name turns an existing `checks.bindings` id of that name into an exit-2 collision,
   and a `spec.checks` id of that name into a shadow warning: mention it in the CHANGELOG.
5. Update the `docs/rules.md` "Built-in checks" table and the README "Validation Checks" list;
   optionally exercise it in `coverage-valid`.

**Add a built-in generator**
1. `src/generators/<name>/index.ts` exporting a `GeneratorDefinition`: return `{ stdout }`, or
   `{ files: [...] }` when `options.output` is set (MCP `generate` refuses generators that return
   only files). Use `context.effective(event)` for payloads, not the raw `event.payload`. A throw
   becomes `Generator failed`, exit 1.
2. `generator.spec.ts` (copy `mockContext` from `json/generator.spec.ts`, which uses
   `createEffectiveResolver`, or build a context with `generatorContext` from `../context`).
3. Register in `src/generators/index.ts`; add to the "Generators:" list and examples in `printHelp`.
4. New options need an `OPTIONS` entry, a `COMMAND_OPTIONS.generate` entry, a `case` in
   `parseCliArgs`, and (if `generate.run` entries should set it) a key in `runEntrySchema` +
   `npm run schema`.
5. Update `docs/generate.md` and the README "CLI Commands" table. If MCP should offer it, extend the
   `generator` enum in `src/mcp/server.ts`.

**Add an MCP tool**
1. A plain function in `src/mcp/tools.ts` that takes a `PlanSnapshot` and returns a JSON-able object;
   throw `ToolError` for a bad request. Keep it read-only.
2. Register it in the right group function of `buildMcpServer` (`src/mcp/server.ts`:
   `registerDescribeTools`, ...) with a `zod/v4` input schema, a description an agent can act on, and
   `annotations: READ_ONLY` (or `VALIDATES` when it runs checks); mention it in `mcpInstructions`,
   other tools' descriptions and `describePlan`'s `howTo` only when its group is served. A new group needs
   `MCP_TOOL_GROUPS` in `src/cliconfig/schema.ts` + `npm run schema`.
3. Tests in `src/mcp/tools.spec.ts` (and `server.spec.ts`); add the name to `TOOLS` in
   `server.spec.ts` and `EXPECTED_TOOLS` in `tests/mcp-smoke.mjs`.
4. Document it in the tools and groups tables of `docs/mcp.md` and `docs/config.md` ("mcp"), the
   README tool list and `CHANGELOG.md`.

**Add a CLI flag:** `CliOptions` + an `OPTIONS` entry + the commands that accept it in
`COMMAND_OPTIONS` (or `GLOBAL_OPTIONS`) + a `case` in the `parseCliArgs` token loop + `parseCliArgs`
cases in `src/cli.spec.ts` + `printHelp` + `docs/<command>.md` + `docs/index.md` (global flags) +
README "Options". Unknown flags and flags a command does not accept exit 2, so the new flag is
unusable until it is in both tables.

**Add an opentp.cli.yaml key**
1. The zod shape in `src/cliconfig/schema.ts` (strict objects; `.describe()` texts end up in the JSON
   Schema), then `npm run schema` (the stale-schema test in `cliconfig/index.spec.ts` fails
   otherwise).
2. Decide the error class: shape/header problems -> `CliConfigError` (exit 2, checked in
   `checkCliConfig` or a dedicated check before events load); problems against the plan ->
   `ConfigIssue`s reported by `validateEvents` with `event: "opentp.cli.yaml"`, and `fix`/`generate`
   must refuse on them like on keygen and tracker problems.
3. Application mode: decide whether the plan repository's value is merged (`mergeApplicationConfig`)
   or ignored; plugin directories and webhook bindings must never come from the plan repository.
4. `docs/config.md` (top-level table, section, errors table), README "opentp.cli.yaml", CHANGELOG.

**Add or change a validation check**
1. Field rules live in `src/core/fields.ts` (values, examples, PII, base layers) and
   `validatePayload`/`validateTaxonomy` in `src/core/validator.ts`; merge rules in `layerMerge`
   (`payload.ts`). Respect the ignore guards (`ignore.paths`, `ignore.fields`) and the reporting
   units: a problem written in `opentp.yaml` is reported once there, a problem written in an event
   once per target and version at the event's path.
2. Add a negative case at `coverage-invalid/events/<area>/<1-3>/<true|false>/<name>.yaml` (key
   consistent with the *invalid* keygen) and its tuples to `COVERAGE_INVALID_ERRORS` (exhaustive). If
   it is valid usage, extend `coverage-valid` too (zero errors and zero warnings). A new event can
   add overlap warnings; they are excluded from the exhaustive comparison.
3. Payload shape changes go through `payload.ts` and `src/types/index.ts`, in sync with
   `opentp-spec/schemas/event.schema.json` and `docs/semantics.md`.

**Support a new field keyword from opentp-spec**
- Spec sources: `schemas/field.schema.json` (fields, `items`, catalogField, eventField) and the
  `opentp.schema.json` definitions (taxonomy fields, pii, key constraints, portable checks); prose in
  `docs/schema/*.md` and `docs/semantics.md`. Find the change with
  `git -C ../opentp-spec log -p -- schemas docs`.
- Types: `ArrayItems`, `Field`, `TaxonomyField`, `PiiReservedFieldConfig`, `PiiMetaFieldConfig`,
  `EventKeyConstraints`, `PortableCheck` (`src/types/index.ts`), plus the legacy `FieldDefinition` in
  `src/rules/types.ts`.
- Merge: add the keyword's rule to `layerMerge` (default: the later layer wins per keyword) and, if it
  matters between versions, `refMergeField`. Constraints go to `src/core/constraints.ts` (one place
  for every value check); keywords that the document walk must see go to `src/core/document.ts`.
- `opentp migrate` only knows 2026-01 -> 2026-09: a keyword added within 2026-09 needs no migrate
  change.
- A metadata-only keyword needs only types, fixture usage and docs. Unknown keywords are ignored
  silently (no JSON Schema validation), so a new keyword has no effect until it is coded.

**Report a load-time or configuration problem as an error**
1. **A problem in `opentp.yaml` alone** (no dictionaries needed): `validateConfig` in
   `src/core/config.ts` (or `analyzeBaseLayers` / the document walk) as a `ConfigIssue`; reported once
   against `opentp.yaml`, `fix` rewrites nothing and `generate` refuses. Make the per-event code skip
   what the problem makes unusable. Unit-test it in `config.spec.ts`.
2. **A config problem that needs dictionaries**: in `validateEvents` (like the `dict` references and
   the dictionary-dependent `analyzeBaseLayers` issues), with `event: "opentp.yaml"`.
3. **A problem in `opentp.cli.yaml`**: see "Add an opentp.cli.yaml key".
4. **A problem in one event file that prevents loading it**: an `EventLoadIssue` in
   `loadEventDocument` (`src/core/event.ts`); a problem that does not prevent loading belongs in the
   document walk or `validateEvent`, so the rest of the event is still validated.
5. **A problem in one dictionary file**: a `DictionaryIssue` in `loadDictionaries`.

**Bump the spec version** (a new `YYYY-MM`; the workspace guide has the cross-repo order)
1. Cut and push the spec tag first: CI checks out `opentrackplan/opentp-spec` at the tag named like
   `specVersion` and validates `examples/{simple,full,extensions}` (with the expected warnings).
2. `package.json` `specVersion`. `loadConfig` requires `opentp === SPEC_VERSION`; dictionaries and
   events are compared with `config.opentp`. Decide what happens to the previous version:
   `PREVIOUS_SPEC_VERSION` in `src/core/config.ts` drives the guidance messages and the migrate hint,
   and `opentp migrate` (`src/migrate`) upgrades exactly one version step; a new step needs new
   migrate rules and a new fixture pair.
3. `opentp:` in every file under `tests/data/` (not the migrate source fixture), the `opentp` of every
   `opentp.cli.yaml` fixture and the `cli` range migrate writes (`cliRange()` in
   `src/migrate/cli-config.ts`), the generator spec mocks, and the strings found by
   `git grep -n <old>` in README, `docs/*.md`, `printHelp`, the issue template and `CHANGELOG.md`.
4. Format changes in `src/types/index.ts`, `config.ts`, `payload.ts`, `fields.ts`, `validator.ts`.
5. Release notes: "Breaking changes" first, with the guidance for plans on the old version.

## Release process

1. Make sure `main` is green in CI (lint, both type-checks, tests on Node 20 and 22, build, smoke
   tests). The spec tag that equals `specVersion` must exist, or the spec examples step fails.
   `release.yml` runs the same workflow again as its `verify` job and runs every compiled binary before
   uploading it, so a tag cannot ship untested code.
2. `npm version X.Y.Z --no-git-tag-version` updates `package.json` and both `version` fields in
   `package-lock.json` without committing or tagging. While the version is `0.x`, a release with
   breaking changes bumps the minor version (owner decision 2026-10-02). In `CHANGELOG.md`, rename
   `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` (drop its "Planned as" line) and add a new empty
   `## [Unreleased]` above it. If the minor version changed, update the `cli` range that `opentp
   migrate` writes (`">=0.10 <0.11"`) and its fixture.
3. The installers need no change: they install the latest GitHub Release unless `OPENTP_VERSION` pins
   one. Do not reintroduce a hard-coded version.
4. Commit and tag `vX.Y.Z`. Only when asked (Rule 7), push `main` and the tag. The binaries print the
   `package.json` version.
5. On a `v*` tag push, `release.yml` runs these jobs:

   | Job | What it does |
   |---|---|
   | `check-version` | Fails unless the tag equals `v` + `package.json` `version` and `package-lock.json` has the same version |
   | `verify` | Calls `ci.yml` (`workflow_call`): the whole CI, both Node versions |
   | `build` (needs both) | Per runner: `npm ci --omit=dev`, then `bun build src/cli.ts --compile --no-compile-autoload-bunfig --no-compile-autoload-dotenv --target=bun-<target>` with Bun 1.4.2, then "Smoke test the binary" (bash, also on Windows): `--version`; `coverage-valid` exit 0 + `count=4$`; `coverage-invalid` exit 1 + `Validation failed errorCount=`; `overlap` `warnings=4 count=12$`; `application` `count=2$`; `migrate` of the 2026-01 fixture equals `.expected` (`diff -r --strip-trailing-cr`: Windows checkouts have CRLF, the created `opentp.cli.yaml` has LF), validates (`warnings=1 count=3$`), second run `Nothing to migrate`; `valdiate` exit 2; `--external-rules` loads `throwing-check`; piped `generate json` = `-o` file; `tests/mcp-smoke.mjs`; `bunfig.toml`/`.env` in the cwd ignored. A failure uploads nothing |
   | `release` | `sha256sum` of the four binaries -> `SHA256SUMS`; the `## [X.Y.Z]` section of `CHANGELOG.md` + generated notes; GitHub Release with the five files (`fail_on_unmatched_files`), `prerelease` when the tag contains `-` |

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

7. **The `opentp.cli.yaml` schema URL.** `https://opentp.dev/schemas/cli/opentp.cli.schema.json`
   (the `$id` in `schemas/opentp.cli.schema.json` and the modeline `opentp migrate` writes) is a 302 in
   `opentp-website/public/_redirects` to
   `https://cdn.jsdelivr.net/gh/opentrackplan/opentp-cli@vX.Y.Z/schemas/:splat` (plus a bare
   `/schemas/cli` rule). After every release that changes `schemas/opentp.cli.schema.json`, bump that
   tag in the website (its AGENTS.md recipe "Bump the CLI schema rule after a CLI release") and
   check `curl -sI https://opentp.dev/schemas/cli/opentp.cli.schema.json` after the deploy. The rule
   must point at a published tag (jsDelivr serves tags, and caches them for a long time).
8. There is no npm step: the release is the GitHub Release (binaries + `SHA256SUMS`), nothing else
   (Rule 9). The workflow needs no secrets or repository variables.
9. Installers (`install/install.sh`, `install/install.ps1`):
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
     unverified **only for versions <= 0.7.4**, fail for any later version; any other status -> fail.
     With no hash tool at all, `install.sh` warns and installs.
   - `install.sh` was tested on macOS (bash 3.2) against a local GitHub-layout mirror (latest, pinned,
     pre-release, mismatch, missing assets, HTTP 500, non-GitHub base, invalid version); temp files
     are always removed. `install.ps1` has never been run (no PowerShell here).
   - Test with `HOME` and `TMPDIR` pointed into a scratch dir (and `SHELL=/bin/sh` to skip rc edits);
     never against the real `~/.opentp` or shell rc files.
10. opentp.dev docs are not tied to tags; they change only when the website re-syncs (see Docs and
    website sync). There are no signatures and no linux-arm64 or musl builds.

## Docs and website sync

- `docs/*.md` are copied into the private `opentp-website` repo (`src/content/docs/docs/cli/`) by its
  manual `scripts/sync-docs.sh` (sparse clone of this repo's default branch) or `sync-docs-local.sh`.
  The copies are committed there, so a docs change reaches opentp.dev only after a re-sync and
  redeploy. Edit docs **here**, never the website copy. Sync only from released refs (docs at a CLI
  tag).
- Every CLI doc needs Starlight frontmatter: `title` (required, the build fails without it),
  `description`, `sidebar.order`. The sync script adds frontmatter only to spec docs. The website
  sidebar lists CLI slugs explicitly in `opentp-website/astro.config.mjs` (Overview, Getting
  Started, opentp.cli.yaml = `docs/cli/config`, validate, fix, generate, migrate = `docs/cli/migrate`,
  mcp, Transforms, Checks = `docs/cli/rules`); the `sidebar.order` values here follow that order
  (config 1 ... rules 8). A new page needs a sidebar entry there, committed together with the sync
  that brings the page (an entry for a missing page breaks the build).
- **Cross-page links:** write them root-absolute as `/cli/<page>` or `/cli/<page>#<anchor>`. The sync
  scripts rewrite them: `index.md` -> `./<page>`, every other page -> `../<page>/`. Other
  root-absolute links (`/schema/...`, `/transforms`, `/rules`) are rewritten only by per-file `perl`
  lines (today `getting-started.md` and `generate.md`); avoid new ones. These links do not work on
  GitHub (known). Anchors follow Starlight's slugger: `## Plugins and --allow-plugins` ->
  `#plugins-and---allow-plugins`; a repeated heading gets `-1`.
- Keep README/docs examples runnable against the current CLI; paste real output, not hand-written
  samples. Check every full YAML example by putting it into a scratch plan and running the built CLI
  (and the spec's `scripts/validate.ts` `validateNode` for plan files); output with absolute paths is
  described in prose instead of pasted.

## Coding conventions

- **Biome 2** (`biome.json`, `src/**/*.ts` only): 2 spaces, lineWidth 100, double quotes, semicolons,
  trailing commas; `recommended` rules with `noExplicitAny` and `noNonNullAssertion` off.
  `organizeImports` is enforced by `npm run lint`; fix it with `npm run lint:fix`.
- **TypeScript** strict; `node:`-prefixed built-in imports; `_`-prefix unused bindings.
- **Plugins:** one kebab-case folder named exactly like the registry `name`; `index.ts` exports a
  camelCase const; specs are `transform.spec.ts` / `rule.spec.ts` / `generator.spec.ts` and import
  `describe/expect/it` from `vitest` explicitly.
- **`RuleResult.code`** values are UPPER_SNAKE (`TYPE_MISMATCH`, `PATTERN_NO_MATCH`, ...).
- **Validation messages** are plain sentences. Paths are dotted check paths (`taxonomy.<f>`,
  `event.key`, `payload.<targetId>[.<versionKey>].schema.<f>[.value|.enum[<i>]|.pii.<k>]`). Payload
  schema paths use resolved target ids, not the selector written in the file; problems found by the
  per-file document walk use the written path (`payload.schema.<f>.checks.<id>`). Config-level
  problems use `event: "opentp.yaml"` / `"opentp.cli.yaml"` and the dotted path, reported once.
  Problems with a whole file use `path: ""`.
- **Logging:** use `logger` (`src/util/logger.ts`); every level goes to stderr. stdout is only for
  command output: never add other stdout output. User-facing exit codes come from `EXIT_*` in
  `cli.ts`; never call `process.exit`.
- **Commits:** conventional prefixes per CONTRIBUTING.md (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`).

## Known issues & traps (verified 2026-10-03)

- **Lockfile platforms.** `package-lock.json` must contain the optional platform packages for every OS (`@rollup/rollup-linux-x64-gnu`, `@esbuild/linux-x64`, `@biomejs/cli-linux-x64`, `@oven/bun-linux-x64`, ...). npm 10 on macOS can drop the non-macOS entries when it updates the lockfile, and then `npm ci` on the Linux CI runners misses native binaries. Update dependencies with npm 11 or later (`npx npm@11 install`) and check with `grep -c '"node_modules/@rollup/rollup-linux-x64-gnu"' package-lock.json` (must be 1).
- **Files that do not match the path template are skipped with no message** (a file one directory too
  deep, a typo in a directory name). Check `count=`. An optional `--strict` is not implemented.
- **The CLI does not apply the spec's JSON Schemas.** Unknown keys are ignored silently, except
  `<<` (YAML merge keys are not part of YAML 1.2): `mergeKeyPaths` (`document.ts`) reports every
  plain `<<` key in the document walk of `opentp.yaml`, event and dictionary files (never ignorable)
  and `readCliConfig` refuses it in `opentp.cli.yaml` (exit 2); migrate lists them under `manual`.
  Plain keys are found in the YAML text by `parseYaml` (`util/yaml.ts`, stored on the root value as
  a symbol, like the source key order): a quoted `"<<"` is an ordinary key, and a value built in
  code has none. Never detect them on the parsed JavaScript value (it cannot tell plain from
  quoted).
- **Payload errors repeat per target.** A problem in an event with an implicit payload over
  web/ios/android is reported three times, with resolved target ids rather than the selector written
  in the file. Problems found by the document walk (removed keywords, `checks` ids, `dict` refs,
  empty enums, regexes) are reported once per file. Ignores are widened to every target and version
  (spec 2.9, pinned by a fixture).
- **`fix` rewrites keys even for events with `ignore: event.key`** (`docs/fix.md` says so). It edits
  only the key's text, like `migrate` edits text: never go back to `yaml.stringify` of the loaded
  object, which drops comments and puts integer-like version keys ("2" before "1") into numeric
  order (the overlap direction depends on that order; pinned by `src/cli.spec.ts`).
- **Generator limitations.** The template engine cannot nest `#each` or `#if`, and its header comment
  documents a `{{@key}}` that is not implemented. `--output` resolves against `--root`, `--file`
  against cwd, and `generate.run` paths against `opentp.cli.yaml`. `generate.run[].target` selects
  events; the export still lists every target of those events.
- **`generate` refuses on any dictionary issue and any `opentp.yaml`, keygen or tracker problem,**
  including problems that do not change the export, and it needs the keygen plugins
  (`--allow-plugins` or `--external-transforms`) when keygen uses custom steps.
- **Warnings output.** `warningLines` prints one block per file (other warnings, then overlap
  warnings) and caps overlap warnings at 20 in text mode; overlaps raised to errors are all printed.
  An event with more than 20 attached overlap warnings has one summary warning (see "Overlap").
- **Closed-vocabulary message.** `Unknown field '<f>': add it to the catalog (...) or to
  spec.targets.all/<T>.schema` is followed by `. Did you mean '<x>'?` (`didYouMean` starts with the
  period; the tracker's unknown-field message uses it too). Tests pin the exact text.
- **Names from the plan are own keys.** Field names, version keys, target ids and selectors can be
  `__proto__`: build maps keyed by them with `setOwn`/`getOwn` (`src/util/objects.ts`), a `Map` or
  `Object.fromEntries`, never `object[name] = value` (also in generators: `effective.ts`; pinned by
  `semantics.spec.ts`).
- **Application repositories.**
  - `GIT_TERMINAL_PROMPT=0` does not stop ssh passphrase or host-key prompts: such a clone waits until
    the 120 s timeout. Users need key-based auth or `GIT_SSH_COMMAND="ssh -o BatchMode=yes"`
    (documented in `docs/config.md`).
  - Fetching by commit SHA needs server support (protocol v2, GitHub, GitLab; older servers need
    `uploadpack.allowReachableSHA1InWant`). The tests set `uploadpack.allowAnySHA1InWant`.
  - A killed run leaves its `opentp-plan-*` directory in `os.tmpdir()` (or, after a cross-device
    copy, a `<dir>.tmp-*` directory in the cache); nothing cleans them up.
  - Errors in the plan's `opentp.yaml` keep the label `opentp.yaml`. 2026-01 event and dictionary
    files of a pinned plan get `PINNED_FILE_HINT` (`Pin a plan ref whose files are all on 2026-09.`)
    instead of the migrate hint (`ValidationSettings.pinnedPlan`, `LoadDictionariesOptions.pinnedPlan`).
  - Webhook bindings of the plan repository are dropped by `mergeApplicationConfig` (ids the
    application does not bind itself are `ApplicationMode.planWebhooks`): `CheckEnvironment` gives
    their ids `planWebhookCheckMessage` as unknownCheck, and `planPluginsWarning` lists them.
  - A rule binding of the plan repository to one of its plugin rules counts as an unknown check
    (warning), not exit 2.
- **migrate.** A run interrupted after the event files but before `opentp.cli.yaml` loses the webhook
  id -> configuration mapping (the next run lists each unbound `webhook-<n>` under `manual`).
  Flow-style mappings that need an insertion stop the run (exit 1). A comment on
  `spec.events.payload.schema` stays above the new catalog. Not auto-fixed (listed under `manual`): an
  event `required: false` on a field with a base `value`, examples that are not numbers or booleans,
  type mismatches; taxonomy examples are left alone.
- **Tracker.** A snowplow binding without `event` is accepted although unmapped fields go to
  `event.<f>`; `describe_plan` shows the binding even when it has problems (fields with an invalid
  path are left out).
- **Never call `process.exit` on a normal path.** On macOS, stdout to a pipe is asynchronous: 0.7.4
  called `process.exit` right after `console.log`, and `generate json | wc -c` printed 65536 for a
  1.8 MB export. Do not reintroduce `import * as process from "node:process"`: the namespace binding
  is read-only in the esbuild bundle. Lingering timers or sockets delay the exit (the webhook check
  clears its timeout in `finally`).
- **Exit code 2 is new in 0.8.0** (up to 0.7.4 every failure was 1). CI scripts that test `$? -eq 1`
  must accept 2 as well. All breaking changes are in `CHANGELOG.md`.
- **Importing the package still loads the whole CLI** (`src/index.ts` imports `./cli` and the
  registries) but no longer runs it: the bootstrap guard is only `require.main === module`. Do not
  reintroduce argv matching.
- **Never compile a binary without `--no-compile-autoload-bunfig --no-compile-autoload-dotenv`.** Bun
  standalone executables otherwise load `bunfig.toml` (whose `preload` runs arbitrary code) and `.env`
  from the working directory, which a plan repository or pull request controls. Fixed in 0.9.1;
  `release.yml`, `ci.yml` and the `compile:*` scripts pass both flags, and both smoke tests check it.
- **The Bun binaries rely on `undefined === undefined`.** In an ES module Bun leaves `module` and
  `require.main` undefined, so the guard is true for the compiled `src/cli.ts`; a guard such as
  `typeof module !== "undefined" && ...` makes every binary a silent no-op. Caught by the CI binary
  smoke test. Bun is pinned in three places that must agree: `release.yml`, `ci.yml` and the `bun`
  devDependency.
- **CI smoke checks match output text** (`ci.yml` and the binary smoke step of `release.yml`):
  `All events are valid count=4$` (coverage-valid, no warnings), exit 1 + `Validation failed
  errorCount=` (coverage-invalid), `warnings=4 count=12$` and `errorCount=4 warningCount=0
  eventCount=12$` (overlap), `count=2$` (application), `Run "opentp migrate"` (the 2026-01 fixture),
  `diff -r` against `migrate-2026-01.expected`, `warnings=1 count=3$` after migrate, `Nothing to
  migrate`, `check throwing-check failed:` and no `Unknown check 'throwing-check'` (release), and for
  the spec examples `count=[1-9][0-9]*$` plus a `--json` check that `extensions` has exactly two
  `unknownCheck` warnings for `mytool.*` ids. Changing those messages, counts, fixtures, streams or
  exit codes means updating both workflows, CONTRIBUTING.md and this file in the same change.
- **Overlap at scale.** Pairs grow quadratically in the worst case; the index keeps typical plans fast,
  and pairs are streamed and summarized per event so memory and output stay bounded (see
  "Overlap"). The computation is still quadratic in time (4.5M pairs: about 2.5 s). Never collect
  every pair (`[...index.pairs()]` is for tests), never spread large arrays into `push(...)`, and
  print large reports with `printLines`.
- **Pushing a `v*` tag publishes the GitHub Release at once** (the installers serve it as latest
  immediately). A tag that contains `-` becomes a GitHub pre-release. A `+build` suffix alone is not
  treated as a pre-release.
- **Installer "latest" window:** `softprops/action-gh-release` uploads assets one by one after creating
  the release, so "latest" points at the new release before its files are there. An install in that
  window fails; it never installs unverified, and it never mixes the files of two releases.
- **Distribution state (as of 2026-10-03).** The latest release is `v0.9.1` (spec `2026-01`); `main`
  is 0.10.0 (spec `2026-09`), not released. Its CI needs the spec tag `2026-09` (not cut yet), and
  `https://opentp.dev/schemas/cli/*` (prepared in the website, not deployed) needs the `v0.10.0` tag.
  The installers install the latest release and verify it; releases up to `v0.7.4` have no
  `SHA256SUMS` and install with a warning. The npm package `opentp` (`0.0.1`, `0.5.0`) is obsolete
  and will not be updated (Rule 9).
- **`install.ps1` has never been run** (no PowerShell in this environment). It mirrors `install.sh`
  line by line, but PowerShell specifics are unverified.

## Definition of done

- [ ] `npm run lint` is clean.
- [ ] `npm test` passes. New behaviour has unit tests and/or a fixture case whose errors are listed in
      the exhaustive `COVERAGE_INVALID_ERRORS` / `COVERAGE_INVALID_WARNINGS`, and `coverage-valid`
      still has zero errors and zero warnings.
- [ ] `npm run typecheck` passes with 0 errors (`tsconfig.json` and `tsconfig.test.json`); specs and
      mocks were updated after any signature or type change.
- [ ] `schemas/opentp.cli.schema.json` is current (`npm run schema`; the stale-schema test passes).
- [ ] `npm run build` succeeds and the smoke tests pass (the fixture, overlap, application, migrate,
      MCP and spec-example steps of `ci.yml`, replayed locally when they changed).
- [ ] If the CLI surface changed, `printHelp`, `README.md`, `docs/<command>.md`, `docs/config.md` and
      `docs/index.md` are updated; examples were run against the build and outputs pasted from real
      runs. Frontmatter is intact, and cross-page links use `/cli/<page>`.
- [ ] If spec semantics changed, they are consistent with `opentp-spec` (schemas and
      `docs/semantics.md`), and the spec examples still validate with the expected warnings.
- [ ] For a release, `package.json`/`package-lock.json` version and the tag agree (`release.yml`
      enforces it), the artifact names are unchanged, all five assets return 200, and the website's
      `/schemas/cli/*` rule points at the new tag when the schema changed.
- [ ] User-visible changes are listed under `## [Unreleased]` in `CHANGELOG.md` (breaking first).
- [ ] This `AGENTS.md` is updated if layout, commands, counts, conventions or known issues changed.
- [ ] The commit message is in English and uses a conventional prefix.

## Related repositories (optional local-workspace context)

In a local workspace they sit next to this repo (`../opentp-spec`, `../opentp-website`).
- **`opentrackplan/opentp-spec`**: format source of truth (schemas, `docs/semantics.md`,
  `docs/schema/*.md`, examples, `CHANGELOG.md` with migration notes); its checks are
  `bun scripts/validate.ts` and `bun test scripts/validate.test.ts`.
- **`opentrackplan/opentp-website`** (private): opentp.dev; syncs `docs/` from here and owns the
  `/install`, `/schemas/<version>/*` and `/schemas/cli/*` redirects.
- **`opentrackplan/opentp-sdk`**: TypeScript runtime SDK `@opentp/sdk` 0.1.0 (GA4, Snowplow, Amplitude
  adapters). Its README expects a typed tracker "generated by opentp-cli"; **no such generator exists
  yet**. It would belong in `src/generators/`, built on `context.effective(event)` and
  `context.tracker`.
