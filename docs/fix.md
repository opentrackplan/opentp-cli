---
title: fix
description: Auto-fix event keys based on taxonomy values.
sidebar:
  order: 2
---

# opentp fix

Automatically fixes event keys based on taxonomy values and the configured key generator (`spec.events.x-opentp.keygen`).

## Usage

```bash
opentp fix [options]
```

## Options

| Option | Description |
|--------|-------------|
| `--root <path>`, `-r <path>` | Project root directory |
| `--verbose`, `-v` | Debug logs (on stderr) |
| `--json` | Print the validation result as one JSON document on stdout |
| `--external-transforms <dir>` | Load custom transforms (repeatable) |
| `--external-rules <dir>` | Load custom validation checks for the validation that follows (repeatable) |

`opentp validate --fix` (or `-f`) is the same as `opentp fix`. `--external-*` directories are resolved against the current directory.

## Examples

### Fix all events

```bash
opentp fix
```

Output (log lines, on stderr):

```
Fixed event key file="auth/2/false/ignored_application_id_dict.yaml"
Fixed event key file="auth/3/false/login_experiment.yaml"
Events fixed count=2
✓ All events are valid count=4
```

After rewriting keys, `fix` validates the plan like `opentp validate`, and the exit code comes from that validation (`0` or `1`). With `--json`, stdout holds only the validation JSON document; the `Fixed event key` lines stay on stderr.

`fix` exits with code `2` and changes nothing when `spec.events.x-opentp.keygen` is not configured, when `opentp.yaml` is missing or cannot be loaded, or when the arguments are invalid. When `opentp.yaml` has configuration problems (for example an unknown transform step in a keygen pipeline), no key is rewritten, and the problems are reported by the validation (exit code `1`).

## How It Works

1. Reads each event file
2. Extracts taxonomy values (area, event, etc.)
3. Applies `spec.events.x-opentp.keygen.template` + transforms to generate the expected key
4. If the current key doesn't match, updates the file

### Example

Given this configuration:

```yaml
# opentp.yaml
spec:
  events:
    x-opentp:
      keygen:
        template: "{area | slug}::{event | slug}"
        transforms:
          slug:
            - lower
            - replace:
                from: " "
                to: "_"
```

And this event:

```yaml
# events/auth/login_button_click.yaml
event:
  key: wrong_key  # incorrect
  taxonomy:
    action: User clicks login button
```

Running `opentp fix` will update the key to:

```yaml
event:
  key: auth::login_button_click  # fixed
```

## Notes

- Only the `key` field is modified; other fields remain unchanged
- Original file formatting is preserved as much as possible
- Run `opentp validate` after fixing to verify changes
