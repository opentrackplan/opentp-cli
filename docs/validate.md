---
title: validate
description: Validate all events in your tracking plan.
sidebar:
  order: 1
---

# opentp validate

Validates all events in your tracking plan against the configuration.

## Usage

```bash
opentp validate [options]
```

## Options

| Option | Description |
|--------|-------------|
| `--root <path>` | Project root directory |
| `--verbose` | Show detailed output |
| `--external-rules <path>` | Load custom validation rules |
| `--external-transforms <path>` | Load custom transforms |

## Examples

### Basic validation

```bash
opentp validate
```

Output:

```
✓ All events are valid count=42
```

### With custom project root

```bash
opentp validate --root ./my-tracking-plan
```

### With verbose output

```bash
opentp validate --verbose
```

Shows detailed information about each validated event.

### With custom rules

```bash
opentp validate --external-rules ./my-rules
```

Loads additional validation rules from the specified directory.

## Validation Checks

The validator performs these checks:

1. **Schema validation** — event files match JSON schema
2. **Key validation** — event keys match the configured pattern
3. **Taxonomy validation** — required taxonomy fields are present
4. **Dictionary validation** — values match referenced dictionaries
5. **Rule validation** — fields pass all configured rules
6. **Path validation** — file paths match configured patterns

## Error Output

When validation fails, errors are displayed with:

- File path
- Error type
- Error message
- Suggested fix (when available)

```
✗ events/auth/login.yaml
  Key mismatch: expected "auth::login", got "auth::login_click"

✗ events/dashboard/view.yaml
  Missing required field: taxonomy.action

Found 2 errors in 42 events
```
