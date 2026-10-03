---
title: generate
description: Export your tracking plan to various formats.
sidebar:
  order: 4
---

# opentp generate

Exports your tracking plan with a generator: a JSON or YAML export, a file rendered from a template, or anything a plugin generator produces.

## Usage

```bash
opentp generate <name> [options]   # one generator, output on stdout or in --output
opentp generate [options]          # the generate.run entries of opentp.cli.yaml
```

The generator name may appear anywhere after `generate`, so `opentp generate -o events.json json` works too.

## Generators

| Name | Output |
|--------|-------------|
| `json` | The plan as JSON: header, field catalog, `spec.targets`, `spec.checks`, every event with its raw and effective payload, dictionaries |
| `yaml` | The same data as YAML |
| `template` | A text file rendered from a template (`--file`) |
| a plugin | Whatever it returns (see [Custom Generators](#custom-generators)) |

## Options

| Option | Description |
|--------|-------------|
| `--root <path>`, `-r <path>` | Project root directory |
| `--cli-config <path>` | The [`opentp.cli.yaml`](/cli/config) to use (default: the one in the project root) |
| `--output <path>`, `-o <path>` | Output file path, relative to `--root` (default: stdout) |
| `--pretty` / `--no-pretty` | Pretty print output (JSON generator; default: `--pretty`; the last one wins) |
| `--file <path>` | Template file path, relative to the current directory (template generator) |
| `--allow-plugins` | Load the plugins named in `opentp.cli.yaml` (`generate.plugins`, `keygen.plugins`) |
| `--external-generators <dir>` | Load custom generators (repeatable) |
| `--external-transforms <dir>` | Load custom transform steps used by `keygen` (repeatable). Needed when the keygen pipelines use custom steps, because an unknown step is a configuration problem and `generate` refuses to export the plan |
| `--verbose`, `-v` | Debug logs (on stderr) |

`--output`, `--file` and `--pretty` need a generator name: the `generate.run` entries set their own. `--external-*` directories are resolved against the current directory. Options of other commands (`--json`, `--fix`, `--external-rules`) are rejected with exit code `2`.

## Output

Without `--output`, the generator output is written to stdout byte for byte: `opentp generate json > events.json` produces the same file as `opentp generate json --output events.json`, and the built-in `json` and `yaml` outputs end with a newline. Log lines (such as `Generated file=...` for each written file) go to stderr, so piping into another tool (`opentp generate json | jq`) always gets complete, parseable output.

Every generator gets the events sorted by their file path, so the output does not depend on the order in which the file system lists them.

## generate.run

`opentp generate` without a name runs the entries of `generate.run` in `opentp.cli.yaml`, in order, and writes each output file:

```yaml
# opentp.cli.yaml
opentp: 2026-09

generate:
  run:
    - generator: json
      output: build/tracking-plan.json
    - generator: json
      target: web
      events: { area: auth }
      output: build/auth-web.json
      pretty: false
    - generator: template
      file: templates/events.md.tpl
      output: build/EVENTS.md
```

Each written file is logged on stderr as `Generated file="<absolute path>"`. `output` and `file` are relative to `opentp.cli.yaml` and must stay inside its directory: absolute paths, paths with a `.git` segment and paths that leave the directory (also through a symbolic link) stop the command with exit code `2`; `-o` and `--file` of `opentp generate <name>` are not limited. Every entry is checked before any of them runs, and every problem is reported (`opentp.cli.yaml: generate.run[<i>].<key>: ...`), so a bad entry never leaves half of the outputs refreshed. A `template` entry needs `file`. `target` keeps only the events whose payload covers that target (a selector of the payload names it, even when a version of it does not resolve), and `events` only the events whose taxonomy matches every listed field (a value or a list of values). See [generate](/cli/config#generate) for every key. Without entries, `opentp generate` exits with code `2` (`generate needs a generator name or generate.run entries in opentp.cli.yaml (e.g. opentp generate json)`).

## Exit codes

| Code | When |
|------|------|
| `0` | The output was written |
| `1` | The plan cannot be loaded completely (see below), or the generator failed |
| `2` | Missing or unknown generator name, invalid arguments, an `--external-*` directory that does not exist, `opentp.yaml` or `opentp.cli.yaml` missing or not usable, or a `generate.run` entry with an unknown generator, target id or taxonomy field, a `template` entry without `file`, a `file` that does not exist, or an `output` or `file` outside the directory of `opentp.cli.yaml` |

## Loading errors

`generate` does not validate events (run `opentp validate` for that), but it refuses to export a plan that it cannot load completely. It prints the problems to stderr, writes nothing to stdout or `--output`, and exits with code `1` when:

- `opentp.yaml` has a configuration problem (for example an invalid path template, a removed `2026-01` keyword, or a target group member that is not in `targets.all`);
- the `keygen` or `tracker` settings of `opentp.cli.yaml` have a problem (for example an unknown transform step);
- a dictionary file has an issue (YAML syntax error, missing or duplicate `dict.values`, wrong `opentp` version);
- an event file cannot be loaded (YAML syntax error, no `event` or `event.taxonomy` mapping).

```
[opentp.cli.yaml]
  ✗ keygen.transforms.slug[0]: Unknown transform step 'slugify' (custom steps: keygen.plugins in opentp.cli.yaml, or --external-transforms)
✗ Generation aborted: the tracking plan could not be loaded (run 'opentp validate') errorCount=1 eventCount=1
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
opentp generate markdown --external-generators ./tools/generators
opentp generate markdown --allow-plugins     # generate.plugins in opentp.cli.yaml
```

## Output Format

### JSON and YAML

The export has these top-level keys, in this order:

```bash
opentp generate json | jq 'keys_unsorted'
```

```json
[
  "opentp",
  "info",
  "catalog",
  "targets",
  "checks",
  "events",
  "dictionaries"
]
```

| Key | Content |
|---|---|
| `opentp`, `info` | From `opentp.yaml` |
| `catalog` | The field catalog, `spec.events.payload.schema` |
| `targets` | `spec.targets`: the common fields and settings of `all` and of each target |
| `checks` | `spec.checks`: the portable checks |
| `events` | Every event, sorted by file path: `key`, `taxonomy` (resolved: path values, `event.taxonomy` and fragments), `lifecycle` (when the event has one), `payload` (as written) and `effectivePayload` |
| `dictionaries` | Every dictionary by name (sorted), with its values |

`effectivePayload` is what the event sends on each target it covers, in `spec.events.payload.targets.all` order: the common fields of the target plus the fields the event lists, each merged over the catalog and the common fields (the same merge as validation, so an event field gets its type, enum and title from the catalog). For the [getting-started](/cli/getting-started) plan:

```bash
opentp generate json | jq '.events[0] | {key, payload, effectivePayload: {web: .effectivePayload.web}}'
```

```json
{
  "key": "auth::login_click",
  "payload": {
    "schema": {
      "event_name": {
        "value": "login_click"
      },
      "auth_method": {
        "required": true
      },
      "dimension_1": {}
    }
  },
  "effectivePayload": {
    "web": {
      "fields": {
        "event_name": {
          "type": "string",
          "policy": "fixed",
          "value": "login_click"
        },
        "auth_method": {
          "type": "string",
          "enum": [
            "email",
            "google",
            "github"
          ],
          "required": true
        },
        "dimension_1": {
          "type": "string",
          "name": "orgType",
          "title": "Organization Type",
          "example": "enterprise"
        }
      }
    }
  }
}
```

Per target:

| Payload | Effective payload of the target |
|---|---|
| Unversioned | `{ fields }` |
| Versioned | `{ fields, current, aliases, versions: { <version>: { fields, deprecated? } } }`: `fields` are those of the current version, `aliases` map an alias to a version, `deprecated: true` marks versions with `meta.deprecated` |

A target the event does not cover is not listed. A field the catalog defines but the event does not list is not part of the event. The YAML export writes the same data; a definition that appears twice is written twice (no YAML anchors).

### Template

The `template` generator renders a template file with a small mustache-like syntax:

| Syntax | Meaning |
|---|---|
| `{{a.b}}` | A value (objects are printed as JSON; missing values as nothing) |
| `{{#each events}}...{{/each}}` | Repeats the block for every item; inside it, the item's keys are available directly, plus `{{@index}}` |
| `{{#if a.b}}...{{/if}}` | Renders the block when the value is truthy |

Blocks cannot be nested in blocks of the same kind. The data is the JSON export above, plus `tracker` (the resolved [tracker binding](/cli/config#tracker), or `null`) and `config` (the whole `opentp.yaml`).

```
# {{info.title}}

{{#each events}}- `{{key}}`: {{taxonomy.action}} ({{effectivePayload.web.fields.event_name.value}})
{{/each}}
```

```bash
opentp generate template --file templates/events.md.tpl
```

```
# My App Tracking Plan

- `auth::login_click`: User clicks the login button (login_click)
- `auth::logout_click`: User clicks the logout button (logout_click)
```

## Custom Generators

A generator is a module whose default export (or `module.exports`) has a `name` and a `generate(context)` function that returns `{ stdout }` or `{ files: [{ path, content }] }` (or a promise of one):

```javascript
// tools/generators/markdown/index.js
module.exports = {
  name: "markdown",
  generate: (context) => {
    const lines = ["# Events", ""];
    for (const event of context.events) {
      const web = context.effective(event).web;
      const fields = web ? Object.keys(web.fields).join(", ") : "not sent on web";
      lines.push(`- ${event.key}: ${fields}`);
    }
    const content = `${lines.join("\n")}\n`;
    return context.options.output
      ? { files: [{ path: context.options.output, content }] }
      : { stdout: content };
  },
};
```

```bash
opentp generate markdown --external-generators tools/generators
```

```
# Events

- auth::login_click: event_name, auth_method, dimension_1
- auth::logout_click: event_name
```

The context:

| Member | Content |
|---|---|
| `config` | `opentp.yaml` as written |
| `events` | The loaded events, sorted by file path (`key`, `taxonomy`, `lifecycle`, `payload` as written, `relativePath`, ...) |
| `dictionaries` | A `Map` from dictionary name to its values |
| `options` | `output`, `file` and `pretty` from the command line or the `generate.run` entry |
| `effective(event)` | The event's effective payload per target and version (the `effectivePayload` of the export); a fresh copy on every call |
| `cliConfig` | The settings of `opentp.cli.yaml` in effect, read-only (`null` without the file) |
| `tracker` | The resolved [tracker binding](/cli/config#the-resolved-binding) per target id (`null` without a `tracker` section) |

Paths in `files` are relative to `--root` (absolute paths are used as they are); directories are created. A generator that throws fails the command (`Generator failed`, exit code `1`).

Load generators with `--external-generators <dir>` (resolved against the current directory, always loaded) or with `generate.plugins` in `opentp.cli.yaml` (resolved against that file, loaded only with `--allow-plugins` or `OPENTP_ALLOW_PLUGINS=1`; see [Plugins](/cli/config#plugins-and---allow-plugins)). Each `<dir>/<name>/index.js` is loaded as an ES module or a CommonJS module, depending on the nearest `package.json` (`"type": "module"` or not). A generator registers under its `name`; a plugin with the name of a built-in generator replaces it.

## Application repositories

In an application repository (`plan:` in `opentp.cli.yaml`), `generate` exports the pinned plan. `generate.run` outputs and templates resolve against the application's `opentp.cli.yaml`; `-o` of `opentp generate <name>` still resolves against `--root`. See [Application repositories](/cli/config#application-repositories).
