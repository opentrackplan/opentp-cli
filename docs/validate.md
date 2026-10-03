---
title: validate
description: Validate all events in your tracking plan.
sidebar:
  order: 2
---

# opentp validate

Validates the tracking plan: `opentp.yaml`, the dictionaries, every event file, and the settings in `opentp.cli.yaml` that depend on the plan. `validate` is the default command, so `opentp` alone runs it.

## Usage

```bash
opentp validate [options]
```

## Options

| Option | Description |
|--------|-------------|
| `--root <path>`, `-r <path>` | Project root directory |
| `--cli-config <path>` | The [`opentp.cli.yaml`](/cli/config) to use (default: the one in the project root, if there is one) |
| `--verbose`, `-v` | Debug logs (on stderr) |
| `--json` | Print the result as one JSON document on stdout |
| `--fail-on <rule>[,<rule>...]` | Report these tool rules as errors: `overlap`, `unknownCheck` (repeatable). Wins over `checks.severity` in `opentp.cli.yaml` |
| `--fix`, `-f` | Rewrite event keys first (same as `opentp fix`) |
| `--allow-plugins` | Load the plugins named in `opentp.cli.yaml` (`keygen.plugins`, `checks.plugins`); same as `OPENTP_ALLOW_PLUGINS=1` |
| `--external-rules <dir>` | Load custom checks (repeatable) |
| `--external-transforms <dir>` | Load custom keygen transform steps (repeatable) |

`--external-*` directories are resolved against the current directory and always load. A directory that does not exist is a usage error (exit code `2`). Any other option (for example `--output`) is rejected with exit code `2`.

## Examples

### Basic validation

```bash
opentp validate
```

Output (on stderr):

```
✓ All events are valid count=1
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
opentp validate --allow-plugins          # the checks.plugins of opentp.cli.yaml
```

See [Custom Checks](/cli/rules#custom-checks) and [Plugins and --allow-plugins](/cli/config#plugins).

### In CI or scripts

```bash
opentp validate --json > report.json
opentp validate --fail-on overlap,unknownCheck
```

stdout holds only the JSON document, also with `--verbose`; logs stay on stderr. `--fail-on` turns warnings of those rules into errors, so the job fails on them.

## What validate checks

1. **Loading.** Every event file that matches `spec.paths.events.template` must be valid YAML (YAML 1.2, no duplicate keys) with an `event` mapping and an `event.taxonomy` mapping; every dictionary file must load. YAML merge keys are not supported (YAML 1.2 has none): a plain `<<` key anywhere in `opentp.yaml`, an event or a dictionary file is an error that no `ignore` entry silences (a quoted `"<<"` is an ordinary key) (`YAML merge keys (<<) are not supported: write the keys out or use an alias`); in `opentp.cli.yaml` it stops the command with exit code `2`. Use `$ref` between payload versions to reuse a schema. A template that ends in `.yaml` also matches `.yml` files. See [Broken files and configuration problems](#broken-files-and-configuration-problems).
2. **`opentp.yaml`.** Templates, regexes, target ids (`spec.events.payload.targets.all` is a non-empty list of unique, non-empty ids), `spec.checks`, check ids (`^[A-Za-z][A-Za-z0-9_.-]*$` wherever `checks` is written; in an event file too, where it is an error that no `ignore` entry silences), `enum` and `dict` together on a taxonomy field, fragment or PII setting, removed `2026-01` keywords (`x-opentp`, `valueRequired`), and the base layers: the catalog (`spec.events.payload.schema`), `spec.targets.all.schema` and `spec.targets.<target>.schema` (types, policies, values, enum members and examples, conflicts between the layers, dictionaries). Each problem is reported once, against `opentp.yaml`.
3. **`opentp.cli.yaml`.** The `keygen` and `tracker` settings against the plan (unknown taxonomy variables, pipelines or steps, unknown fields, invalid tracker paths). Each problem is reported once, against `opentp.cli.yaml`.
4. **Keys.** `event.key` is required, satisfies `spec.events.key` (`minLength` and `maxLength` in code points, `pattern`, `format`) and is unique in the plan. With `keygen` in `opentp.cli.yaml`, it must equal the generated key.
5. **Taxonomy.** Required fields, types, `enum`, `dict`, constraints (`minLength`, `maxLength`, `pattern`, `format`, `minimum`, `maximum`, ...), `checks`, and composite fields (`template` + `fragments`). Values from the file path are typed first (`2` is an integer for an `integer` field).
6. **Payload.** For every target an event covers and every payload version:
   - selectors, `current`, aliases and `$ref` resolve;
   - **closed vocabulary**: every field is a catalog field or a common field of that target (`Unknown field 'auth_methd': ... Did you mean 'auth_method'?`);
   - the effective field (catalog, then `spec.targets.all`, then `spec.targets.<target>`, then the event) has a type, and no layer changes it; an event field needs no `type` of its own;
   - an event cannot change a fixed `value` of a base layer, or replace it with `enum` or `dict`; an event `value`, `enum` or `dict` must stay within the base `enum` or dictionary;
   - **presence**: a field with a `value`, `required: true` in any layer, or `policy: restricted` / `fixed` is always present, so `required: false` on it is an error;
   - **policy**: every event lists a `specified` field, restricts a `restricted` one with `value`, `enum` or `dict`, and sets the `value` of a `fixed` one; versions with `meta.deprecated` are exempt. An array field can satisfy `restricted` only with a `value`, because `enum` and `dict` are not allowed on arrays;
   - values, enum members and examples satisfy the field's type and constraints (an `example` is checked where it is written: one inherited through `$ref` is checked in the version that writes it, and a derived version that narrows the field with `value`, `enum`, `dict` or `items` drops an inherited example it no longer allows, also when a dictionary's values leave it out);
   - the keywords fit the effective type, also when the event field inherits it: no top-level `enum` or `dict` on an array (`enum is not allowed on an array field: use items.enum`), string constraints (`minLength`, `maxLength`, `pattern`, `format`) only on strings, number constraints (`minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`) only on numbers and integers, `items`, `minItems`, `maxItems` and `uniqueItems` only on arrays, and the same string and number rules inside `items` by the item type. Reported once per file where the keyword is written (the catalog and common fields: once, against `opentp.yaml`);
   - code-facing names (`name`, else the key) are unique per event version;
   - `checks` and PII settings.
7. **Checks.** Check ids resolve to a portable check in `spec.checks`, a binding in `opentp.cli.yaml` or a built-in or plugin check; an unknown id is a warning (rule `unknownCheck`). See [Checks](/cli/rules).
8. **Overlap.** Events whose payloads can match the same hit are reported as warnings (rule `overlap`, see [Overlapping events](#overlapping-events)).

## Errors and warnings

Errors make `validate` exit with code `1`. Warnings are printed after the errors and never change the exit code. Two tool rules produce warnings by default, and their severity can be changed:

| Rule | Reports | Default |
|---|---|---|
| `unknownCheck` | A check id that `spec.checks`, the built-in and plugin checks and the bindings in `opentp.cli.yaml` do not define. Reported once for `opentp.yaml` and once per event file; the check is skipped | warning |
| `overlap` | Two events whose payloads can match the same hit | warning |

- `--fail-on <rule>` reports the rule as errors for this run (`--fail-on overlap,unknownCheck`, or the option twice).
- `checks.severity.<rule>` in `opentp.cli.yaml` sets `off`, `warning` or `error` for the plan; `--fail-on` wins over it.

## Overlapping events

Two events **overlap** when one hit on a target could match both of them. For every target that both events are sent to, `validate` compares each payload version of one event with each version of the other. A version allows the hits that match all of its effective fields (the common fields of the target plus the fields the version lists, merged with the catalog):

| Effective field | Allowed in a hit |
|---|---|
| `value: X` | exactly `X` (arrays: equal element by element) |
| `enum`, or `dict` with known values, always present | one of those values |
| `enum`, or `dict` with known values, optional | one of those values, or absent (missing or `null`) |
| anything else: free fields, arrays without `value` (`items.enum` does not count), a `dict` that does not exist | any value |

A field is always present when any layer sets `required: true`, when it has a `value`, or when its `policy` is `restricted` or `fixed`; versions marked `meta.deprecated` are exempt from policy, so there such a field may be absent. A field that only one of the two events constrains, or that one of them does not list at all, does not tell them apart. Values compare by type: `"1"` and `1` differ.

Each overlapping pair is reported once, as a warning at path `payload` (with `"rule": "overlap"` in `--json`):

```
[settings/view.yaml]
  ⚠ payload: Overlaps with event 'settings::home_view' (settings/home_view.yaml) on web, ios: every hit of 'settings::home_view' also matches 'settings::view'
```

The message lists the targets where some version pair overlaps, in `spec.events.payload.targets.all` order, and the strongest kind found over those targets and versions:

| Kind | The message ends with | Reported on |
|---|---|---|
| identical | `identical: no constrained field tells them apart`, plus `; they differ only in free fields: a, b` when one event lists free fields that the other does not | the event whose file path sorts first |
| contains | `every hit of '<narrower key>' also matches '<broader key>'` | the broader event |
| overlaps | `some hits match both` | the event whose file path sorts first |

When the versions of a `contains` pair disagree about which event is the broader one (a newer version contains the other event, an older one is contained in it), the first target in `targets.all` order and the first versions in file order decide. File order is the order of the version keys in the event file, also for keys that look like numbers (`"2"` before `"1"`).

When **more than 20** overlap warnings would be attached to one event (each pair is reported on one of its two events, see the table above), they become one summary warning on that event:

```
[search/any_click.yaml]
  ⚠ payload: Overlaps with 412 other events on web, ios (3 identical, 397 contained in this event, 12 partial); for example 'auth::login_click' (auth/login_click.yaml), 'auth::logout_click' (auth/logout_click.yaml), 'cart::add' (cart/add.yaml)
```

It counts the other events of those pairs by kind, as seen from this event: `identical`, `contained in this event` (it is the broader one), `containing this event` (only for a draft checked by MCP `validate_event_draft`, where every overlap is attached to the draft) and `partial` (`some hits match both`); kinds with no events are left out. The targets are those of all these overlaps, and the examples are the first three other events by file path. Pairs silenced with `ignore` are not counted. An event with 20 attached overlap warnings or fewer keeps one warning per pair, whatever the number of events it overlaps: in a group of 22 identical events, every event overlaps 21 others, but each pair is attached to the event whose path sorts first, so only the first event gets a summary (21 pairs) and the others keep 20, 19, … 1 and 0 warnings. This keeps the report small when an event lost its identity field and contains most of the plan.

Every loaded event takes part, whatever its `lifecycle.status`. A pair in which one event names the other in `lifecycle.replacedBy` or in `aliases[].key` is not compared (an event and the old file it replaces).

Typical causes are an event that lost its identity field (for example `event_name`), which then contains every event of its category, and an event that leaves an optional field free, which also matches the events that pin it. Pin the field in both events, or accept the overlap and silence it.

### Silencing overlap warnings

- `ignore` entries in an event file; either event of a pair can carry them:

  ```yaml
  ignore:
    - path: overlap.cart::add   # only the pair with the event whose key is cart::add
      reason: Both events are sent until the old app versions are gone
    - path: overlap             # every overlap warning that involves this event
  ```

- `checks.severity.overlap` in `opentp.cli.yaml` sets the severity for the whole plan: `warning` (the default), `error`, or `off` (the comparison does not run at all):

  ```yaml
  checks:
    severity:
      overlap: off
  ```

- `--fail-on overlap` reports overlaps as errors, so `validate` exits with code `1` (useful in CI). It wins over `checks.severity`.

Warnings never change the exit code. In text mode at most 20 overlap warnings are printed (from the events with the most attached overlap warnings first; a summary counts as the pairs it stands for), followed by `… <N> more overlap warnings (--json lists all; set checks.severity.overlap in opentp.cli.yaml)`; `--json` lists every one of them under `warnings`. Overlaps reported as errors are all printed.

## Ignoring checks in an event

An event file can silence some checks for itself with `ignore` entries (`reason` is optional):

```yaml
opentp: 2026-09
event:
  key: legacy::old_click
  taxonomy:
    action: Old click
  payload:
    schema:
      event_name: { value: old_click }
  ignore:
    - path: key
      reason: Kept for old dashboards
    - path: payload::dimension_1
```

| Path | Silences |
|---|---|
| `key` or `event.key` | The key checks: missing key, `spec.events.key` constraints, keygen mismatch |
| `opentp` | The event file's version check |
| `taxonomy.<field>` | The checks of one taxonomy field or fragment |
| `payload::<field>` | The field-level checks of one payload field on every target and version: values, enum members, examples, policy, names, checks (also unknown check ids), dictionaries (also unknown ones). The only form for a field whose name contains `.` |
| `payload.<...>.schema.<field>[...]` | The same, for the field right after the first `.schema.` (`payload.web.1.0.0.schema.user_id.value` silences `user_id` everywhere) |
| `payload.<field>[.<keyword>]` | The same |
| `overlap` / `overlap.<key>` | Overlap warnings (above) |

Never ignorable: load errors, duplicate YAML keys and duplicate event keys, payload resolution errors, unknown fields, `policy`, `x-opentp` or `valueRequired` written in an event, `required: false` contradictions, null field definitions, YAML merge keys (`<<`), type conflicts, keywords that the field's type does not allow, a changed or replaced fixed value, a weakened `required`, and every problem in `opentp.yaml` and `opentp.cli.yaml`. An entry that matches nothing is not an error, and `fix` ignores the list.

## Broken files and configuration problems

The CLI fails closed: anything it cannot read is an error, never a silent skip. `validate` (and `fix`) exits with code `1` when:

- An event file has a YAML syntax error or duplicate keys (reported with the line and column), is empty, or has no `event` or `event.taxonomy` mapping. The file is not loaded, so it is not counted in `count=` / `eventCount=`.
- An event or dictionary file has another `opentp` than the plan. A file still on `2026-01` gets `Run "opentp migrate" to upgrade it.` appended; in an application repository, where migrate does not run, it gets `Pin a plan ref whose files are all on 2026-09.` instead.
- A dictionary file has a YAML syntax error or is not a mapping, or the same dictionary exists as both `.yaml` and `.yml` (the `.yaml` file is used).
- The expected key cannot be generated for an event (for example, a keygen variable has no value for it). The event is still validated; the error is reported at `event.key` (an `ignore` entry for `event.key` suppresses it).
- A check (built-in, plugin or loaded with `--external-rules`) throws. The error `check <name> failed: <message>` is reported for that value, and the run continues.
- A payload selector covers no target listed in `spec.events.payload.targets.all`.
- `opentp.yaml` has one of these problems, each reported once (not once per event file):
  - `spec.paths.events.template` has an unclosed, empty, invalid (not an identifier) or duplicate placeholder, or uses transforms. No event file is loaded.
  - `spec.paths.events.root` does not exist.
  - `x-opentp` (anywhere) or `valueRequired`: removed in `2026-09` (run `opentp migrate`).
  - A taxonomy, fragment or payload `dict` names a dictionary that does not exist (`Unknown dictionary`).
  - An invalid regex, an unusable composite `template`, a field definition that is not a mapping, an empty `enum`, or `value`, `enum` and `dict` together in one definition.
  - A group in `spec.events.payload.targets` lists a target that is not in `targets.all`, or a key of `spec.targets` is not `all` or in `targets.all`.
  - A base field without a type after merging (`Field 'x' has no type: give it a type in the catalog or in spec.targets`), a lowered policy, or conflicting layers.
- `opentp.cli.yaml` has a `keygen` or `tracker` problem (see [opentp.cli.yaml](/cli/config#errors-and-exit-codes)). Keys are not generated and `fix` rewrites nothing until it is fixed.

Files under the events root that do not match `spec.paths.events.template` are not event files and are ignored, and so are `opentp.yaml`, `opentp.yml`, `opentp.cli.yaml` and `opentp.cli.yml` in the plan root.

`validate` exits with code `2` instead, without a report, when it cannot start: `opentp.yaml` is missing or cannot be loaded (YAML syntax error, an `opentp` version other than `2026-09`, missing required fields, `opentp.yaml` next to `opentp.yml`), `opentp.cli.yaml` cannot be used (wrong shape, another `opentp` than the plan, a `cli` range this opentp does not satisfy, invalid `checks.bindings`, a `plan:` that cannot be found or fetched), an `--external-*` directory does not exist, the arguments are invalid, or `OPENTP_LOG_LEVEL` is not a valid level. A `2026-01` plan gets:

```
✗ This plan uses OpenTrackPlan 2026-01; opentp 0.10.0 reads 2026-09. Run "opentp migrate" to upgrade it (or keep opentp 0.9.1: OPENTP_VERSION=0.9.1). file="opentp.yaml"
```

## Output

### Text

The report goes to stdout: errors grouped by file, then warnings. Event files are shown relative to the events root, dictionary files as `dictionaries/<file>`, and problems of the settings under `opentp.yaml` and `opentp.cli.yaml`. Each line shows the check path and the message (`✗` for errors, `⚠` for warnings); problems with the whole file (such as YAML syntax errors) have no path. The summary line goes to stderr, last:

```
[auth/help_click.yaml]
  ✗ Invalid YAML at line 5, column 1: Flow map in block collection must be sufficiently indented and end with a }

[auth/logout_click.yaml]
  ✗ payload.web.schema.auth_methd: Unknown field 'auth_methd': add it to the catalog (spec.events.payload.schema) or to spec.targets.all/web.schema. Did you mean 'auth_method'?
  ✗ payload.ios.schema.auth_methd: Unknown field 'auth_methd': add it to the catalog (spec.events.payload.schema) or to spec.targets.all/ios.schema. Did you mean 'auth_method'?
  ✗ payload.android.schema.auth_methd: Unknown field 'auth_methd': add it to the catalog (spec.events.payload.schema) or to spec.targets.all/android.schema. Did you mean 'auth_method'?

[auth/signup_click.yaml]
  ✗ event.key: Key mismatch: got 'auth::sign_up', expected 'auth::signup_click'
  ✗ payload.web.schema.event_name: Field 'event_name' has policy 'fixed': every event must list it
  ✗ payload.ios.schema.event_name: Field 'event_name' has policy 'fixed': every event must list it
  ✗ payload.android.schema.event_name: Field 'event_name' has policy 'fixed': every event must list it

[auth/logout_click.yaml]
  ⚠ payload.schema.dimension_1.checks.acme.no-pii: Unknown check 'acme.no-pii': not in spec.checks, not a built-in or plugin check, not bound in opentp.cli.yaml
  ⚠ payload: Overlaps with event 'auth::sign_up' (auth/signup_click.yaml) on web, ios, android: some hits match both

[auth/signup_click.yaml]
  ⚠ payload: Overlaps with event 'auth::login_click' (auth/login_click.yaml) on web, ios, android: every hit of 'auth::login_click' also matches 'auth::sign_up'
✗ Validation failed errorCount=8 warningCount=3 eventCount=3
```

Payload problems are reported per target id (and per version), with the resolved target ids rather than the selector written in the file. The warnings of a file form one block: its other warnings, then its overlap warnings. Files with only overlap warnings come after the files with other warnings.

The summary line is one of:

| Summary | Meaning |
|---|---|
| `✓ All events are valid count=N` | No errors, no warnings |
| `✓ All events are valid warnings=W count=N` | No errors, `W` warnings (exit code `0`) |
| `✗ Validation failed errorCount=E warningCount=W eventCount=N` | `E` errors (exit code `1`) |

`count=` and `eventCount=` count the loaded event files. `count=` is always the last field of a success line, so a script can match `count=N$`.

### JSON

With `--json`, stdout holds one JSON document and nothing else; no summary line is printed. For a plan with one wrong key and one unknown check:

```json
{
  "success": false,
  "events": 2,
  "errors": [
    {
      "event": "auth/signup_click.yaml",
      "path": "event.key",
      "message": "Key mismatch: got 'auth::sign_up', expected 'auth::signup_click'",
      "severity": "error"
    }
  ],
  "warnings": [
    {
      "event": "auth/signup_click.yaml",
      "path": "payload.schema.dimension_1.checks.acme.no-pii",
      "message": "Unknown check 'acme.no-pii': not in spec.checks, not a built-in or plugin check, not bound in opentp.cli.yaml",
      "severity": "warning",
      "rule": "unknownCheck"
    }
  ]
}
```

| Key | Meaning |
|---|---|
| `success` | `true` when there are no errors (warnings allowed) |
| `events` | The number of loaded event files |
| `errors`, `warnings` | `{ event, path, message, severity }`, plus `rule` (`overlap`, `unknownCheck`) for tool rules. `event` is the display label of the file (as in the text report); `path` is an empty string for a problem with the whole file. A tool rule raised with `--fail-on` appears under `errors` with `"severity": "error"` |

When `validate` exits with code `2`, stdout is empty.
