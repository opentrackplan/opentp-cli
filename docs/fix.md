---
title: fix
description: Auto-fix event keys based on taxonomy values.
sidebar:
  order: 2
---

# opentp fix

Automatically fixes event keys based on taxonomy values and the configured key pattern.

## Usage

```bash
opentp fix [options]
```

## Options

| Option | Description |
|--------|-------------|
| `--root <path>` | Project root directory |
| `--verbose` | Show detailed output |
| `--dry-run` | Show what would be fixed without making changes |

## Examples

### Fix all events

```bash
opentp fix
```

Output:

```
Fixed 3 events:
  events/auth/login.yaml: auth::login_click → auth::login
  events/dashboard/view.yaml: dashboard_view → dashboard::view
  events/onboarding/step.yaml: step_complete → onboarding::step_complete
```

### Dry run

```bash
opentp fix --dry-run
```

Shows what would be fixed without modifying files.

## How It Works

1. Reads each event file
2. Extracts taxonomy values (area, event, etc.)
3. Applies configured transforms to generate the expected key
4. If the current key doesn't match, updates the file

### Example

Given this configuration:

```yaml
# opentp.yaml
spec:
  events:
    key:
      pattern: "{area | slug}::{event | slug}"
  transforms:
    slug:
      steps:
        - step: lower
        - step: replace
          params:
            pattern: " "
            with: "_"
```

And this event:

```yaml
# events/auth/login.yaml
event:
  key: wrong_key  # incorrect
  taxonomy:
    area: Auth
    event: Login Button Click
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
