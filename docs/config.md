---
title: opentp.cli.yaml
description: Settings of the opentp CLI next to opentp.yaml - key generation, check bindings, plugins, the tracker binding, generator runs, MCP tools and application repositories.
sidebar:
  order: 1
---

# opentp.cli.yaml

`opentp.yaml` describes the tracking plan: the OpenTrackPlan format, which every tool reads the same way. `opentp.cli.yaml` holds the settings of this CLI: how event keys are generated, how check ids that the plan uses are implemented, which plugins load, where fields travel in a tracker payload, what `opentp generate` writes and which MCP tools are served.

The file is optional, and the plan stays meaningful without it: these settings add checks or produce artifacts, but they never change which hits belong to an event or which values are valid.

## Example

```yaml
# yaml-language-server: $schema=https://opentp.dev/schemas/cli/opentp.cli.schema.json
opentp: 2026-09
cli: ">=0.10 <0.11"

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

checks:
  bindings:
    snake-case:
      rule: pattern
      params: "^[a-z][a-z0-9_]*$"
    ticket-exists:
      webhook:
        url: https://tickets.example.com/api/check
        headers:
          Authorization: "Bearer ${TICKETS_TOKEN}"
  severity:
    overlap: error

generate:
  run:
    - generator: json
      output: build/tracking-plan.json
    - generator: json
      target: web
      events: { area: auth }
      output: build/auth-web.json
      pretty: false

mcp:
  tools: [describe, search, validate]
```

## Where opentp finds it

- `--cli-config <path>` (every command accepts it) names the file, relative to the current directory. A file that does not exist is an error (exit code `2`).
- Otherwise opentp reads `opentp.cli.yaml` or `opentp.cli.yml` in the project root (`--root`, else `$OPENTP_ROOT`, else the current directory). Both in the same directory is an error (exit code `2`). Parent and home directories are not searched.
- In a project root without `opentp.yaml` (an [application repository](#application-repositories)), a file that cannot be found or read (both `.yaml` and `.yml`, a missing `--cli-config` file, a YAML syntax error, a file that is not a mapping) stops `validate`, `fix`, `generate` and `mcp` with that problem and exit code `2`; only a readable file without `plan:` gives `opentp.yaml not found`.

Relative paths inside the file (plugin directories, `generate.run` outputs and templates, `plan:`) resolve against the file's directory, not the current directory.

`opentp.yaml`, `opentp.yml`, `opentp.cli.yaml` and `opentp.cli.yml` in the plan root are never read as event or dictionary files, even when an events or dictionaries root is the plan root.

### Editor support

The first line of the example points YAML editors (through the YAML language server) to the JSON Schema of the file, for completion and inline errors:

```yaml
# yaml-language-server: $schema=https://opentp.dev/schemas/cli/opentp.cli.schema.json
```

The schema describes the shape of the file. The CLI checks more (for example that the fields named in `tracker` exist in the plan), so `opentp validate` stays the reference. The schema is published with each CLI release (`schemas/opentp.cli.schema.json` in the repository).

## Top-level keys

| Key | Meaning |
|---|---|
| `opentp` | Required. The OpenTrackPlan version of the plan; it must equal `opentp` in `opentp.yaml` |
| `cli` | The opentp versions that may run this plan, as an npm semver range (`">=0.10 <0.11"`) |
| `plan` | Only in an application repository: the plan this repository uses (see [Application repositories](#application-repositories)) |
| `keygen` | Event key generation (see [keygen](#keygen)) |
| `checks` | Check plugins, check bindings and the severity of tool rules (see [checks](#checks)) |
| `tracker` | Where each field travels in a tracker payload (see [tracker](#tracker)) |
| `generate` | Generator plugins and the runs of `opentp generate` (see [generate](#generate)) |
| `mcp` | The tool groups `opentp mcp` serves (see [mcp](#mcp)) |
| `x-*` | Your own data; opentp ignores it (`x-acme-owner: data-team`) |

Any other key stops `validate`, `fix`, `generate` and `mcp` with exit code `2` (`Unknown key 'foo' (extensions start with 'x-')`). `serve` and `search` are reserved for planned features (`'serve' is not supported yet`). The sections are strict too: an unknown key inside `keygen`, `checks`, `generate`, `mcp` or `tracker` is an error.

## opentp and cli

`opentp` must equal the plan's version, so the file cannot drift from the plan it configures:

```
✗ opentp.cli.yaml: opentp: '2026-01' does not match the plan's opentp '2026-09' (opentp.yaml)
```

`cli` pins the opentp versions that may run the plan, so that a repository and its CI use the same CLI. It is an npm semver range (`">=0.10 <0.11"`, `"^0.10.0"`, `"0.10.x"`); a pre-release of opentp (for example `0.10.1-rc.1`) is compared like any other version. Another opentp stops with exit code `2`:

```
✗ opentp.cli.yaml: cli: this plan needs opentp >=0.11, but this is opentp 0.10.0 (install a matching version, e.g. with OPENTP_VERSION)
```

Bump `cli` in the same commit as `OPENTP_VERSION` in CI and install scripts.

## keygen

Generates the expected `event.key` of every event from its taxonomy values. Key generation is a setting of this CLI, not part of the OpenTrackPlan format (in `2026-01` it was `spec.events.x-opentp.keygen` in `opentp.yaml`; `opentp migrate` moves it here).

```yaml
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
  plugins: [tools/transforms]   # custom steps; loaded only with --allow-plugins
```

| Key | Meaning |
|---|---|
| `template` | Required. The key template (grammar below) |
| `transforms` | Named pipelines: `<pipeline>: [<step>, ...]`. Each step is a step name (`lower`) or a mapping with one key, the step name, and its parameters (`replace: { from: " ", to: "_" }`). See [Transforms](/cli/transforms) for the built-in steps |
| `plugins` | Directories with custom transform steps (see [Plugins](#plugins-and---allow-plugins)) |

With `keygen`:

- `opentp validate` reports every event whose `event.key` differs from the generated key (`Key mismatch: got 'auth::login', expected 'auth::login_click'`), and every event whose key cannot be generated (`Cannot generate the expected key: Variable 'team' not found in variables`), at `event.key`. An `ignore` entry for `key` or `event.key` in the event silences both.
- `opentp fix` rewrites the keys that differ (see [fix](/cli/fix)).
- `opentp mcp` generates the key in `suggest_event` and checks it in `validate_event_draft`.

Without `keygen`, keys are checked only against `spec.events.key` in `opentp.yaml` (length, pattern, format) and for uniqueness, and `opentp fix` stops with exit code `2` (`fix needs keygen in opentp.cli.yaml`).

### Template grammar

- The template is literal text with placeholders. A placeholder is `{name}` or `{name | pipeline | pipeline ...}`; whitespace around the name and around `|` is ignored.
- `name` is a taxonomy field or a fragment of a composite taxonomy field declared in `spec.events.taxonomy`. Its value comes from the event's resolved taxonomy: values taken from the file path, values written in `event.taxonomy` and fragment values. Numbers and booleans become text as written (`2`, `false`).
- Each `pipeline` is a key of `keygen.transforms`. Pipelines run left to right, each on the output of the previous one, and each runs its steps in order.
- Everything outside placeholders is copied as is. `{` always starts a placeholder and the next `}` ends it; there is no escape, so a generated key cannot contain `{`.
- Use names that match `[A-Za-z_][A-Za-z0-9_]*` (any taxonomy field name works, but these stay portable).

These problems are reported once, as errors of `opentp.cli.yaml` at `keygen.*` paths; until they are fixed, no key is generated, `opentp fix` rewrites nothing and `opentp generate` refuses to run:

| Problem | Message |
|---|---|
| A `{` without a closing `}` | `keygen.template: Unclosed bracket in pattern: <template>` |
| An empty placeholder `{}` | `keygen.template: Empty variable in pattern: <template>` |
| A name that is not a taxonomy field or fragment | `keygen.template: Unknown variable '{owner}': keygen variables must be taxonomy fields or fragments declared in spec.events.taxonomy` |
| A pipeline that `transforms` does not define | `keygen.template: Unknown keygen pipeline 'nope'. Define it in keygen.transforms.` |
| A pipeline that is not a list | `keygen.transforms.slug: Keygen pipeline 'slug' must be a list of steps` |
| A step that is unknown or malformed | `keygen.transforms.slug[0]: Unknown transform step 'slugify' (custom steps: keygen.plugins in opentp.cli.yaml, or --external-transforms)` |

```
[opentp.cli.yaml]
  ✗ keygen.template: Unknown keygen pipeline 'nope'. Define it in keygen.transforms.
✗ Validation failed errorCount=1 warningCount=0 eventCount=1
```

An event that has no value for a placeholder (for example an optional taxonomy field it does not set) gets `Cannot generate the expected key: ...` at `event.key` instead; the other events are still checked.

## checks

Checks are named validations that the plan attaches to fields with `checks: { <id>: <params> }`. Some are defined in the plan itself (`spec.checks` in `opentp.yaml`, portable to every tool); the others are implemented by the tool. This section says how this CLI implements check ids. The full picture, with the built-in checks, is on the [Checks](/cli/rules) page.

```yaml
checks:
  plugins: [tools/checks]          # custom checks; loaded only with --allow-plugins
  bindings:
    snake-case:                    # the plan writes `snake-case: true`
      rule: pattern
      params: "^[a-z][a-z0-9_]*$"
    ticket-exists:                 # the plan writes `ticket-exists: true`
      webhook:
        url: https://tickets.example.com/api/check
        method: POST
        headers:
          Authorization: "Bearer ${TICKETS_TOKEN}"
        timeout: 5000
        retries: 1
        cache: 60000
  severity:
    overlap: error
    unknownCheck: warning
```

| Key | Meaning |
|---|---|
| `plugins` | Directories with custom checks (see [Plugins](#plugins-and---allow-plugins)) |
| `bindings.<id>` | A check id the plan can use: exactly one of `rule` (a built-in or plugin check, with default `params`) or `webhook` (an HTTP endpoint) |
| `severity.<rule>` | `off`, `warning` (the default) or `error` for the tool rules `overlap` and `unknownCheck` |

**Ids.** A binding id starts with a letter and contains only letters, digits, `_`, `.` and `-` (`acme.ticket-exists`). It must not be `webhook` (reserved), the name of a built-in or plugin check, or an id defined in `spec.checks`; a rule binding must name a check that exists. Each of these stops every command with exit code `2`:

```
✗ opentp.cli.yaml: checks.bindings.not-empty: 'not-empty' is already a built-in or plugin check; choose another id
✗ opentp.cli.yaml: checks.bindings.webhook: 'webhook' is reserved; give the binding another id
✗ opentp.cli.yaml: checks.bindings.short.rule: unknown rule 'no-such-rule' (built-in checks, or plugins from checks.plugins or --external-rules)
```

When `checks.plugins` are named but not loaded (no `--allow-plugins`), a rule binding to one of their checks is not an error: its id then counts as an unknown check.

**Rule bindings** give a check id default parameters: where the plan writes `snake-case: true`, the `pattern` check runs with `params`; where it writes other parameters, they replace `params`; `false` disables the check.

**Webhook bindings** send each checked value to a URL:

| Key | Meaning |
|---|---|
| `url` | Required. The endpoint |
| `method` | `GET`, `POST` (the default) or `PUT`; `GET` sends no body |
| `headers` | Request headers |
| `timeout` | Milliseconds per attempt (default `5000`) |
| `retries` | Extra attempts after a network error or timeout (default `0`) |
| `cache` | Milliseconds to reuse a result for the same value (default `0`: no cache) |

`url` and `headers` may read environment variables as `${NAME}`, but only the names listed in `OPENTP_WEBHOOK_ENV` in the environment of the run; see [Webhook checks](/cli/rules#webhook-checks) for the request, the response and the security model.

**Severity.** `checks.severity` sets the severity of the two tool rules for the whole plan; `--fail-on <rule>` on the command line wins over it (it reports the rule as an error). Warnings never change the exit code; errors make `validate` exit with code `1`. `off` turns a rule off (for `overlap`, the comparison does not run at all).

| Rule | Reports |
|---|---|
| `overlap` | Events whose payloads can match the same hit (see [Overlapping events](/cli/validate#overlapping-events)) |
| `unknownCheck` | A check id that is not in `spec.checks`, not a built-in or plugin check and not bound here |

## tracker

The `tracker` section says where each plan field travels inside a tracker payload: in which Snowplow
context, GA4 parameter, Amplitude property or Segment trait it is sent.

This is tool configuration, not part of the tracking plan. `opentp.yaml` describes events the way the
data lands (for a flat warehouse model, field names are its column names), and one plan can be sent by
several integrations: a web app through Snowplow, a backend through an HTTP collector, a partner
through GA4. Where a field sits in one tracker's payload is a property of that integration, so it
lives in `opentp.cli.yaml`. The binding never changes which hits belong to which event, which values
are valid, or event keys.

Generators receive the resolved binding as `context.tracker` (the `template` generator as `tracker`),
and `opentp mcp` shows it in `describe_plan`. The `json` and `yaml` exports do not include it.

### Example

```yaml
# opentp.cli.yaml
opentp: 2026-09

tracker:
  type: snowplow
  event: iglu:com.acme/event/jsonschema/1-0-0
  contexts:
    dimensions: iglu:com.acme/dimensions/jsonschema/1-0-0
  map:
    "dimension_*": contexts.dimensions   # a container: the field name is the leaf
    application_id: atomic.app_id
    platform: atomic.platform
    user_id: atomic.user_id
  setBy:
    app: [application_id, user_id]
    tracker: [platform]
  targets:
    ios:
      contexts:
        mobile_context: iglu:com.acme/mobile_context/jsonschema/1-0-0
      map:
        device_is_webview: contexts.mobile_context.isWebview
        os_version: contexts.mobile_context
```

With this binding, `dimension_1` travels in `contexts.dimensions.dimension_1`, `application_id` in
the atomic column `app_id`, and every field without an entry (for example `auth_method`) in the
event's own data, `event.auth_method`. On `ios`, `device_is_webview` and `os_version` travel in the
`mobile_context` context instead.

### Keys

| Key | Meaning |
|---|---|
| `type` | Required: `snowplow`, `ga4`, `amplitude`, `segment` or `generic`. Decides the path grammar, the containers and where fields without an entry go |
| `event` | `snowplow` only: the Iglu URI of the event schema (with another type: a validation error) |
| `contexts` | `snowplow` only: context (entity) schemas by alias, `<alias>: <Iglu URI>` (with another type: a validation error) |
| `map` | `<field or glob>: <path>`. Needed only where a field does not go to the default place |
| `setBy.app` | Fields (names or globs) that the application sets once, for example a user or application id |
| `setBy.tracker` | Fields (names or globs) that the tracker or the collector fills, for example the platform |
| `targets.<id>` | Overrides for one target: `map`, and for `snowplow` also `contexts`. `<id>` is a target id from `spec.events.payload.targets.all`; selector groups such as `mobile` are not accepted |

Map keys and `setBy` entries are field names or globs. In a glob, `*` matches any text, including
none (`dimension_*` matches `dimension_1` and `dimension_10`); every other character, `?` and `[`
included, matches itself. They match the catalog fields (`spec.events.payload.schema`) and the common
fields (`spec.targets.all.schema`, `spec.targets.<id>.schema`). In `targets.<id>.map` they match only
the catalog fields and the common fields of that target.

`setBy` keeps fields out of the parameters of generated tracking code. It does not change where a field
travels: `platform` above is filled by the tracker and still sent as `atomic.platform`.

Context aliases match `[A-Za-z_][A-Za-z0-9_-]*`, and Iglu URIs match
`iglu:<vendor>/<name>/jsonschema/<model>-<revision>-<addition>` (for example
`iglu:com.acme/dimensions/jsonschema/1-0-0`). An alias declared in `targets.<id>.contexts` exists only
on that target; one declared there with the same name as a global alias replaces its URI on that
target.

### Paths

A path written in `map` is a list of segments separated by `.`; every segment matches
`[A-Za-z_][A-Za-z0-9_-]*`. Each type allows these forms (`<name>`, `<column>` and `<alias>` are one segment, `<path>` is one or more):

| Type | Paths | Containers | Field `f` without an entry |
|---|---|---|---|
| `snowplow` | `atomic.<column>`, `event[.<path>]`, `contexts.<alias>[.<path>]` | `event`, `contexts.<alias>` | `event.f` |
| `ga4` | `params[.<name>]`, `user_properties[.<name>]`, `user_id`, `client_id`, `name` | `params`, `user_properties` | `params.f` |
| `amplitude` | `event_type`, `event_properties[.<name>]`, `user_properties[.<name>]`, `groups[.<name>]`, `group_properties[.<name>]`, `user_id`, `device_id` | `event_properties`, `user_properties`, `groups`, `group_properties` | `event_properties.f` |
| `segment` | `event`, `properties[.<name>]`, `traits[.<name>]`, `context[.<path>]`, `userId`, `anonymousId` | `properties`, `traits`, `context` | `properties.f` |
| `generic` | any path | none | `f` |

A `contexts.<alias>` path needs the alias in `contexts`, or in `targets.<id>.contexts` of every target
where the path is used.

### Containers

A path that ends at a container gets the field name as its last segment: `"dimension_*":
contexts.dimensions` sends `dimension_1` as `contexts.dimensions.dimension_1`, and `os_version:
contexts.mobile_context` sends `os_version` as `contexts.mobile_context.os_version`. Any other path is
used as written: `application_id: atomic.app_id`. Fields without an entry are appended to the default
container of the type (`generic` uses the field name alone).

The appended field name is one segment, whatever it contains, so a field keeps its wire name:
`Item Name` under `event_properties` (Amplitude) is `event_properties.Item Name`, and a field
`page.url` without an entry is the single segment `page.url` inside `event` (Snowplow). The resolved
binding lists the segments of every path (`segments`), so generators never split a field name at a
`.`; `path` joins them with `.` for display.

### Resolution order

For every target `T` and every catalog field and common field `f` of `T`, the first match wins:

1. `f` by name in `targets.T.map`;
2. `f` by name in `map`;
3. a glob in `targets.T.map` that matches `f`;
4. a glob in `map` that matches `f`;
5. no match: the default place of the type (table above).

So a name in the global `map` wins over a glob in `targets.T.map`. Two globs of the same step that
match `f` and give different paths are an error; globs that give the same path are fine.

### Problems

Shape problems stop every command with exit code 2, like every other `opentp.cli.yaml` shape problem:
unknown keys, values of the wrong type, a missing or unknown `type`.

The binding is then checked against the plan. Its problems are validation errors of `opentp.cli.yaml`
at a `tracker.<...>` path: `opentp validate` lists them and exits 1, `opentp fix` rewrites no key,
`opentp generate` refuses to run, and the MCP tool `validate_plan` lists them. They are:

- a map key or `setBy` entry that names no catalog or common field (in `targets.<id>.map`: no field of
  that target), or a glob that matches none;
- a field in both `setBy.app` and `setBy.tracker`;
- `event`, `contexts` or `targets.<id>.contexts` with a type other than `snowplow`;
- a path written in a map that does not fit the grammar of the type;
- an `event` or context URI that is not an Iglu URI, and a context alias that is not a valid segment;
- a context alias that is not declared for a target where it is used;
- a `targets` key that is not a target id from `spec.events.payload.targets.all`;
- two globs of the same resolution step that give one field different paths;
- two fields with the same path on a target, or a field whose path lies inside another field's path
  (`user` and `user.id`), because one of them would have to be an object. Paths are compared by
  segments: a field `page.url` (one segment) does not collide with a field mapped to `page.url`
  (two segments).

```
[opentp.cli.yaml]
  ✗ tracker.map.usr_id: Unknown field 'usr_id': expected a catalog field (spec.events.payload.schema) or a common field (spec.targets). Did you mean 'user_id'?
  ✗ tracker.map.device_is_webview: Context alias 'mobile_context' is not declared in tracker.contexts or tracker.targets.<id>.contexts (target: web)
  ✗ tracker.map.auth_method: Fields 'auth_method' and 'step_index' map to the same path 'event.step_index' (targets: web, ios, android)
✗ Validation failed errorCount=3 warningCount=0 eventCount=2
```

### In application repositories

With `plan:` (application repository mode), the `tracker` section of the plan repository's
`opentp.cli.yaml` is the base, and the application's own `tracker` section is merged over it.
Mappings (`map`, `contexts`, `setBy`, `targets` and the mappings inside them) merge key by key and the
application wins; lists (`setBy.app`, `setBy.tracker`) and single values (`event`) are replaced. The
application's section needs its own `type`; when it names a different `type`, it replaces the plan
repository's section completely, because the paths of one type mean nothing to another. A problem at
a key that only the plan repository's section has is labelled `opentp.cli.yaml of the plan '<plan>'`
(see [What comes from where](#what-comes-from-where)).

### The resolved binding

Generators get the binding per target id as `context.tracker` (`null` without a `tracker` section):
every catalog field and every common field of the target with its final path (`segments`, and `path`
for display) and, for `setBy` fields, who sets it. For `ios` in the example above, in a plan whose catalog and common fields on `ios` are
`application_id`, `auth_method`, `device_is_webview`, `dimension_1`, `dimension_2`, `event_name`,
`os_version`, `platform`, `step_index` and `user_id`:

```json
{
  "type": "snowplow",
  "event": "iglu:com.acme/event/jsonschema/1-0-0",
  "contexts": {
    "dimensions": "iglu:com.acme/dimensions/jsonschema/1-0-0",
    "mobile_context": "iglu:com.acme/mobile_context/jsonschema/1-0-0"
  },
  "fields": {
    "application_id": { "path": "atomic.app_id", "segments": ["atomic", "app_id"], "setBy": "app" },
    "auth_method": { "path": "event.auth_method", "segments": ["event", "auth_method"] },
    "device_is_webview": { "path": "contexts.mobile_context.isWebview", "segments": ["contexts", "mobile_context", "isWebview"] },
    "dimension_1": { "path": "contexts.dimensions.dimension_1", "segments": ["contexts", "dimensions", "dimension_1"] },
    "dimension_2": { "path": "contexts.dimensions.dimension_2", "segments": ["contexts", "dimensions", "dimension_2"] },
    "event_name": { "path": "event.event_name", "segments": ["event", "event_name"] },
    "os_version": { "path": "contexts.mobile_context.os_version", "segments": ["contexts", "mobile_context", "os_version"] },
    "platform": { "path": "atomic.platform", "segments": ["atomic", "platform"], "setBy": "tracker" },
    "step_index": { "path": "event.step_index", "segments": ["event", "step_index"] },
    "user_id": { "path": "atomic.user_id", "segments": ["atomic", "user_id"], "setBy": "app" }
  }
}
```

`event` appears only for `snowplow` with an event schema, and `contexts` is empty for the other
types. Fields are in natural order (`dimension_2` before `dimension_10`).

## generate

```yaml
generate:
  plugins: [tools/generators]      # custom generators; loaded only with --allow-plugins
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

| Key | Meaning |
|---|---|
| `plugins` | Directories with custom generators (see [Plugins](#plugins-and---allow-plugins)) |
| `run` | What `opentp generate` without a generator name runs, in order |

Each `run` entry:

| Key | Meaning |
|---|---|
| `generator` | Required. `json`, `yaml`, `template` or a plugin generator |
| `output` | Required. The output file, relative to this file's directory and inside it; directories are created |
| `file` | The template file of the `template` generator (required there), relative to this file's directory and inside it |
| `pretty` | `false` writes compact JSON (`json` generator; default `true`) |
| `target` | Only events whose payload covers this target id (from `spec.events.payload.targets.all`): a selector of the payload names it, even when its `current` or a `$ref` does not resolve. The events keep all their targets in the output |
| `events` | Only events whose taxonomy matches every listed field: `<field>: <value>` or `<field>: [<value>, ...]`. Fields are taxonomy fields or fragments; values compare by type and value (`2` is not `"2"`) |

`opentp generate` without a name runs every entry and writes each output; `opentp generate <name>` ignores the entries. It checks every entry before it runs any, and reports every problem it finds, each naming its entry and key; any problem stops the command with exit code `2` before anything is written:

- an unknown generator (`generate.run[3].generator: unknown generator 'sql' (available: json, yaml, template)`), target id or taxonomy field;
- a `template` entry without `file` (`generate.run[1].file: the template generator needs a template file`), or a `file` that does not exist;
- an `output` or `file` outside the directory of `opentp.cli.yaml`.

**Paths stay inside the directory of `opentp.cli.yaml`.** `opentp generate` writes these outputs and reads these templates without any consent flag, so `output` and `file` must not be absolute, must not contain a `.git` segment (in any letter case), and must not leave the directory once symbolic links are resolved:

```
✗ opentp.cli.yaml: generate.run[0].output: '../shared/plan.json' leaves the directory of opentp.cli.yaml (/work/app)
✗ opentp.cli.yaml: generate.run[1].output: '.git/hooks/pre-commit' is inside a .git directory
✗ opentp.cli.yaml: generate.run[2].file: '/etc/hosts' is an absolute path: write a path relative to the directory of opentp.cli.yaml
```

No option lifts this, `--allow-plugins` included. To write somewhere else, name the file on the command line, where you chose it: `opentp generate json -o ../shared/plan.json` (`-o` and `--file` are not limited).

The MCP tool `generate` can run an entry by its index and returns the text without writing it; it applies the same checks to the entry's `file` (an error result names `generate.run[<i>].file`). See [generate](/cli/generate).

## mcp

```yaml
mcp:
  tools: [describe, search, validate]
```

| Key | Meaning |
|---|---|
| `tools` | The tool groups `opentp mcp` serves (default: all four); at least one (`[]` is an error, exit code `2`) |
| `write` | Reserved for write tools: only `false` is accepted; `true` stops every command with exit code `2` (`mcp.write: write tools are not supported yet`), and the JSON Schema rejects it too |

| Group | Tools and resources |
|---|---|
| `describe` | `describe_plan`, `get_event`, `list_dictionaries`, `get_dictionary`, `suggest_event`, the resources `opentp://plan/summary` and `opentp://events/{key}` |
| `search` | `search_events` |
| `validate` | `validate_event_draft`, `validate_plan` (they run the plan's checks, including webhook bindings for the files on disk) |
| `generate` | `generate` |

`opentp mcp` reads the `mcp` section once, when it starts; the other sections are reloaded with the plan when a file changes. See [mcp](/cli/mcp).

## Plugins and --allow-plugins

Plugins are JavaScript modules that run with the rights of the user who runs opentp: custom transform steps for `keygen` (`keygen.plugins`), custom checks (`checks.plugins`) and custom generators (`generate.plugins`). Each entry is a directory, relative to `opentp.cli.yaml`; every `<dir>/<name>/index.js` in it is loaded as an ES module or a CommonJS module, depending on the nearest `package.json`.

A plugin directory named in `opentp.cli.yaml` is part of the repository, so anyone who can change the repository could make every developer and every CI job run new code. opentp therefore loads them only when the person or job that runs opentp agrees:

- `--allow-plugins` on the command line (`validate`, `fix`, `generate`, `mcp`), or
- `OPENTP_ALLOW_PLUGINS=1` in the environment.

Without either, opentp prints one warning and runs without the plugins: their checks count as unknown checks (a warning), and a keygen pipeline or a `generate.run` entry that needs them fails as if they did not exist.

```
⚠ opentp.cli.yaml names plugins (tools/transforms, tools/checks); they were not loaded: pass --allow-plugins or set OPENTP_ALLOW_PLUGINS=1
✓ All events are valid count=1
```

Each command loads only what it uses: `validate` and `fix` load `keygen.plugins` and `checks.plugins`; `generate` loads `keygen.plugins` and `generate.plugins`; `mcp` loads `keygen.plugins` and `checks.plugins` (its `generate` tool runs only the built-in generators); `migrate` loads none. With plugins allowed, a named directory that does not exist stops the command with exit code `2`.

The `--external-rules`, `--external-transforms` and `--external-generators` options always load: whoever types them has agreed. They resolve against the current directory and can be combined with the plugins of `opentp.cli.yaml`.

**Recommendation.** Review plugin code like any other code that runs in CI, and protect it with your code host's ownership rules. On GitHub, a `CODEOWNERS` file can require a review by your tracking-plan maintainers for every change to the settings and the plugins:

```
# .github/CODEOWNERS
/opentp.cli.yaml  @acme/tracking-plan-maintainers
/opentp.cli.yml   @acme/tracking-plan-maintainers
/tools/           @acme/tracking-plan-maintainers
```

Set `OPENTP_ALLOW_PLUGINS=1` only in CI jobs whose code is reviewed that way, and never in jobs that run on untrusted changes (for example pull requests from forks).

## Trust

`opentp.cli.yaml` is part of a repository, so whoever can change the repository decides what it says. Without `--allow-plugins` (or `OPENTP_ALLOW_PLUGINS=1`) it runs no code, but it can still make opentp do the following, so review changes to it like build configuration:

- **Call webhooks** of the plan repository itself (`checks.bindings.<id>.webhook`): `validate`, `fix` and the MCP tools that validate the files on disk send checked values to the binding's URL with its headers. `${NAME}` in them reads only the variables that `OPENTP_WEBHOOK_ENV` lists in the environment of the run, so keep secrets out of that list in jobs that run on untrusted changes. Drafts (`validate_event_draft`) never call webhooks, and in an [application repository](#application-repositories) the plan repository's webhook bindings never run.
- **Write files with `generate.run`**: `opentp generate` without a generator name writes every `output` and reads every template `file`, but only inside the directory of `opentp.cli.yaml` (see [generate](#generate)). Inside it an entry can overwrite any file, also one that git does not track and that another tool runs later (for example under `node_modules`). In a job that runs on untrusted changes, run `opentp generate` after the tools that could run such files, or not at all.
- **Fetch a plan** (`plan:` in an application repository): opentp fetches the named git repository with your git credentials into the cache. Nothing from it runs: its plugins and webhook bindings are ignored.

Plugins (`keygen.plugins`, `checks.plugins`, `generate.plugins`, see [Plugins](#plugins-and---allow-plugins)) and plugin generators can do anything the user can, which is why they need `--allow-plugins`.

## Application repositories

An application repository uses a tracking plan that lives in another repository: it generates code from it, or searches it with `opentp mcp`, but does not hold it. Its `opentp.cli.yaml` names the plan with `plan:`, and it has no `opentp.yaml` of its own:

```yaml
# opentp.cli.yaml of an application repository
opentp: 2026-09
plan: git+ssh://git@example.com/acme/tracking-plan.git#v1.4.0

tracker:
  type: snowplow
  map:
    step_index: contexts.dimensions

generate:
  run:
    - { generator: json, target: web, events: { area: auth }, output: build/tracking-plan.json }
```

`opentp validate`, `opentp generate` and `opentp mcp` then work on that plan. An `opentp.yaml` in the project root together with `plan:` is an error (exit code `2`): a plan repository must not name another plan.

### plan:

- **A local directory**: absolute, or relative to the directory of `opentp.cli.yaml` (`plan: ../tracking-plan`; `/` and `\` both work). The directory must hold `opentp.yaml`. It is read as it is, so it can be a git submodule or a checkout made by CI.
- **A git URL**: `git+ssh://`, `git+https://` or `git+file://`, then the repository URL, then `#` and a **tag** or a full 40-character **commit SHA**:

  ```yaml
  plan: git+ssh://git@example.com/acme/tracking-plan.git#v1.4.0
  # or a commit:
  # plan: git+https://example.com/acme/tracking-plan.git#4fbebf857ff6b00b019b7544e15f86a243d09ad3
  ```

  A branch is refused, because a branch moves and the plan would change under the application: `plan ref must be a tag or a commit SHA: 'main' is not a tag of <url>`. A URL without `git+` (`https://...`, `git@host:org/repo.git`) is refused with a hint that shows the `git+` form. The 40 characters may also be the id of an annotated tag object (what `git rev-parse <tag>` prints for an annotated tag): the commit it points to is used.

### The cache

A git plan is cloned once, with the `git` on your `PATH`, into the cache:

| | Cache root |
|---|---|
| `OPENTP_CACHE_DIR` set | that directory |
| Linux and other systems | `$XDG_CACHE_HOME/opentp`, or `~/.cache/opentp` |
| macOS | `~/Library/Caches/opentp` |
| Windows | `%LOCALAPPDATA%\opentp\Cache` |

Each clone lives in `<root>/plans/<16 hex characters>` (the start of the SHA-256 of `<url>#<ref>`, with the URL written without `git+`). The first run logs `Fetching the plan <url> ref=<ref> cache=<dir>` on stderr (with the user information of the URL shown as `***`). A cached ref is never refreshed and needs no network and no `git`: a tag or a commit names fixed content. To fetch a ref again (for example a tag that was moved), delete its directory or the whole cache. Runs that start at the same time are safe: each clones into a new `opentp-plan-*` directory in the system's temporary directory and then moves the clone into place (when the cache is on another file system, it copies the clone next to its place first and renames the copy), and the slower run uses the clone of the faster one. A run that is killed during the clone can leave an `opentp-plan-*` directory in the temporary directory, or a `<dir>.tmp-*` directory in the cache, behind; delete it (deleting the cache removes the second kind).

In CI, cache the directory between jobs (or set `OPENTP_CACHE_DIR` to a cached path) to skip the clone. The cache directory must not be inside a checkout of untrusted changes (for example the working tree of a pull request): opentp uses whatever it finds under `plans/` as the pinned plan without fetching it, so such a change could replace the plan. Keep `OPENTP_CACHE_DIR` outside the checkout (for example in the runner's temporary or tool cache directory) and restore the CI cache there.

### git access

opentp runs `git` without a shell and without terminal prompts (`GIT_TERMINAL_PROMPT=0`), with a 120-second limit per git command, and without the git variables of a surrounding repository (so it also works inside a git hook). git's own error output is printed and the command exits with code `2`.

git runs only in a new, empty directory in the system's temporary directory, never in the current directory or in the cache, so nothing that a checkout under review contains reaches it: not a repository that git would otherwise find there and whose configuration it would read (a committed bare repository layout can set `core.sshCommand`, a command that git runs), and on Windows not a `git.exe` that would be found before the one on your `PATH`. `GIT_CEILING_DIRECTORIES` keeps git from looking above that directory, the clone is created inside it and named explicitly in every later git command, and every git command gets `-c safe.bareRepository=explicit` (git 2.38 and later then never use a bare repository they find on their own).

- **SSH** must work without a prompt: use key-based authentication with an agent or a key without a passphrase. ssh can still ask for a passphrase or a host key, which waits until the time limit. In CI, set `GIT_SSH_COMMAND="ssh -o BatchMode=yes"` (or `BatchMode yes` for the host in `~/.ssh/config`) so that ssh fails at once instead, and add the host key to `known_hosts`.
- **HTTPS** uses your git credential helper; there is no prompt for a user name or password. Do not write a token into the URL (`git+https://user:<token>@example.com/...`): `opentp.cli.yaml` is committed, and the URL also names the cache directory. Configure a credential helper instead (in CI, for example, the credentials that the checkout step sets up, or `git config --global credential.helper`). opentp shows the user information of a plan URL as `***` in every message and log line (`https://***@example.com/acme/tracking-plan.git`), and hides it in git's output too. The URL is not stored in the cached clone: opentp fetches from the URL without adding a remote to the clone's git configuration, and removes `FETCH_HEAD`.
- **Tags** are resolved with `git ls-remote --tags` to the object id that `refs/tags/<tag>` names, and that id is fetched (`git fetch --depth 1 <url> <id>`, then `git checkout`). A branch with the same name as the tag is never used, and the checked-out commit must be the tag's commit (for an annotated tag, the commit it points to), or the command stops with exit code `2`.
- **Commit SHAs** are fetched with `git fetch --depth 1 <url> <sha>`, and the checked-out commit must be the one the SHA names (for the id of an annotated tag object, the commit that the tag points to). The server must allow fetching a commit by its SHA: GitHub, GitLab and servers that speak git protocol version 2 do; an older self-hosted server may need `uploadpack.allowReachableSHA1InWant=true`. A SHA that the server refuses or that does not exist fails with git's message (for example `Server does not allow request for unadvertised object <sha>`). A tag works everywhere.

### What comes from where

The plan repository's own `opentp.cli.yaml` (if it has one) contributes only:

- `tracker`: the application's section is merged over it (see [tracker](#in-application-repositories));
- `checks.bindings` (only rule bindings) and `checks.severity`: merged by id; the application's entries win.

`keygen`, `checks.plugins`, `generate`, `mcp` and `plan` come only from the application's file. Nothing from the plan repository is executed or written:

- Its plugins never load (a warning lists them, and checks bound to their rules count as unknown checks).
- Its webhook bindings never run. Their URL and headers are chosen by the plan repository, while `OPENTP_WEBHOOK_ENV` and the secrets it allows belong to the application's run, and a new plan ref would show up in the application's diff only as a changed tag. A warning lists them, and a check that uses one counts as an unknown check: `Unknown check 'ticket-exists': its webhook binding comes from the plan repository's opentp.cli.yaml and is not run in an application repository`. To run such a check in the application repository, bind the id in the application's own file.

```
⚠ opentp.cli.yaml of the plan 'git+ssh://***@example.com/acme/tracking-plan.git#v1.4.0' names webhook bindings (ticket-exists); webhook bindings of the plan repository never run in an application repository (checks bound to them count as unknown checks)
```

Both files must have the plan's `opentp`, and the running opentp must satisfy the `cli` range of both. Problems in the plan repository's file are labelled `opentp.cli.yaml of the plan '<plan>'`. That includes [tracker](#in-application-repositories) problems at a key that only the plan repository's file has, for example `event` on a tracker type other than `snowplow` there, or a `map` entry for a field the plan does not have. Like every tracker problem they are validation errors (exit code `1`), listed under that label:

```
[opentp.cli.yaml of the plan '../tracking-plan']
  ✗ tracker.event: 'event' is only allowed for tracker type snowplow
```

A tracker problem at a key that the application's file writes (also when the plan repository's file has the same key), or one that comes from both sections together (for example a field in `setBy.app` of one file and `setBy.tracker` of the other), is labelled `opentp.cli.yaml`.

### What is different

- **No key checks.** Keys are checked and fixed in the plan repository. `keygen` in an application's file is ignored, with one warning: `opentp.cli.yaml: keygen is ignored in an application repository (plan:): event keys are checked and fixed in the plan repository`. Duplicate keys are still reported.
- **`opentp fix` and `opentp migrate` refuse to run** (exit code `2`): `fix edits the plan repository; run it there (opentp.cli.yaml has plan:)`.
- **A pinned plan on 2026-01** stops every command with exit code `2`: `The pinned plan <plan> uses OpenTrackPlan 2026-01; opentp 0.10.0 reads 2026-09. Pin a plan ref that is on 2026-09 (or keep opentp 0.9.1: OPENTP_VERSION=0.9.1).` An event or dictionary file of a `2026-09` plan that is still on `2026-01` gets the version error plus `Pin a plan ref whose files are all on 2026-09.` (not the migrate hint).
- **Paths**: `plan:`, `generate.run` outputs and templates and plugin directories resolve against the application's `opentp.cli.yaml`; `opentp generate <name> -o <file>` still resolves `-o` against `--root`.
- **`opentp mcp`** serves the pinned plan and reloads it when the plan's files or either `opentp.cli.yaml` change. If the plan cannot be found or fetched when the server starts, it exits with code `2`.

## Errors and exit codes

Problems with `opentp.cli.yaml` fall into three classes:

| Class | Examples | Effect |
|---|---|---|
| The file cannot be used | YAML syntax errors; YAML merge keys (a plain `<<` key, anywhere in the file; a quoted `"<<"` is an ordinary key); wrong shape (unknown keys, wrong types, a missing `opentp`); both `.yaml` and `.yml`; `--cli-config` names no file; `opentp` differs from the plan's; `cli` is not a valid range or does not match this opentp; `mcp.write: true`; an empty `mcp.tools`; invalid `checks.bindings`; a `plan:` that cannot be found or fetched; `plan:` next to an `opentp.yaml`; a missing plugin directory (with plugins allowed); for `opentp generate`, a `generate.run` entry with an unknown generator, target or taxonomy field, a missing template `file`, or an `output` or `file` outside the directory of `opentp.cli.yaml` | `validate`, `fix`, `generate` and `mcp` stop before they read events, with exit code `2`. The problems are printed on stderr, one per line, starting with `opentp.cli.yaml:` |
| A setting does not fit the plan | `keygen` problems; `tracker` problems | Validation errors of `opentp.cli.yaml` (in an application repository, a tracker problem at a key that only the plan repository's file has is labelled `opentp.cli.yaml of the plan '<plan>'`): `opentp validate` exits with code `1`, `opentp fix` rewrites no key, `opentp generate` and the MCP tool `generate` refuse to run, `validate_plan` lists them |
| A warning | plugins named but not allowed; `keygen` in an application repository; plugins and webhook bindings of a plan repository | One line on stderr; the command continues |

```
✗ opentp.cli.yaml: serve: 'serve' is not supported yet
✗ opentp.cli.yaml: foo: Unknown key 'foo' (extensions start with 'x-')
```

The labels are literal: problems are reported as `opentp.cli.yaml` whatever the file is called (`opentp.cli.yml`, or another name given with `--cli-config`).

`opentp migrate` checks the shape of an existing file before it changes anything: a shape problem stops it with exit code `2` (the same lines as above), and nothing is written. It also refuses a file with `plan:` (an application repository), and otherwise merges only the sections it moves (`keygen`, `checks.bindings`); run `opentp validate` afterwards.
