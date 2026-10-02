---
title: generate
description: Export your tracking plan to various formats.
sidebar:
  order: 3
---

# opentp generate

Exports your tracking plan to various output formats.

## Usage

```bash
opentp generate <target> [options]
```

The target (generator name) is required and may appear anywhere after `generate`, so `opentp generate -o events.json json` works too.

## Targets

| Target | Description | Output |
|--------|-------------|--------|
| `json` | JSON export | stdout (or `--output <file>`) |
| `yaml` | YAML export | stdout (or `--output <file>`) |
| `template` | Custom template | Configured output |

## Options

| Option | Description |
|--------|-------------|
| `--root <path>`, `-r <path>` | Project root directory |
| `--output <path>`, `-o <path>` | Output file path, relative to `--root` (default: stdout) |
| `--pretty` / `--no-pretty` | Pretty print output (JSON generator; default: `--pretty`; the last one wins) |
| `--file <path>` | Template file path, relative to the current directory (template generator) |
| `--external-generators <dir>` | Load custom generators (repeatable) |
| `--external-transforms <dir>` | Load custom transform steps used by `spec.events.x-opentp.keygen` (repeatable). Needed when the keygen pipelines use custom steps, because an unknown step is a configuration problem and `generate` refuses to export the plan |
| `--verbose`, `-v` | Debug logs (on stderr) |

`--external-*` directories are resolved against the current directory. Options of other commands (`--json`, `--fix`, `--external-rules`) are rejected with exit code `2`.

## Output

Without `--output`, the generator output is written to stdout byte for byte: `opentp generate json > events.json` produces the same file as `opentp generate json --output events.json`, and the built-in `json` and `yaml` outputs end with a newline. Log lines (such as `Generated file=...` for each written file) go to stderr, so piping into another tool (`opentp generate json | jq`) always gets complete, parseable output.

## Exit codes

| Code | When |
|------|------|
| `0` | The output was written |
| `1` | The plan cannot be loaded completely (see below), or the generator failed |
| `2` | Missing or unknown generator name, invalid arguments, an `--external-*` directory that does not exist, or `opentp.yaml` missing or not loadable |

## Loading errors

`generate` does not validate events (run `opentp validate` for that), but it refuses to export a plan that it cannot load completely. It prints the problems to stderr, writes nothing to stdout or `--output`, and exits with code `1` when:

- `opentp.yaml` has a configuration problem (for example an invalid path template, an unknown keygen pipeline, or a target group member that is not in `targets.all`);
- a dictionary file has an issue (YAML syntax error, missing or duplicate `dict.values`, wrong `opentp` version);
- an event file cannot be loaded (YAML syntax error, no `event` or `event.taxonomy` mapping).

```
[auth/logout_click.yaml]
  ✗ Invalid YAML at line 6, column 13: Nested mappings are not allowed in compact mappings
✗ ✗ Generation aborted: the tracking plan could not be loaded (run 'opentp validate') errorCount=1 eventCount=1
```

## Examples

### Export to JSON

```bash
opentp generate json
```

Prints JSON to stdout. Use `--output` to write a file.

### Export to YAML

```bash
opentp generate yaml
```

Prints YAML to stdout. Use `--output` to write a file.

### Custom output path

```bash
opentp generate json --output ./dist/events.json
```

### Using custom generators

```bash
opentp generate my-format --external-generators ./my-generators
```

External generators are loaded only via `--external-generators` (the spec does not include external plugin loading). The directory is resolved against the current directory, and each `<dir>/<name>/index.js` is loaded as an ES module or CommonJS module, depending on the nearest `package.json` (`"type": "module"` or not).

## Output Format

### JSON Output

```json
{
  "opentp": "2026-01",
  "info": {
    "title": "My App Tracking Plan",
    "version": "1.0.0"
  },
  "events": [
    {
      "key": "auth::login_click",
      "taxonomy": {
        "area": "auth",
        "event": "login_click",
        "action": "User clicks the login button"
      },
      "lifecycle": { "status": "active" },
      "payload": {
        "schema": {
          "event_name": { "value": "login_click" },
          "dimension_1": {
            "type": "string",
            "name": "orgType",
            "example": "enterprise"
          }
        }
      }
    }
  ],
  "dictionaries": {}
}
```

### YAML Output

```yaml
opentp: 2026-01
info:
  title: My App Tracking Plan
  version: 1.0.0
events:
  - key: auth::login_click
    taxonomy:
      area: auth
      event: login_click
      action: User clicks the login button
    lifecycle:
      status: active
    payload:
      schema:
        event_name:
          value: login_click
        dimension_1:
          type: string
          name: orgType
          example: enterprise
dictionaries: {}
```

## Custom Generators

Create custom generators for any output format:

```javascript
// my-generators/typescript/index.js
module.exports = {
  name: 'typescript',
  generate: async (context) => {
    const { config, events, dictionaries, options } = context;
    // Generate TypeScript SDK
    return {
      files: [
        { path: 'events.ts', content: '...' }
      ]
    };
  }
};
```

See [Custom Generators](/schema/extensibility#custom-generators) for details.
