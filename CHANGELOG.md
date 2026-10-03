# Changelog

All notable changes to the `opentp` CLI are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are `package.json` versions; tags
are `v<version>`. When a version is released, the release workflow copies its section into the GitHub
Release notes.

Releases up to 0.7.4 are described only in their
[GitHub Releases](https://github.com/opentrackplan/opentp-cli/releases).

## [Unreleased]

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
