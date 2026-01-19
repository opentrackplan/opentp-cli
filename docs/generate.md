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

## Targets

| Target | Description | Output |
|--------|-------------|--------|
| `json` | JSON export | `opentp.events.json` |
| `yaml` | YAML export | `opentp.events.yaml` |
| `template` | Custom template | Configured output |

## Options

| Option | Description |
|--------|-------------|
| `--root <path>` | Project root directory |
| `--output <path>` | Output file path |
| `--external-generators <path>` | Load custom generators |

## Examples

### Export to JSON

```bash
opentp generate json
```

Creates `opentp.events.json` with all events.

### Export to YAML

```bash
opentp generate yaml
```

Creates `opentp.events.yaml` with all events.

### Custom output path

```bash
opentp generate json --output ./dist/events.json
```

### Using custom generators

```bash
opentp generate my-format --external-generators ./my-generators
```

External generators are loaded only via `--external-generators` (the spec does not include external plugin loading).

## Output Format

### JSON Output

```json
{
  "opentp": "2025-12",
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
          "event_name": { "value": "login_click" }
        }
      }
    }
  ],
  "dictionaries": {}
}
```

### YAML Output

```yaml
opentp: 2025-12
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
