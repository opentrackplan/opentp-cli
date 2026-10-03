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
| `--root <path>`, `-r <path>` | Project root directory |
| `--verbose`, `-v` | Debug logs (on stderr) |
| `--json` | Print the result as one JSON document on stdout |
| `--fix`, `-f` | Rewrite event keys first (same as `opentp fix`) |
| `--external-rules <dir>` | Load custom validation checks (repeatable) |
| `--external-transforms <dir>` | Load custom keygen transform steps (repeatable) |

`--external-*` directories are resolved against the current directory. A directory that does not exist is a usage error (exit code `2`). Any other option (for example `--output`) is rejected with exit code `2`.

## Examples

### Basic validation

```bash
opentp validate
```

Output (on stderr):

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

Adds debug lines (config, dictionaries and events loaded) to stderr.

### With custom checks

```bash
opentp validate --external-rules ./my-rules
```

Loads additional validation checks from the specified directory (see "Custom Checks" on the Rules page).

### In CI or scripts

```bash
opentp validate --json > report.json
```

stdout holds only the JSON document, also with `--verbose`; logs stay on stderr.

## Validation Checks

The validator performs these checks:

1. **Loading** — every event file that matches `spec.paths.events.template` must be valid YAML with an `event` mapping and an `event.taxonomy` mapping; every dictionary file must be valid YAML (see [Broken files and configuration problems](#broken-files-and-configuration-problems))
2. **Configuration** — `opentp.yaml` itself (templates, regexes, keygen, target ids, taxonomy dictionaries); each problem is reported once, against `opentp.yaml`
3. **Key validation** — `event.key` is required; optional constraints via `spec.events.key`; optional expected-key check if `spec.events.x-opentp.keygen` is configured
4. **Uniqueness** — event keys must be unique across the plan
5. **Taxonomy validation** — required fields + dict/enum + JSON-Schema-like constraints + `x-opentp.checks`
6. **Payload validation** — target selector resolution + versioning (`aliases`, `$ref`) + merge semantics + constraints + `x-opentp.checks` + PII
7. **Path extraction** — taxonomy variables extracted from file paths (based on `spec.paths.events.template`)

## Broken files and configuration problems

The CLI fails closed: anything it cannot read is an error, never a silent skip. `validate` (and `fix`) exits with code `1` when:

- An event file has a YAML syntax error (reported with its line and column), is empty, or has no `event` or `event.taxonomy` mapping. The file is not loaded, so it is not counted in `count=` / `eventCount=`.
- A dictionary file has a YAML syntax error or is not a mapping.
- The expected key cannot be generated for an event (for example, a keygen variable has no value for it). The event is still validated; the error is reported at `event.key` (an `ignore` entry for `event.key` suppresses it).
- A check in `x-opentp.checks` (built-in or loaded with `--external-rules`) throws. The error `check <name> failed: <message>` is reported for that field, and the run continues.
- A payload selector covers no target listed in `spec.events.payload.targets.all`.
- `opentp.yaml` has one of these problems, each reported once (not once per event file):
  - `spec.paths.events.template` has an unclosed, empty, invalid (not an identifier) or duplicate placeholder, or uses transforms. No event file is loaded.
  - `spec.paths.events.root` does not exist.
  - `spec.events.x-opentp.keygen.template` is missing or invalid, names a pipeline that is not defined in `keygen.transforms`, or uses a variable that is not a taxonomy field or fragment; a pipeline is not a list of steps; a step is unknown (not built in and not loaded with `--external-transforms`) or malformed (not a step name or a single-key mapping), reported at `spec.events.x-opentp.keygen.transforms.<pipeline>[<index>]`. Keys are not generated (and `fix` does not rewrite any key) until this is fixed.
  - A taxonomy or fragment `dict` names a dictionary that does not exist (`Unknown dictionary`).
  - An invalid regex in `spec.events.key.pattern` or a taxonomy `pattern`, an unusable composite `template`, or a taxonomy field definition that is not a mapping.
  - A group in `spec.events.payload.targets` lists a target that is not in `targets.all`, or a key of `spec.targets` is not in `targets.all`.

Files under the events root that do not match `spec.paths.events.template` are not event files and are ignored.

`validate` exits with code `2` instead, without a report, when it cannot start: `opentp.yaml` is missing or cannot be loaded (YAML syntax error, an `opentp` version other than `2026-01`, missing required fields), an `--external-*` directory does not exist, the arguments are invalid, or `OPENTP_LOG_LEVEL` is not a valid level.

## Error Output

Errors are grouped by file: event files are shown relative to the events root, dictionary files as `dictionaries/<file>`, and configuration problems under `opentp.yaml`. Each line shows the check path and the message; problems with the whole file (such as YAML syntax errors) have no path. The report goes to stdout and the final `✗ Validation failed` summary to stderr.

```
[auth/logout_click.yaml]
  ✗ Invalid YAML at line 6, column 13: Nested mappings are not allowed in compact mappings

[opentp.yaml]
  ✗ spec.events.taxonomy.area.dict: Unknown dictionary 'taxonomy/areas'

[auth/login_click.yaml]
  ✗ event.key: Key does not match pattern "^[a-z0-9_]+::[a-z0-9_]+$"
✗ Validation failed errorCount=3 eventCount=1
```

With `--json`, the same errors are printed to stdout as `{ "success": false, "events": <loaded event count>, "errors": [{ "event", "path", "message", "severity" }] }`; the `path` of a file-level problem is an empty string. No summary line is printed. When `validate` exits with code `2`, stdout is empty.
