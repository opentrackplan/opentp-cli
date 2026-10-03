---
title: CLI Reference
description: Complete reference for all OpenTrackPlan CLI commands.
sidebar:
  order: 3
  label: CLI
---

# CLI Reference

The `opentp` command-line interface provides tools for validating, fixing, and exporting your tracking plan.

## Global Options

These options are available for all commands:

| Option | Description |
|--------|-------------|
| `--root <path>`, `-r <path>` | Project root directory (default: `$OPENTP_ROOT`, otherwise the current directory) |
| `--verbose`, `-v` | Debug logs (on stderr) |
| `--help`, `-h` | Show help |
| `--version`, `-V` | Show version |

Options that take a value accept both `--root ./plan` and `--root=./plan`. Command-specific options are listed on each command's page.

Arguments are checked strictly: an unknown command, an unknown option, an option that the command does not accept (for example `--output` with `validate`), a missing option value or an unexpected extra argument prints a short usage message to stderr and exits with code `2`. For example, `opentp valdiate` fails instead of running `validate`, and so does `opentp help validate`: the `help` and `version` commands take no arguments. The `--help` and `--version` flags win over everything else on the command line except an unknown command or option, so `opentp generate json --help` prints the help.

## Commands

| Command | Description |
|---------|-------------|
| [`validate`](/cli/validate) | Validate all events |
| [`fix`](/cli/fix) | Auto-fix `event.key` (requires `spec.events.x-opentp.keygen`) |
| [`generate`](/cli/generate) | Export tracking plan to various formats |
| [`mcp`](/cli/mcp) | Serve the tracking plan to AI agents over MCP (stdio, read-only tools) |

## Quick Examples

```bash
# Validate all events
opentp validate

# Validate with custom root
opentp validate --root ./my-project

# Auto-fix event keys
opentp fix

# Export to JSON
opentp generate json

# Export to YAML
opentp generate yaml

# Serve the plan to an AI agent (normally started by the agent)
opentp mcp

# Show version
opentp --version
```

## Output

Logs (the `✓ All events are valid` and `✗ Validation failed` summaries, `--verbose` debug lines, warnings and errors) go to **stderr**. **stdout** carries only the command output: the validation report, the `--json` document, the generator output, or the MCP protocol (`opentp mcp`). So `opentp validate --json > report.json` and `opentp generate json | jq` always get clean, complete output, also with `--verbose`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENTP_ROOT` | Default for `--root` |
| `OPENTP_LOG_LEVEL` | `trace`, `debug`, `info` (default), `warn`, `error` or `fatal`. Any other value is a usage error (exit code `2`) |
| `OPENTP_WEBHOOK_ENV` | Environment variables that `webhook` checks may use in `${VAR}` (comma-separated; empty or `,` allows none). Unset: all, with a warning |

## Exit Codes

| Code | Description |
|------|-------------|
| `0` | Success (also for `--help` and `--version`) |
| `1` | The tracking plan has errors: validation errors, files that cannot be loaded, problems in `opentp.yaml` reported as validation errors (for example an unknown keygen transform step), `generate` refusing a plan that cannot be loaded completely, or a generator that fails |
| `2` | Usage or configuration error: an unknown command or option, a missing value, an invalid `OPENTP_LOG_LEVEL`, an `--external-*` directory that does not exist, a missing or unknown generator name, `opentp.yaml` not found or not loadable (YAML syntax error, unsupported `opentp` version, missing required fields), or `fix` without `spec.events.x-opentp.keygen` |
