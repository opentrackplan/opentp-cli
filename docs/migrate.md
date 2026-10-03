---
title: migrate
description: Upgrade a tracking plan from OpenTrackPlan 2026-01 to 2026-09.
sidebar:
  order: 5
---

# opentp migrate

Upgrades a tracking plan written for OpenTrackPlan `2026-01` to `2026-09`, the version that opentp 0.10 reads.

opentp 0.10 reads only `2026-09`. On a `2026-01` plan every command stops with exit code `2` (here run with `--root .`):

```
✗ This plan uses OpenTrackPlan 2026-01; opentp 0.10.0 reads 2026-09. Run "opentp migrate" to upgrade it (or keep opentp 0.9.1: OPENTP_VERSION=0.9.1). file="opentp.yaml"
```

An event or dictionary file still on `2026-01` inside a `2026-09` plan gets a validation error that ends with `Run "opentp migrate" to upgrade it.` In an application repository (`plan:` in `opentp.cli.yaml`), which migrate refuses, the error ends with `Pin a plan ref whose files are all on 2026-09.`

`opentp migrate` edits the text of your files, not a re-serialized copy: it changes only what 2026-09 requires, and every other byte stays as it was (comments, blank lines, quoting, key order, anchors). Run it once in the plan repository, review the diff, and commit the result together with the version bump of every pinned opentp.

## Usage

```bash
opentp migrate [options]
```

| Option | Description |
|--------|-------------|
| `--root <path>`, `-r <path>` | Plan root, the directory with `opentp.yaml` (default: `$OPENTP_ROOT`, otherwise the current directory) |
| `--check` | Write nothing; exit `1` when a file would change (for CI) |
| `--dry-run` | Write nothing; print what would change (exit `0`) |
| `--json` | Print the result as one JSON document on stdout |
| `--cli-config <path>` | The `opentp.cli.yaml` to update (default: the one in the plan root, created there when needed) |
| `--verbose`, `-v` | Also print what changed in each file (on stderr) |

Any other option is a usage error (exit code `2`).

## A typical upgrade

```bash
git status                  # start from a clean working tree
opentp migrate --dry-run    # see what would change
opentp migrate              # rewrite the files
opentp validate             # check the result; fix what it reports
git diff                    # review
```

Then bump every pinned opentp to 0.10.x **in the same commit** (see [Next steps](#next-steps)) and commit.

Running `opentp migrate` again changes nothing:

```
✓ Nothing to migrate: the plan is on 2026-09
```

## Which files

- `opentp.yaml` (or `opentp.yml`; both in the same directory is an error).
- Every `*.yaml` / `*.yml` file under the plan root, and under the events and dictionaries roots (also when they are outside the plan root), whose `opentp` is `2026-01` and that has an `event` or a `dict` key: events, dictionaries, and also event skeletons or templates outside the events root (they are listed as migrated outside the roots). Directories whose names start with `.` and `node_modules` are skipped.
- Other files with `opentp: 2026-01` (no `event` or `dict` key) are not changed; they are listed as warnings. A YAML file that cannot be loaded is a problem only when it is under the events or dictionaries root or starts with `opentp: 2026-01`; any other one is not a plan file: it is skipped with a warning.
- `opentp.cli.yaml` is created or updated when settings move out of the plan (below). An existing one must have the right shape first (as for every other command): a shape problem stops migrate with exit code `2` before anything is written.

Symbolic links:

- The events and dictionaries roots (`spec.paths.*.root`) are followed, also when they are symbolic links, as `opentp validate` reads them. The files are listed under the configured path (`events/auth/login.yaml`) and written where they really are; the links stay.
- A symbolic link to a YAML file inside the events or dictionaries root is read through the link, as `opentp validate` reads it: it is listed under the link's path (`events/auth/login.yaml`), and the file it points to is written; the link stays. A file that is also reached by its own path inside those roots is migrated once, under that path, and the link is listed as a warning (`Symbolic link to <file>: migrated as that file (the link stays)`).
- A symbolic `opentp.yaml` or `opentp.cli.yaml` is read through the link, and the file it points to is written; the link stays.
- Other symbolic links (to files outside the events and dictionaries roots, or to directories) are not followed or migrated; they are listed as warnings.
- The events root must exist (`Events directory not found`, as in validate). A directory that cannot be read (no permission, a broken link) stops the run before anything is written when it is the events or dictionaries root or inside one, since validate reads them. Any other directory that cannot be read (for example a container volume under the plan root) is skipped with a warning, `Cannot read this directory (<reason>): skipped; a 2026-01 file in it would not be migrated`; it never stops the run, and a plan with nothing left to migrate still gets `Nothing to migrate` (exit code `0`, also with `--check`).

Each file is migrated by its own header, so the command can finish an interrupted run, and it also upgrades a `2026-01` event file that arrives later (for example from a branch merged after the migration). In that case the types come from the 2026-09 catalog and common fields; a field that is not in the catalog is reported, not added: add it to `spec.events.payload.schema` yourself.

## What changes

### Event and dictionary files

- `opentp: 2026-01` becomes `opentp: 2026-09` (quoting and comment kept).
- `enum: []` is removed (a definition left empty becomes `{}`). In block style the line goes; in flow style only that flow mapping is rewritten.
- An `example` written as a number or boolean on a field whose type is `string` is quoted with its original text: `example: 0012` becomes `example: "0012"` (not `"12"`).
- `x-opentp` on a field: `role` is removed, `checks` becomes a `checks` key next to it, and an `x-opentp` left empty is removed.
- A `webhook` check becomes a named binding: `checks: { webhook-1: true }` in the plan, and the webhook configuration moves to `opentp.cli.yaml` (below).
- `valueRequired` is removed (warning).
- `required: false` next to a `value` in the same definition is removed (warning: the field is now always present).

Keys, taxonomy values, lifecycle, `ignore` entries and the rest of the payload are not touched.

```yaml
# 2026-01
opentp: 2026-01
event:
  key: auth::login
  taxonomy: {}
  payload:
    schema:
      event_category: { value: auth }
      event_label: { value: Sign in, required: false }
      dimension_1:
        title: Login method
        type: string
        example: 0012
        enum: []
        x-opentp:
          role: attribute
          checks:
            webhook:
              url: https://example.com/hooks/check
```

```yaml
# 2026-09
opentp: 2026-09
event:
  key: auth::login
  taxonomy: {}
  payload:
    schema:
      event_category: { value: auth }
      event_label: { value: Sign in }
      dimension_1:
        title: Login method
        type: string
        example: "0012"
        checks:
          webhook-1: true
```

### opentp.yaml

Only the changed nodes are rewritten and spliced into the original text:

- The header.
- **Base fields move.** In 2026-01, `spec.events.payload.schema` put its fields into every event. They move to `spec.targets.all.schema`, with their comments, so they stay part of every event. `spec.targets` is inserted right before `spec.events` when the plan has none; an existing `spec.targets.all.schema` keeps its own definitions, and a field defined in both places is reported.
- **The catalog.** `spec.events.payload.schema` becomes the field catalog: every field that an event payload uses and that is not a common field of every target the event covers, one line each, sorted naturally (`dimension_2` before `dimension_10`):
  - the type comes from a typed definition in `spec.targets`, otherwise from the type most events declare; when no event declares one, from the fixed values, then the enum members, then the values of the dictionary the field names, else `string` (with a warning). When events declare different types, a warning lists the counts per type and up to 5 files;
  - arrays get `items: { type: ... }` with the item type most events use, nothing else;
  - numbered slot families (`dimension_1`, `dimension_3`, `dimension_6`, ...) whose used members all get the same definition are completed from 1 to the highest number, so the free slots stay usable (the added names are listed). A family needs at least two used members, and they must cover at least half of the numbers up to the highest one (`build_2025` and `build_2026` alone are not slots).
- Base fields without a `type` get the type of their `value` (`integer` for whole numbers, else `number`; `string`; `boolean`; `array` with `items`).
- `valueRequired: true` on a base field:
  - a base layer of the field (the old base or any `spec.targets.<id>.schema`) sets a `value`: removed (a warning when only some targets set it);
  - otherwise it becomes `policy: fixed` when the field is `required: true`, or when every version of every event (versions with `meta.deprecated` excepted) sets a `value` for it on every target; the field's `required` is then removed;
  - otherwise it is removed, with a warning that says how many event versions do not pin a value.
- `valueRequired: false` is removed.
- `spec.events.x-opentp.keygen` moves to `keygen` in `opentp.cli.yaml` with its original text. `x-opentp.role` is removed and `x-opentp.checks` becomes `checks` everywhere (taxonomy fields, fragments, base fields, `items`, pii). Each `x-opentp` is removed once its members have moved; members with no 2026-09 equivalent stay and are reported.
- Webhook checks become bindings, as in event files.
- `enum: []` and `required: false` next to a `value` are removed, as in event files.

```yaml
# 2026-09 (excerpt)
spec:
  targets:
    all:
      schema:
        application_id:
          type: string
          required: true
        event_category:
          type: string
          policy: fixed
        event_label:
          type: string
  events:
    payload:
      targets:
        all: [web, ios, android]
      schema:
        dimension_1: { type: string }
        dimension_2: { type: string }
        dimension_3: { type: string }
```

### opentp.cli.yaml

Key generation is a tool setting in 2026-09, and webhook checks are bound by the tool, so both move to `opentp.cli.yaml`. The file is created only when something moves:

```yaml
# yaml-language-server: $schema=https://opentp.dev/schemas/cli/opentp.cli.schema.json
opentp: 2026-09
cli: ">=0.10 <0.11"

keygen:
  template: "{area}::{event}"

checks:
  bindings:
    webhook-1:
      webhook:
        url: https://example.com/hooks/check
```

Binding ids are `webhook-1`, `webhook-2`, ... in the order the checks are first seen (files sorted by path, then top to bottom); identical configurations share one id. An existing `opentp.cli.yaml` is updated in place: a section equal to the one being moved is left as it is, new bindings are added after the existing ones, and a different `keygen` is an error (nothing is written).

A webhook binding takes `url`, `method` (`GET`, `POST` or `PUT`), `headers`, `timeout`, `retries` and `cache`. The configuration is copied as written, with two changes where opentp 0.9 behaved the same way:

- a method written in another case (`post`) is upper-cased (`POST`);
- other keys (for example a `description`) are not copied, with a warning at the place where each one is written: `Unknown webhook setting 'description': not copied to the binding in opentp.cli.yaml (...)`.

Configurations that are equal after these changes share one id. Any other problem (a method such as `PATCH`, a `timeout` that is not a whole number, a missing `url`) stops the run before anything is written, with one line per problem at every place where that configuration is written, for example `events/auth/login.yaml: payload.schema.user_id.x-opentp.checks.webhook: Cannot become a webhook binding in opentp.cli.yaml (method: Invalid option: expected one of "GET"|"POST"|"PUT"): fix the webhook configuration here and run opentp migrate again`.

## What changes in meaning

2026-09 changes the meaning of some 2026-01 constructs. migrate keeps the meaning where it can and warns where it cannot:

| 2026-01 | 2026-09 | migrate |
|---|---|---|
| `spec.events.payload.schema` puts its fields into every event | It is the catalog: the fields events *may* use. Fields of every event live in `spec.targets.all.schema` (every target) and `spec.targets.<id>.schema` (one target) | Moves the base fields to `spec.targets.all.schema` and writes a catalog |
| An event may use any field name | Closed vocabulary: every event field must be a catalog field or a common field of each target the payload covers | The catalog lists every field the events use; a new field must be added to the catalog first |
| `valueRequired` | `policy: specified \| restricted \| fixed` on catalog and common fields only | `policy: fixed` where every event already pins a value, else removed (warning) |
| `x-opentp` (`keygen`, `checks`, `role`) | Removed; `checks` is a core keyword, key generation is a tool setting, `role` is gone | Moved or removed (see above) |
| `enum: []` | An enum needs at least one value | Removed: the field accepts any value of its type (an empty enum used to reject every taxonomy value) |
| `example` of any type | An example must satisfy its field | Numbers and booleans on string fields are quoted; other mismatches are reported |
| `value` + `required: false`: an optional constant | A `value` (in any layer) or `policy: restricted\|fixed` means the field is in every hit | `required: false` next to `value` is removed (warning). Use payload versions for a transition period |
| A later layer can override a base `value` | An event cannot change a fixed base `value` or replace it with `enum`/`dict` | Reported by validate |
| Enum members and fixed values are not checked against the type | They must satisfy the field's type and constraints | Reported by validate |
| Overlapping events are not detected | Two events whose fixed values can match the same hit overlap (warning) | Reported by validate |
| YAML merge keys (`<<`) | Not supported (YAML 1.2): a `<<` key is an error | Not changed. `opentp validate` reports every `<<` key (`YAML merge keys (<<) are not supported: write the keys out or use an alias`), and migrate lists them under `manual`. Rewrite such mappings by hand (`$ref` reuses a payload version) |

Event fields no longer need a `type` (it comes from the catalog or the common fields); migrate leaves the types events already declare, which must match.

### Anchors and aliases

migrate keeps anchors (`&name`) and aliases (`*name`), and edits an anchored node where the anchor is, so its aliases see the migrated content. Where an edit has to look through an alias, it does:

- A webhook configuration reused with an alias (`webhook: &hook { url: ... }`, later `webhook: *hook`) gets one binding id, and both places become `webhook-1: true`. A configuration that uses aliases is written to `opentp.cli.yaml` from its data (aliases cannot point into another file); so is a `keygen` that uses them.
- `x-opentp: *ids`: the mapping is migrated at its anchor; at the alias, `checks` is written out (`checks: { not-empty: true, webhook-1: true }`). The alias stays only when that mapping has members with no 2026-09 equivalent (they are reported).
- `enum: *none` that points to an empty list is removed, like `enum: []`.

migrate stops (exit code `1`, nothing written) where an edit cannot keep an alias working, and names both places:

- an alias that would come before its anchor (for example an alias in a base field, which moves to `spec.targets.all.schema` above `spec.events`, to an anchor in `spec.events.taxonomy`), or whose anchor sits inside a node that migrate removes or replaces (an `x-opentp` member, a webhook configuration, `keygen`). Expand the alias (write the anchored content in its place) and run migrate again;
- an anchor on `spec.events.payload.schema`, or an alias in its place: 2026-09 turns that mapping into the catalog and moves its fields, which an anchor or alias cannot follow. Remove the anchor or expand the alias, and run migrate again.

YAML merge keys (`<<`) are not supported in 2026-09 (YAML 1.2): migrate lists every `<<` key of a migrated file under "problems to fix by hand" and leaves it as it is.

## Output

- **stdout:** the changed and created files, one path per line, relative to the plan root.
- **stderr:** warnings (`⚠`), the summary, the problems to fix by hand (`✗`), the counts and the next steps. With `--verbose`, also the changes made to each file.

```
events/auth/login.yaml
events/auth/logout.yaml
opentp.yaml
opentp.cli.yaml
⚠ opentp.yaml: spec.targets.all.schema.event_label: valueRequired removed from 'event_label': 3 of 6 event versions do not pin a value, and 2026-09 has no 'this value if present' rule (pin it in every event and set policy: fixed, or leave the field free)
⚠ events/auth/login.yaml: payload.schema.event_label.required: required: false next to value removed: the field is now always present (2026-09 has no optional constant; use versions for a transition period)
3 base fields moved to spec.targets.all.schema (still part of every event)
3 fields in the catalog spec.events.payload.schema (added to complete slot families: dimension_2)
Webhook checks bound in opentp.cli.yaml: webhook-1
✓ Migrated to 2026-09 changed=3 created=1 warnings=2 manual=0
Next steps:
  1. Run "opentp validate" and fix what it reports (the manual items, if any).
  2. Bump every pinned opentp (OPENTP_VERSION, CI images, the cli range in opentp.cli.yaml) to 0.10.x in the same commit.
```

### `--json`

stdout carries one JSON document and nothing else (also with `--verbose`):

```json
{
  "changed": [
    {
      "file": "events/auth/login.yaml",
      "kind": "event",
      "changes": [
        "opentp: 2026-01 -> 2026-09",
        "removed required: false next to value",
        "quoted a number or boolean example",
        "removed enum: []",
        "removed x-opentp.role",
        "x-opentp.checks -> checks",
        "webhook check -> binding"
      ]
    },
    {
      "file": "events/auth/logout.yaml",
      "kind": "event",
      "changes": [
        "opentp: 2026-01 -> 2026-09"
      ]
    },
    {
      "file": "opentp.yaml",
      "kind": "config",
      "changes": [
        "opentp: 2026-01 -> 2026-09",
        "moved keygen to opentp.cli.yaml",
        "catalog: 3 fields in spec.events.payload.schema",
        "moved 3 base fields to spec.targets.all.schema",
        "valueRequired: true -> policy: fixed",
        "removed valueRequired"
      ]
    }
  ],
  "created": [
    {
      "file": "opentp.cli.yaml",
      "kind": "cli-config",
      "changes": [
        "keygen from opentp.yaml",
        "webhook bindings: webhook-1"
      ]
    }
  ],
  "warnings": [
    {
      "file": "opentp.yaml",
      "path": "spec.targets.all.schema.event_label",
      "message": "valueRequired removed from 'event_label': 3 of 6 event versions do not pin a value, and 2026-09 has no 'this value if present' rule (pin it in every event and set policy: fixed, or leave the field free)"
    },
    {
      "file": "events/auth/login.yaml",
      "path": "payload.schema.event_label.required",
      "message": "required: false next to value removed: the field is now always present (2026-09 has no optional constant; use versions for a transition period)"
    }
  ],
  "manual": [],
  "summary": {
    "from": "2026-01",
    "to": "2026-09",
    "mode": "write",
    "written": true,
    "changed": 3,
    "created": 1,
    "warnings": 2,
    "manual": 0,
    "catalog": {
      "fields": 3,
      "slots": [
        "dimension_2"
      ]
    },
    "movedBaseFields": 3,
    "webhookBindings": [
      "webhook-1"
    ],
    "keygenMoved": true,
    "nextSteps": [
      "Run \"opentp validate\" and fix what it reports (the manual items, if any).",
      "Bump every pinned opentp (OPENTP_VERSION, CI images, the cli range in opentp.cli.yaml) to 0.10.x in the same commit."
    ]
  }
}
```

`kind` is `config`, `cli-config`, `event` or `dictionary`; `outsideRoots: true` marks an event or dictionary file outside the events or dictionaries root. `mode` is `write`, `dry-run` or `check`. When nothing could be written, the document also has `errors` (`{ file, path, message }`). There is no document for exit code `2`.

### `--check` and `--dry-run`

Both write nothing and print the same report. `--dry-run` exits `0` and its summary says `✓ Dry run (nothing written): migration to 2026-09 ...`. `--check` exits `1` when any file would change, so a CI job can catch a plan (or a merged branch) that still has `2026-01` files:

```bash
opentp migrate --check
```

```
✗ Migration to 2026-09 needed (run opentp migrate) changed=3 created=1 warnings=2 manual=0
```

On a plan with nothing left to migrate, both exit `0` with `✓ Nothing to migrate: the plan is on 2026-09`.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Migrated, nothing to migrate, or a dry run |
| `1` | `--check` found files to migrate, or the plan cannot be migrated (nothing was written; the reasons are listed, each with its file and path): a plan file cannot be parsed or loaded, the events or dictionaries root or a directory inside one cannot be read, the events root does not exist, `spec.events.payload` is missing, an existing `opentp.cli.yaml` has a different `keygen`, an alias that the migration would break or an anchor or alias on `spec.events.payload.schema` (see [Anchors and aliases](#anchors-and-aliases)), a key that cannot be edited as text (an explicit `? key`), a webhook configuration that a webhook binding does not accept (see [opentp.cli.yaml](#opentpcliyaml)), a migrated `opentp.yaml` or `opentp.cli.yaml` that cannot be loaded, or a mapping that migrate has to insert into (`spec`, `spec.events.payload`, `spec.targets`, `spec.targets.all`, `spec.targets.all.schema`, `checks` or `checks.bindings` in `opentp.cli.yaml`) written in flow style: `rewrite <path> in block style and run opentp migrate again`. An unexpected error is reported the same way (`Internal error (...)`, with the file) |
| `2` | Usage or configuration error: `opentp.yaml` missing, `opentp.yaml` next to `opentp.yml`, a plan version other than `2026-01` or `2026-09`, `plan:` in `opentp.cli.yaml` (an application repository: run migrate in the plan repository), an existing `opentp.cli.yaml` with the wrong shape (one line per problem, as for the other commands) |

## How files are written

Every edit is computed in memory first. If any plan file cannot be parsed or a directory of the events or dictionaries root cannot be read, nothing is written. Every migrated text is then loaded again (aliases resolved), and the migrated `opentp.yaml` and `opentp.cli.yaml` must load as validate loads them; otherwise nothing is written either. Each file is written to a temporary file next to it and renamed over the original (for a symbolic link, next to the file it points to, so the link stays): event and dictionary files first, then `opentp.cli.yaml`, then `opentp.yaml`. If a run is interrupted, run it again: files already on 2026-09 are kept, and the remaining ones are migrated. Line endings (LF or CRLF) and file permissions are kept.

## What needs manual attention

Before it writes anything, migrate validates the migrated plan (in a temporary copy) and lists, under "problems to fix by hand" (`manual` in `--json`), everything that `opentp validate` will still reject. Typical items:

- An event that declares another `type` than the catalog (the catalog takes the type most events declare; the warning lists the other files): fix or remove the event's `type`.
- An event that changes a base `value`, replaces it with `enum` or `dict`, or sets `required: false` on a field that has a base `value` (2026-01 allowed these).
- Enum members, fixed values or examples that do not match the field's type and constraints.
- `x-opentp` members other than `keygen`, `checks` and `role`, and `x-opentp` in other places: move or remove them (use your own `x-acme-*` key for tool data).
- YAML merge keys (`<<`): write the merged keys out in the mapping.
- A field defined both in the old base schema and in `spec.targets.all.schema`: merge the two definitions.

Also review these by hand; validate does not report them:

- Every warning about `valueRequired`: where not every event pinned a value, the field is now free. Pin it in every event and set `policy: fixed` (or `restricted`), or leave it free.
- Every warning about `required: false` next to `value`: the field is now always sent with that value.
- Fields typed `string` because nothing said otherwise (a warning says so).
- Comments next to `spec.events.payload.schema` stay where they are: one that described the old base fields now sits above the catalog.

## Next steps

1. Run `opentp validate` and fix what it reports.
2. Bump every pinned opentp to 0.10.x **in the same commit** as the migrated plan: `OPENTP_VERSION` in CI and install scripts, CI and container images, and the `cli` range in `opentp.cli.yaml`. opentp 0.9.1 cannot read a 2026-09 plan, and 0.10 cannot read a 2026-01 plan. A repository that stays on 2026-01 can keep `OPENTP_VERSION=0.9.1`.
3. Application repositories that pin this plan (`plan:` in their `opentp.cli.yaml`) must pin a plan ref that is on 2026-09 when they move to opentp 0.10.
