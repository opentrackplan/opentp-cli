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
| `--external-rules <path>` | Load custom validation checks |
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

### With custom checks

```bash
opentp validate --external-rules ./my-rules
```

Loads additional validation checks from the specified directory.

## Validation Checks

The validator performs these checks:

1. **Key validation** — event keys match the configured pattern
2. **Taxonomy validation** — required fields + dict/enum + checks
3. **Payload validation** — targets/versioning merge + required fields + dict/enum + checks + PII
4. **Path extraction** — taxonomy variables extracted from file paths (based on the configured pattern)

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
