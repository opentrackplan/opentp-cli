# Changelog

All notable changes to the `opentp` CLI are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are `package.json` versions; tags
are `v<version>`. When a version is released, the release workflow copies its section into the GitHub
Release notes.

Releases up to 0.7.4 are described only in their
[GitHub Releases](https://github.com/opentrackplan/opentp-cli/releases).

## [Unreleased]

## [0.10.0] - 2026-10-03

Supported spec version: **`2026-09`** (was `2026-01`). This release reads only
`2026-09` plans; `opentp migrate` upgrades a `2026-01` plan. CLI settings move out of the plan into
a new file, `opentp.cli.yaml`. Upgrade a plan repository and every pinned opentp (`OPENTP_VERSION`,
CI images) in the same commit; a repository that has to stay on `2026-01` can keep
`OPENTP_VERSION=0.9.1`. The format changes themselves are listed in the
[opentp-spec changelog](https://github.com/opentrackplan/opentp-spec/blob/main/CHANGELOG.md).

### Breaking changes

- **Only spec `2026-09` is read.** A plan whose `opentp.yaml` says `2026-01` stops every command
  with exit code `2`: `This plan uses OpenTrackPlan 2026-01; opentp 0.10.0 reads 2026-09. Run
  "opentp migrate" to upgrade it (or keep opentp 0.9.1: OPENTP_VERSION=0.9.1).` An event or
  dictionary file still on `2026-01` inside a `2026-09` plan gets the version error plus
  `Run "opentp migrate" to upgrade it.` (in an application repository: `Pin a plan ref whose files
  are all on 2026-09.`) `opentp.yaml` next to `opentp.yml` is an error (exit code
  `2`).
- **The `2026-09` rules are enforced** (see `docs/validate.md`):
  - `spec.events.payload.schema` is the field catalog: the fields events *may* use. It no longer
    adds its fields to every event; fields of every event live in `spec.targets.all.schema` and
    `spec.targets.<target>.schema` (common fields).
  - Closed vocabulary: an event field that is neither a catalog field nor a common field of the
    target is an error (`Unknown field '<f>': add it to the catalog ... Did you mean ...?`), never
    ignorable.
  - Keywords must fit the field's type, also when an event field inherits it: no top-level `enum`
    or `dict` on an array (`use items.enum` / `items.dict`; a `restricted` array field needs a
    `value`), string constraints only on strings, number constraints only on numbers and integers,
    `items`, `minItems`, `maxItems` and `uniqueItems` only on arrays. Reported once where written,
    never ignorable.
  - `spec.events.payload.targets.all` must hold unique, non-empty ids; every check id (on fields,
    items, taxonomy and PII settings, in events too) must match `^[A-Za-z][A-Za-z0-9_.-]*$` (an
    error, not an `unknownCheck` warning); `enum` and `dict` cannot be used together on taxonomy
    fields, fragments and PII settings either.
  - YAML merge keys (a plain `<<` key) are errors anywhere in `opentp.yaml`, event and dictionary
    files (never ignorable) and in `opentp.cli.yaml` (exit code `2`): YAML 1.2 has no merge, so the
    keys were silently kept as data and the intended merge did not happen. A quoted `"<<"` is an
    ordinary key.
  - `valueRequired` is replaced by `policy: specified | restricted | fixed` on catalog and common
    fields; `policy` in an event is an error. `meta.deprecated` versions are exempt.
  - `x-opentp` is removed everywhere and `valueRequired` too: both are errors where they are
    written (`x-opentp.checks` became `checks`, `x-opentp.keygen` moved to `opentp.cli.yaml`,
    `x-opentp.role` is gone).
  - An event cannot change a fixed `value` of a base layer or replace it with `enum` or `dict`;
    `required: false` next to a `value` or a `restricted`/`fixed` policy is an error (no optional
    constants); enum members, fixed values and examples must satisfy the field's type and
    constraints; `enum: []` is invalid; code-facing names (`name`, else the key) must be unique
    per event version.
- **`opentp migrate`** is the upgrade path (see Added).
- **Key generation moved to `opentp.cli.yaml`** (`keygen`, was `spec.events.x-opentp.keygen`).
  Without `keygen` there is no key-equality check, and `opentp fix` exits with code `2` (`fix
  needs keygen in opentp.cli.yaml`). Keygen problems are reported against `opentp.cli.yaml` at
  `keygen.*` paths.
- **Webhook checks are bindings.** `webhook` is a reserved check id: a plan can no longer define a
  webhook (`checks: { webhook: {...} }` is an error). Bind it in `opentp.cli.yaml`
  (`checks.bindings.<id>.webhook: { url, method, headers, timeout, retries, cache }`) and refer to it
  by id in the plan (`<id>: true`). The parameters the plan writes are sent as `params` in the
  request body.
- **`OPENTP_WEBHOOK_ENV` unset or empty now allows no variables** (0.9.x read every variable with
  a warning). List the variables a webhook binding may read, in the environment of the run.
- **Plugins named in `opentp.cli.yaml` load only when allowed.** `keygen.plugins`,
  `checks.plugins` and `generate.plugins` load only with `--allow-plugins` or
  `OPENTP_ALLOW_PLUGINS=1`; otherwise opentp prints one warning and runs without them. The
  `--external-*` options load as before.
- **Unknown check ids are warnings, not errors** (tool rule `unknownCheck`, reported once for
  `opentp.yaml` and once per event file), so a plan can carry checks for other tools. Use
  `--fail-on unknownCheck` or `checks.severity.unknownCheck: error` to fail on them. Parameters
  `false` disable a check (`not-empty: false` no longer runs it).
- **Validation output.** Warnings exist now and never change the exit code:
  - text mode prints them after the errors (`⚠` lines);
  - the summary lines are `✓ All events are valid count=N` (no warnings),
    `✓ All events are valid warnings=W count=N` and
    `✗ Validation failed errorCount=E warningCount=W eventCount=N` (was
    `errorCount=E eventCount=N`); `count=` stays the last field, so scripts that match
    `count=N$` must expect `warnings=` only when they allow warnings;
  - `--json` adds a `warnings` array, and entries of tool rules carry `rule` (`overlap`,
    `unknownCheck`); `success` is `true` when there are no errors.
- **Exports.** `json` and `yaml` exports gain the top-level keys `catalog`, `targets` and `checks`
  (order: `opentp`, `info`, `catalog`, `targets`, `checks`, `events`, `dictionaries`), and every
  event gains `effectivePayload` next to the raw `payload`. Dictionaries are sorted by name, the YAML
  export writes no anchors or aliases, and every generator (plugins too) gets the events sorted by
  file path instead of the file system's order.
- **MCP.** `describe_plan` replaces `baseSchema` and `targetSchemas` with `catalog`, `commonFields`
  (per target, with `policy`) and `targetSettings`, and adds `key.keygen`, `checks`, `tracker` and,
  in an application repository, `pinnedPlan`. `suggest_event` no longer returns `needsValue`; its
  skeleton lists every field with a policy. The `generator` argument of `generate` is optional (one
  of `generator` or `run` is required).

### Added

- **`opentp migrate`** (`--check`, `--dry-run`, `--json`, `-v`, `--cli-config`): upgrades a
  `2026-01` plan to `2026-09` by editing the text of the files, so comments, quoting, key order and
  line endings stay. It moves the old base fields to `spec.targets.all.schema`, writes the catalog,
  turns `valueRequired` into `policy: fixed` where every event pins a value, moves `keygen` and
  webhook checks to `opentp.cli.yaml`, and lists what needs manual attention. Runs again safely
  (`Nothing to migrate`); `--check` exits `1` while files are left to migrate. The events and
  dictionaries roots are followed also when they are symbolic links, and so are symbolic links to
  YAML files inside them (as validate reads them); a symbolic link, also a symbolic `opentp.yaml` or
  `opentp.cli.yaml`, is written through (the link stays); other links are listed as warnings.
  Aliases to webhook configurations and `x-opentp` blocks are migrated. Nothing is written (exit
  `1`, each reason with its file and path) when the events or dictionaries root or a directory
  inside one cannot be read (other directories are skipped with a warning), a migrated file would
  not load again (for example an alias whose anchor an edit moves or removes),
  `spec.events.payload.schema` has an anchor or is an alias, or a mapping migrate inserts into is
  in flow style; an existing `opentp.cli.yaml` with the wrong shape stops it with exit `2`. A
  webhook configuration is copied into its binding with the method upper-cased (`post` -> `POST`)
  and without keys a binding does not take (a warning names each one where it is written); one that
  a binding still does not accept stops the run with its problems at every file and path where it
  is written. YAML merge keys (`<<`) are listed under manual, and YAML files that are not plan files and cannot be
  loaded are skipped with a warning.
- **`opentp.cli.yaml`**: the CLI's own settings next to `opentp.yaml` (or `--cli-config <path>`, a
  new global option): `opentp` (must equal the plan's), `cli` (an npm semver range of opentp
  versions that may run the plan), `keygen`, `checks`, `tracker`, `generate`, `mcp`, `plan` and
  `x-*`. Shape problems exit `2`. A JSON Schema for editors is published as
  `schemas/opentp.cli.schema.json` (`https://opentp.dev/schemas/cli/opentp.cli.schema.json`).
- **Checks:** portable checks in `spec.checks` (named sets of constraints, used as `<id>: true`);
  check bindings in `opentp.cli.yaml` (`rule` + default `params`, or `webhook`); checks run on fixed
  values (array items one by one), taxonomy values and PII values (also those written in
  `opentp.yaml`), and portable checks also on enum members and examples (the items of an array
  example also get the portable checks of `items`). A check bound to a rule that is not loaded is
  an `unknownCheck` warning that says so and names the plugin gating. A `spec.checks` id that shadows a tool check gives a warning; colliding
  binding ids exit `2`.
- **Overlapping events:** `validate` (and `fix`, MCP `validate_plan` and `validate_event_draft`)
  reports pairs of events whose payloads can match the same hit, as warnings with rule `overlap`
  (`identical`, `contains` or `overlaps`). `ignore: overlap` / `overlap.<key>` silence them per
  event; text mode prints at most 20 (from the events with the most attached overlap warnings
  first) and says how many more `--json` lists. Each pair is reported on one of its two events;
  when more than 20 overlap warnings would be attached to one event, they become one summary warning
  (`Overlaps with <n> other events on <targets> (<counts per kind>); for example ...`), so a plan in
  which some events lost their identity field still gets a report of bounded size; the `--json` document and the text report are
  written in chunks. In a `contains` pair, the first target and the first versions in file order
  decide which event is the broader one, also with integer-like version keys (`"2"` before `"1"`).
  Text mode prints all warnings of a file in one block.
- **Tool rule severity:** `--fail-on <rule>[,<rule>]` (`validate`, `fix`, `mcp`) and
  `checks.severity` in `opentp.cli.yaml` (`off`, `warning`, `error`) for `overlap` and
  `unknownCheck`.
- **Tracker binding** (`tracker` in `opentp.cli.yaml`): where each field travels in a Snowplow,
  GA4, Amplitude, Segment or generic payload, checked against the plan and resolved per target for
  generators (`context.tracker`), the template generator and MCP `describe_plan`. Every field gets
  its `path` and its `segments`; a field name appended to a container (or used as the default
  place) is one segment whatever it contains (`Item Name`, `page.url`). Globs match in linear time.
  `event` and `contexts` with a type other than `snowplow` are validation errors (exit `1`).
- **`generate.run`:** `opentp generate` without a generator name runs the entries of
  `opentp.cli.yaml` (`generator`, `output`, `file`, `pretty`, and the filters `target` and
  `events`); paths are relative to that file and must stay inside its directory (absolute paths,
  `.git` segments and paths that leave it, also through symbolic links, exit `2`; no option lifts
  this, while `-o` and `--file` on the command line are not limited). Every entry is checked before
  any runs, and every problem is reported as `generate.run[<i>].<key>`. `target` selects the events whose payload selectors
  cover the target, also when a version does not resolve.
- **Generators:** `GeneratorContext.effective(event)` (the effective payload per target and version,
  from the same merge as validation), `cliConfig` (read-only settings) and `tracker`; the types
  `EffectivePayload`, `EffectiveTargetPayload` and `EffectiveVersion`. The template generator's data
  has the new export keys plus `tracker`.
- **Application repositories:** an `opentp.cli.yaml` with `plan:` and no `opentp.yaml` uses the
  plan that `plan:` names: a directory, or a git URL (`git+ssh://`, `git+https://`, `git+file://`)
  pinned to a tag or a commit SHA (also the id of an annotated tag object, as `git rev-parse <tag>`
  prints it), fetched once with the system `git` into a cache (`OPENTP_CACHE_DIR`, else the
  platform's cache directory) and never refreshed. A tag is fetched by the object id that `git
  ls-remote` gives for it (a branch with the same name is never used) and the checked-out commit is
  verified. git runs only in a new directory in the system's temporary directory, never in the
  current directory or the cache, with `GIT_CEILING_DIRECTORIES` and `-c
  safe.bareRepository=explicit`, so a repository layout that a checkout under review contains is
  never read; the finished clone is then moved into the cache. Keep the cache directory outside
  checkouts of untrusted changes. Credentials in a plan URL are shown as `***` in messages and logs
  and are not stored in the cached clone (use a credential helper instead of a token in the URL).
  `validate`, `generate` and `mcp` work there (no key checks; the plan repository's `tracker`, its
  rule bindings in `checks.bindings` and `checks.severity` are merged in, and tracker problems at
  keys that only the plan repository's file has are labelled `opentp.cli.yaml of the plan
  '<plan>'`; its plugins and webhook bindings never run, and checks that use them count as unknown
  checks); `fix` and `migrate` refuse with exit code `2`.
- **MCP:** `mcp.tools` selects the tool groups (`describe`, `search`, `validate`, `generate`; at
  least one), and the server instructions, the tool descriptions and the `howTo` of `describe_plan`
  name only the tools of those groups; the `suggest_event` description and `describe_plan` say that
  a restricted field takes enum values or a value, and an array field only a value;
  `validate_event_draft` reports overlaps between the draft and the plan; `validate_plan` and
  `validate_event_draft` return warnings; `get_event` shows the `2026-09` effective fields with the
  layers they come from; `generate` takes `run`, the index of a `generate.run` entry, and never
  writes a file; `--cli-config`, `--fail-on` and `--allow-plugins` for `opentp mcp`.
- **`format`** is checked on fields, array items, taxonomy fields, the event key and portable
  checks (`date`, `date-time`, `email`, `uuid`, `uri`, `ipv4`, `ipv6`): `Value is not a valid
  <format>`. `ipv4` octets have no leading zeros (`192.168.001.1` is invalid), as in JSON Schema
  validators.
- A path template that ends in `.yaml` also matches `.yml` files, and the reverse.
- New environment variables: `OPENTP_ALLOW_PLUGINS`, `OPENTP_CACHE_DIR`.

### Changed

- `minLength` and `maxLength` (and the built-in `min-length` and `max-length` checks) count Unicode
  code points, not UTF-16 units.
- Problems written once are reported once: unknown dictionaries, invalid field regexes, empty enums,
  and `value`, `enum` and `dict` together in one definition are reported where they are written,
  not once per event and target; the last two are not ignorable. Problems in the catalog and in
  `spec.targets` are reported against `opentp.yaml`.
- Narrowing errors (`Value "x" is not in allowed enum`, `Enum values ... are not in spec enum`) are
  reported at `<field>.value` / `<field>.enum`.
- Event `ignore` paths follow the `2026-09` grammar: `payload::<f>`, any path with `.schema.<f>`,
  and `payload.<f>[.<keyword>]` silence the field-level checks of `<f>` (unknown check ids and
  unknown dictionaries included, also for a field whose name contains `.`); `reason` is optional.
- An `example` is checked where it is written: a version derived with `$ref` no longer re-checks an
  inherited example, and drops one that its narrowing (`value`, `enum`, `dict` or `items`, with the
  values of the dictionary) no longer allows, so the export never carries it.
- Payload version keys, aliases and selectors are names: a version named `x-beta`, `enum` or
  `dict` is validated like any other, and an alias is never read as a keyword. A field named
  `__proto__` is a field like any other, and a version keyed `__proto__` is exported in
  `effectivePayload` like any other.
- `opentp fix` changes only `event.key`: it replaces the text of the key's scalar and keeps every
  other byte of the file (comments, including a `# yaml-language-server` line, blank lines,
  quoting, indentation, line endings and key order). 0.9.x wrote the whole file again with the YAML
  serializer, which also put payload versions keyed `"2"` before `"1"` into numeric order and so
  could flip the direction of an overlap warning. A file whose key cannot be changed alone (for
  example `event.key` is an alias, or carries an anchor that an alias repeats) is skipped with a
  warning, and the validation that follows reports its key.
- `opentp mcp` keeps running when the plan exists but cannot be loaded (for example a `2026-01`
  plan): every tool reports the problem. It also reloads `opentp.cli.yaml` with the plan.
- `opentp.yaml`, `opentp.yml`, `opentp.cli.yaml` and `opentp.cli.yml` at the plan root are never
  read as event or dictionary files.
- The unknown transform step message names `keygen.plugins`; `--help` lists the new options,
  environment variables and the application repository mode.

### Fixed

- A payload field definition that is `null` or not a mapping (for example an empty YAML key under
  a payload schema) crashed the run (`✗✗ Fatal error`); it is now one error per place it is
  written.
- A dictionary present as both `.yaml` and `.yml` silently used whichever file was read last; now
  the `.yaml` file is used and the `.yml` file is reported as an error.

### Removed

- `valueRequired`, `x-opentp` and plan-defined webhook checks (see Breaking changes); the
  compatibility mode of `OPENTP_WEBHOOK_ENV` (unset = every variable).
- MCP: `describe_plan.baseSchema`, `describe_plan.targetSchemas` and
  `suggest_event.requiredPayloadFields[].needsValue`.

## [0.9.1] - 2026-10-03

Supported spec version: `2026-01` (unchanged). No changes to commands, options or output formats.
One fix can make a plan that passed 0.9.0 fail: an event `dict` override with values outside the
base enum or dictionary is now an error (see Fixed).

### Security

- **The binaries no longer read `bunfig.toml` or `.env` from the working directory.** Bun-compiled
  executables loaded both by default, so a plan repository (for example a pull request validated in
  CI) could run arbitrary code through a `bunfig.toml` `preload`, or set environment variables
  through `.env`. This affected every earlier binary release; the Node.js bundle was not affected.
  The release and CI builds now pass `--no-compile-autoload-bunfig --no-compile-autoload-dotenv`, and
  the smoke tests check that both files are ignored. Update to 0.9.1.
- **Webhook checks and environment variables:** `OPENTP_WEBHOOK_ENV` (variable names separated by
  commas, set in the environment of the run, never in the plan) limits which variables `${VAR}` in a
  `webhook` check's `url` and `headers` may read. A check that uses any other variable fails
  (`Webhook check uses environment variables that OPENTP_WEBHOOK_ENV does not allow: ...`) and sends
  no request; an empty value (or `,`) allows none. Without `OPENTP_WEBHOOK_ENV` every variable is
  still read, as in 0.9.0, with one warning per variable. Set it in CI now: a later minor release
  will make "unset" allow no variables. It limits which variables are read, not where they are sent:
  whoever can change the plan (`opentp.yaml` or an event file) can point a check at another URL, so
  do not run webhook checks that use secrets on untrusted changes.

### Fixed

- **`dict` overrides are checked:** an event that overrides a base field's `enum` or `dict` with its
  own `dict` must use a dictionary whose values are all in the base enum or dictionary. Such an
  override passed silently before (`value` and `enum` overrides were already checked).
- **Installer (`install.sh`):** a shell running under Rosetta on Apple Silicon now installs the native
  arm64 binary instead of the Intel one.
- **Installers:** nothing is created under `~/.opentp` until the download is verified, so an aborted
  install leaves nothing behind, and every `SHA256SUMS` or checksum error ends with "Nothing was
  installed.".
- The validation and `generate` failure summaries show the ✗ mark once (`✗ Validation failed ...`).

### Changed

- Release binaries are built with Bun 1.4.2 (was 1.3.5): the Linux and Windows binaries are 20-25 %
  smaller, the macOS ones about 5 % larger. CI (pushes and pull requests to `main`) now also compiles
  a linux-x64 binary with the release Bun and smoke-tests it, so most Bun regressions fail CI before
  a release.

## [0.9.0] - 2026-10-03

Supported spec version: `2026-01` (unchanged). No breaking changes.

### Added

- **`opentp mcp`:** serves the tracking plan to AI agents over the Model Context Protocol (stdio).
  Read-only tools: `describe_plan`, `search_events` (BM25 over character trigrams, language-agnostic,
  no model needed), `get_event` (the effective payload per target and version, common fields merged
  in), `list_dictionaries`, `get_dictionary`, `validate_event_draft` (validates YAML as if saved at a
  path, without writing it; `webhook` checks defined in the draft are not run), `validate_plan`
  (optionally per file, with whether opentp loads each file at all), `suggest_event` (file path,
  generated key and a YAML skeleton for taxonomy values) and `generate` (json/yaml). Also two
  resources (`opentp://plan/summary`, `opentp://events/{key}`) and the options `--root`,
  `--external-rules` and `--external-transforms`; the command exits with code 2 if the plan cannot be
  loaded at start. The text of one tool result is at most 256 KB. The plan is reloaded when its files change, so an agent's edits show up in its next
  call. Nothing is written to disk, and stdout carries only the protocol (plugin output goes to
  stderr). See `docs/mcp.md` for the client configuration (`.mcp.json`, Cursor, Codex, VS Code,
  Claude Desktop).

### Fixed

- **`yaml` 2.8.4:** the YAML parser is updated to fix a stack overflow on deeply nested collections
  (GHSA-48c2-rrv3-qjmp), which matters now that `opentp mcp` parses YAML sent by agents.

## [0.8.0] - 2026-10-02

Supported spec version: `2026-01` (unchanged).

### Distribution

- **The CLI is distributed only as binaries:** through the installers
  (`curl -fsSL https://opentp.dev/install | bash`, `irm opentp.dev/install.ps1 | iex`) or as a manual
  download from [GitHub Releases](https://github.com/opentrackplan/opentp-cli/releases), verified
  with `SHA256SUMS`. The binaries do not need Node.js.
- **The CLI is not published to npm.** The npm package `opentp` (0.5.0, spec `2025-06`) is obsolete:
  it cannot read `2026-01` plans and must not be used. If you installed it, remove it
  (`npm uninstall -g opentp`) so that it does not shadow the binary on your `PATH`.

### Breaking changes

The CLI now fails closed: problems that 0.7.4 skipped with a warning, or ignored, are errors.
Scripts and CI jobs that check exit codes or read stdout may need changes.

- **Exit code `2` for usage and configuration errors** (was `1`): an unknown command or option, a
  missing, empty or ambiguous option value, an option the command does not accept, an unexpected
  argument, an invalid `OPENTP_LOG_LEVEL`, an `--external-*` directory that does not exist, a failed
  external transforms or generators load, a missing or unknown generator name, `opentp.yaml` not
  found or not loadable, and `fix` without `spec.events.x-opentp.keygen`. Validation errors still exit
  `1`. Scripts that test `$? -eq 1` must accept `2` as well.
- **Strict arguments.** Unknown commands no longer run `validate` (`opentp valdiate` exits `2`), and
  unknown options are no longer ignored. The `help` and `version` commands take no arguments.
- **The hidden `export` command was removed.** Use `opentp generate json`.
- **All log lines go to stderr,** including `✓ All events are valid count=N`, the
  `✗ Validation failed ...` summary, `fix` progress and `Generated file=...`. stdout carries only the
  validation report, the `--json` document, help, version or generator output.
- **An invalid `OPENTP_LOG_LEVEL`** (anything other than `trace`, `debug`, `info`, `warn`, `error`,
  `fatal`) exits `2` instead of silencing every log line, errors included.
- **Load problems are validation errors (exit `1`)** instead of warnings: event files with a YAML
  syntax error (reported with line and column), without `event` or `event.taxonomy`, or whose key
  cannot be generated; dictionary files with a YAML syntax error or invalid content; taxonomy and
  fragment `dict` references to dictionaries that do not exist; a missing events root.
- **`opentp.yaml` problems are reported once, as errors against `opentp.yaml`:** unusable path or
  composite templates, invalid regexes, keygen problems (missing template, unknown variables,
  undefined pipelines, unknown or malformed transform steps), a `targets.all` that is not a non-empty
  list, group members and `spec.targets` keys that are not in `targets.all`. A payload selector that
  covers no target is an error in the event file.
- **`generate` refuses to export a plan that cannot be loaded completely** (exit `1`, nothing on
  stdout, no output file): any `opentp.yaml` problem above, any dictionary problem or any event file
  that cannot be loaded. It still does not validate events. When keygen uses custom transform steps,
  pass `--external-transforms` to `generate` too.
- **`fix` rewrites no key while `opentp.yaml` has a configuration problem.**
- **Library API:** `createTransform` and `createTransforms` throw on an unknown or malformed step
  instead of silently using the identity function.

### Added

- The generator name may appear anywhere after the command (`opentp generate -o events.json json`),
  and short flags can be combined (`-vf`).
- A check that throws, rejects or returns no result object reports `check <name> failed: <message>`
  for that value instead of aborting the run.

### Fixed

- Piped stdout is no longer cut off at 64 KiB (`opentp generate json | jq` on macOS): the CLI sets the
  exit code and lets Node.js flush its output instead of calling `process.exit`.
- Generator output is written to stdout as is (no extra newline), and `generate json` output now ends
  with a newline, so stdout and an `--output` file get the same bytes.
- `--external-rules`, `--external-transforms` and `--external-generators` resolve relative directories
  (`./my-rules`) against the current directory and load plugins through file URLs, which also works
  on Windows.
- Requiring the Node bundle (`dist/index.cjs`) as a library no longer runs the CLI when the requiring script's path contains `index`.

### Release and installation

- The release workflow runs the full CI (lint, type-check, tests on Node 20 and 22, build, smoke
  tests) before it builds anything, fails when the tag does not match `package.json`, runs every
  compiled binary on its own platform before publishing it, publishes a `SHA256SUMS` file with the
  binaries and marks tags with a pre-release suffix (`v1.0.0-rc.1`) as GitHub pre-releases.
- The installers install the latest release by default (`OPENTP_VERSION` pins one), resolve the
  release once so that the binary and `SHA256SUMS` always come from the same release, and verify the
  checksum. A missing `SHA256SUMS` aborts the install for every release after 0.7.4.
- Building from source (development only) needs Node.js `^20.19.0 || >=22.12.0` (`engines`, was
  `>=18.0.0`).
