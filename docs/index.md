---
title: CLI Reference
description: Complete reference for all OpenTrackPlan CLI commands.
sidebar:
  order: 3
  label: CLI
---

# CLI Reference

The `opentp` command-line interface validates, fixes, exports and migrates your tracking plan, and serves it to AI agents.

opentp 0.10 reads OpenTrackPlan **2026-09** plans, and only those. A plan on `2026-01` stops every command with exit code `2` and a pointer to [`opentp migrate`](/cli/migrate), which upgrades it; a repository that has to stay on `2026-01` can keep opentp 0.9.1 (`OPENTP_VERSION=0.9.1`).

## Files

| File | What it holds |
|------|---------------|
| `opentp.yaml` | The tracking plan: taxonomy, targets, the field catalog, common fields, checks. Event files and dictionaries live under the roots it names |
| [`opentp.cli.yaml`](/cli/config) | Optional settings of this CLI next to `opentp.yaml`: key generation (`keygen`), check bindings and plugins, the tracker binding, `opentp generate` runs, MCP tools, and `plan:` in an application repository |

## Global Options

These options are available for all commands:

| Option | Description |
|--------|-------------|
| `--root <path>`, `-r <path>` | Project root directory (default: `$OPENTP_ROOT`, otherwise the current directory) |
| `--cli-config <path>` | The `opentp.cli.yaml` to use, relative to the current directory (default: `opentp.cli.yaml` or `opentp.cli.yml` in the project root, if there is one) |
| `--verbose`, `-v` | Debug logs (on stderr) |
| `--help`, `-h` | Show help |
| `--version`, `-V` | Show version |

Options that take a value accept both `--root ./plan` and `--root=./plan`. Command-specific options are listed on each command's page.

Arguments are checked strictly: an unknown command, an unknown option, an option that the command does not accept (for example `--output` with `validate`), a missing option value or an unexpected extra argument prints a short usage message to stderr and exits with code `2`. For example, `opentp valdiate` fails instead of running `validate`, and so does `opentp help validate`: the `help` and `version` commands take no arguments. The `--help` and `--version` flags win over everything else on the command line except an unknown command or option, so `opentp generate json --help` prints the help.

## Commands

| Command | Description |
|---------|-------------|
| [`validate`](/cli/validate) | Validate the plan (the default command) |
| [`fix`](/cli/fix) | Rewrite event keys from `keygen` in `opentp.cli.yaml`, then validate (plan repositories only) |
| [`generate`](/cli/generate) | Export the plan with a generator, or run the `generate.run` entries of `opentp.cli.yaml` |
| [`migrate`](/cli/migrate) | Upgrade a `2026-01` plan to `2026-09` (plan repositories only) |
| [`mcp`](/cli/mcp) | Serve the plan to AI agents over MCP (stdio, read-only tools) |

## Quick Examples

```bash
# Validate all events
opentp validate

# Validate with custom root
opentp validate --root ./my-project

# Fail on overlapping events too (CI)
opentp validate --fail-on overlap

# Rewrite event keys
opentp fix

# Export to JSON or YAML
opentp generate json
opentp generate yaml -o events.yaml

# Run the generate.run entries of opentp.cli.yaml
opentp generate

# Upgrade a 2026-01 plan
opentp migrate

# Serve the plan to an AI agent (normally started by the agent)
opentp mcp

# Show version
opentp --version
```

## Output

Logs (the `✓ All events are valid` and `✗ Validation failed` summaries, `--verbose` debug lines, warnings and errors) go to **stderr**. **stdout** carries only the command output: the validation report, the `--json` document, the generator output, the list of migrated files, or the MCP protocol (`opentp mcp`). So `opentp validate --json > report.json` and `opentp generate json | jq` always get clean, complete output, also with `--verbose`.

## Application repositories

A repository that uses a plan without holding it (an app that generates code from it, for example) has an `opentp.cli.yaml` with `plan:` and no `opentp.yaml`. `plan:` is a directory, or a git URL pinned to a tag or a commit SHA:

```yaml
# opentp.cli.yaml
opentp: 2026-09
plan: git+ssh://git@example.com/acme/tracking-plan.git#v1.4.0
```

`validate`, `generate` and `mcp` work there on the pinned plan (without key checks); `fix` and `migrate` refuse to run, because they edit the plan repository. See [Application repositories](/cli/config#application-repositories).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENTP_ROOT` | Default for `--root` |
| `OPENTP_LOG_LEVEL` | `trace`, `debug`, `info` (default), `warn`, `error` or `fatal`. Any other value is a usage error (exit code `2`) |
| `OPENTP_ALLOW_PLUGINS` | `1`: load the plugins named in `opentp.cli.yaml`, like `--allow-plugins` |
| `OPENTP_WEBHOOK_ENV` | Environment variables that webhook bindings may use in `${VAR}` (names separated by commas or spaces). Unset or empty: none |
| `OPENTP_CACHE_DIR` | Where git plans of application repositories are cached (default: `$XDG_CACHE_HOME/opentp` or `~/.cache/opentp`; `~/Library/Caches/opentp` on macOS; `%LOCALAPPDATA%\opentp\Cache` on Windows). Keep it outside checkouts of untrusted changes |

## Exit Codes

| Code | Description |
|------|-------------|
| `0` | Success (also for `--help` and `--version`). Warnings do not change the exit code |
| `1` | The tracking plan has errors: validation errors, files that cannot be loaded, problems in `opentp.yaml` or in the `keygen` and `tracker` settings of `opentp.cli.yaml` (reported as validation errors), tool rules raised to errors (`--fail-on`, `checks.severity`), `generate` refusing a plan that cannot be loaded completely, or a generator that fails. `migrate`: `--check` found files to migrate, or the plan cannot be migrated |
| `2` | Usage or configuration error: an unknown command or option, a missing value, an invalid `OPENTP_LOG_LEVEL`, an `--external-*` directory that does not exist, a missing or unknown generator name, `opentp.yaml` not found or not loadable (YAML syntax error, an `opentp` version other than `2026-09`, missing required fields), an `opentp.cli.yaml` that cannot be used (see [Errors and exit codes](/cli/config#errors-and-exit-codes)), a `plan:` that cannot be found or fetched, `fix` without `keygen` in `opentp.cli.yaml`, or `fix` or `migrate` in an application repository |
