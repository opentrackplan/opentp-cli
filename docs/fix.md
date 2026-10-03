---
title: fix
description: Rewrite event keys from the key generator in opentp.cli.yaml.
sidebar:
  order: 3
---

# opentp fix

Rewrites every `event.key` that differs from the key generated from the event's taxonomy values by `keygen` in [`opentp.cli.yaml`](/cli/config#keygen), then validates the plan.

## Usage

```bash
opentp fix [options]
```

## Options

| Option | Description |
|--------|-------------|
| `--root <path>`, `-r <path>` | Project root directory |
| `--cli-config <path>` | The `opentp.cli.yaml` to use (default: the one in the project root) |
| `--verbose`, `-v` | Debug logs (on stderr) |
| `--json` | Print the validation result as one JSON document on stdout |
| `--fail-on <rule>[,<rule>...]` | Report these tool rules as errors in the validation that follows: `overlap`, `unknownCheck` |
| `--allow-plugins` | Load the plugins named in `opentp.cli.yaml` (`keygen.plugins`, `checks.plugins`) |
| `--external-transforms <dir>` | Load custom transform steps (repeatable) |
| `--external-rules <dir>` | Load custom checks for the validation that follows (repeatable) |

`opentp validate --fix` (or `-f`) is the same as `opentp fix`. `--external-*` directories are resolved against the current directory.

## Example

Given `keygen` in `opentp.cli.yaml`:

```yaml
# opentp.cli.yaml
opentp: 2026-09

keygen:
  template: "{area | slug}::{event | slug}"
  transforms:
    slug:
      - lower
      - trim
      - replace:
          from: " "
          to: "_"
      - truncate: 160
```

and an event with a wrong key:

```yaml
# events/auth/login_click.yaml
opentp: 2026-09

event:
  key: wrong_key

  taxonomy:
    action: User clicks the login button

  payload:
    schema:
      event_name:
        value: login_click
```

`opentp fix` prints (log lines, on stderr):

```
Fixed event key file="auth/login_click.yaml"
Events fixed count=1
✓ All events are valid count=1
```

and only the key changes in the event file:

```yaml
# events/auth/login_click.yaml
opentp: 2026-09

event:
  key: auth::login_click

  taxonomy:
    action: User clicks the login button

  payload:
    schema:
      event_name:
        value: login_click
```

The generated key comes from the template: `{area | slug}` takes the `area` value (`auth`, from the file path `auth/login_click.yaml`) through the `slug` pipeline, and `{event | slug}` does the same with `login_click`. See the [template grammar](/cli/config#template-grammar).

## How it works

1. Loads the plan and `opentp.cli.yaml`, like `opentp validate`.
2. Generates the expected key of every event from its taxonomy values (from the file path, `event.taxonomy` and composite fragments).
3. Rewrites the files whose `event.key` differs.
4. Validates the whole plan; the exit code comes from that validation (`0` or `1`). With `--json`, stdout holds only the validation JSON document; the `Fixed event key` lines stay on stderr.

**Only `event.key` changes.** `fix` finds the key's scalar in the YAML document and replaces its text; every other byte of the file stays as it was: comments (including a `# yaml-language-server` line), blank lines, quoting, indentation, line endings and key order (payload versions keyed `"2"` before `"1"` keep that order, so the [overlap](/cli/validate#overlapping-events) direction does not change). The key keeps its quoting style; a plain key that would not read back as the same string (for example `123`, `true`, or a key with ` #`) is written in double quotes. A file whose key cannot be changed alone is skipped with a warning (`⚠ Event key was not fixed: event.key cannot be changed alone in this file (edit it by hand)`, with the file and the reason) and the validation that follows reports its key: for example when `event` or `event.key` is an alias, or the key carries an anchor that an alias repeats. Events whose key cannot be generated (a taxonomy value is missing) are listed and left unchanged; `ignore` entries are not consulted, so an event that ignores `event.key` is rewritten too.

## When fix changes nothing

- **Exit code `2`**, nothing written: `keygen` is not configured in `opentp.cli.yaml` (`fix needs keygen in opentp.cli.yaml`), `opentp.yaml` or `opentp.cli.yaml` cannot be loaded, the arguments are invalid, or the project is an application repository (`fix edits the plan repository; run it there (opentp.cli.yaml has plan:)`).
- **Exit code `1`**, nothing written: `opentp.yaml` has configuration problems, or the `keygen` or `tracker` settings of `opentp.cli.yaml` have problems (for example an unknown transform step). A log line says why (`Event keys were not fixed: keygen in opentp.cli.yaml has problems`), and the validation that follows reports the problems.

When the keygen pipelines use custom steps, pass `--allow-plugins` (for `keygen.plugins`) or `--external-transforms`; without them the steps are unknown and no key is rewritten.
