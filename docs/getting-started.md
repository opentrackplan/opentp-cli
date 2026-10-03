---
title: Getting Started
description: Install OpenTrackPlan and create your first tracking plan in minutes.
sidebar:
  order: 2
---

# Getting Started

## Installation

The `opentp` CLI is distributed only as standalone binaries for macOS (arm64 and x64), Linux (x64) and Windows (x64). They do not need Node.js.

**macOS / Linux:**

```bash
curl -fsSL https://opentp.dev/install | bash
```

**Windows (PowerShell):**

```powershell
irm opentp.dev/install.ps1 | iex
```

The installers download the latest GitHub release into `~/.opentp/bin` and verify it against the `SHA256SUMS` file of the same release. Releases up to 0.7.4 have no `SHA256SUMS` and are installed with a warning; for any later release a missing `SHA256SUMS` or a checksum mismatch aborts the install. Two optional environment variables change what is installed. Set them on the shell that runs the installer, not on `curl`:

- `OPENTP_VERSION` pins a release, e.g. `0.7.4`.
- `OPENTP_DOWNLOAD_BASE` points at an internal mirror of the release assets (its `.../releases/download` URL). A pinned version is downloaded from `$OPENTP_DOWNLOAD_BASE/v<version>/`; the latest release is resolved only when the base ends with `/releases/download` and redirects `latest/download/<asset>` to `<tag>/<asset>` (GitHub and GitHub Enterprise), so set `OPENTP_VERSION` for any other mirror layout.

```bash
curl -fsSL https://opentp.dev/install | OPENTP_VERSION=0.7.4 bash

curl -fsSL https://opentp.dev/install | \
  OPENTP_DOWNLOAD_BASE="https://github.mycompany.com/<org>/opentp-cli/releases/download" bash
```

```powershell
$env:OPENTP_VERSION = "0.7.4"; irm opentp.dev/install.ps1 | iex
```

**Manual download:** every [GitHub release](https://github.com/opentrackplan/opentp-cli/releases) has four binaries, `opentp-mac` (macOS arm64), `opentp-mac-intel` (macOS x64), `opentp-linux` (Linux x64) and `opentp.exe` (Windows x64), and a `SHA256SUMS` file. Download the binary for your platform and `SHA256SUMS`, verify the binary, and put it on your `PATH` as `opentp`:

```bash
curl -fsSL -O https://github.com/opentrackplan/opentp-cli/releases/latest/download/opentp-linux \
  -O https://github.com/opentrackplan/opentp-cli/releases/latest/download/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS   # macOS: shasum -a 256 --check --ignore-missing SHA256SUMS
chmod +x opentp-linux
mv opentp-linux ~/.local/bin/opentp             # any directory on your PATH
```

On Windows, compare `(Get-FileHash .\opentp.exe -Algorithm SHA256).Hash` with the `opentp.exe` line of `SHA256SUMS`.

> **The npm package `opentp` is obsolete.** The CLI is not published to npm. The old npm package (last version 0.5.0, spec `2025-06`) cannot read current plans; if you installed it, remove it with `npm uninstall -g opentp`.

**From source (development):** needs Node.js `^20.19.0 || >=22.12.0`.

```bash
git clone https://github.com/opentrackplan/opentp-cli.git
cd opentp-cli
npm ci
npm run build
node dist/index.cjs --version
```

## Quick Start

opentp 0.10 reads OpenTrackPlan `2026-09` plans. If you have a `2026-01` plan, upgrade it with [`opentp migrate`](/cli/migrate) first.

### 1. Create `opentp.yaml`

Create the plan file in your project root:

```yaml
# yaml-language-server: $schema=https://opentp.dev/schemas/2026-09/opentp.schema.json
opentp: 2026-09

info:
  title: My App Tracking Plan
  version: 1.0.0

spec:
  paths:
    events:
      root: /events
      template: "{area}/{event}.yaml"
    dictionaries:
      root: /dictionaries

  events:
    key:
      minLength: 3
      maxLength: 160
      pattern: "^[a-z0-9_]+::[a-z0-9_]+$"
    taxonomy:
      area:
        title: Area
        type: string
        required: true
      event:
        title: Event
        type: string
        required: true
      action:
        title: Action
        type: string
        required: true
    payload:
      targets:
        all: [web, ios, android]
      # The field catalog: the fields events may use
      schema:
        auth_method:
          type: string
          enum: [email, google, github]
        dimension_1:
          type: string
          name: orgType
          title: Organization Type
          example: enterprise

  # Common fields: part of every event on a target
  targets:
    all:
      schema:
        event_name:
          type: string
          policy: fixed
```

- `spec.events.payload.schema` is the **field catalog**: the fields an event may list. A catalog field is part of an event only when the event lists it.
- `spec.targets.all.schema` holds the **common fields**: they are part of every event (`spec.targets.<target>.schema` for one target). `policy: fixed` says that every event must set the field's `value`.
- An event may use only catalog fields and common fields: a typo such as `auth_methd` is an error, not a new field.

### 2. Create `opentp.cli.yaml` (optional)

Settings of the CLI live next to the plan in [`opentp.cli.yaml`](/cli/config). To have `opentp validate` check that every event key follows from its taxonomy, and `opentp fix` rewrite the ones that do not, add key generation:

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
```

`cli` pins the opentp versions that may run this plan, so a teammate or a CI job with another version gets a clear error instead of different results.

### 3. Create Your First Event

Create the folder structure and your first event file:

```bash
mkdir -p events/auth
```

```yaml
# events/auth/login_click.yaml
# yaml-language-server: $schema=https://opentp.dev/schemas/2026-09/event.schema.json
opentp: 2026-09

event:
  key: auth::login_click

  taxonomy:
    action: User clicks the login button

  payload:
    schema:
      event_name:
        value: login_click
      auth_method:
        required: true
      dimension_1: {}
```

Note: taxonomy fields referenced in `spec.paths.events.template` (e.g. `area`, `event`) are extracted from the file path, so you don't need to duplicate them in `event.taxonomy`.

Event fields take their `type` (and `enum`, `name`, `title`, `example`) from the catalog or the common fields, so an event writes only what it adds: a fixed `value`, `required: true`, or `{}` to list a field as it is. Use `name` when a payload field key is a transport or vendor slot, but the field has a clearer logical/code-facing name. `example` provides a representative value for documentation, mock data, and generators.

### 4. Validate

Run validation to check your tracking plan:

```bash
opentp validate
```

Expected output (on stderr):

```
✓ All events are valid count=1
```

## Project Structure

A typical OpenTrackPlan project looks like this:

```
my-tracking-plan/
├── opentp.yaml                 # The plan
├── opentp.cli.yaml             # CLI settings (optional)
├── events/                     # Event definitions
│   └── {area}/{event}.yaml
└── dictionaries/               # Reusable enums
    ├── taxonomy/
    │   └── areas.yaml
    └── data/
        └── application_id.yaml
```

## IDE Support

Add JSON schema references for autocompletion:

```yaml
# yaml-language-server: $schema=https://opentp.dev/schemas/2026-09/opentp.schema.json
opentp: 2026-09
```

Available schemas:

- `https://opentp.dev/schemas/2026-09/opentp.schema.json` — the plan (`opentp.yaml`)
- `https://opentp.dev/schemas/2026-09/event.schema.json` — events
- `https://opentp.dev/schemas/2026-09/dict.schema.json` — dictionaries
- `https://opentp.dev/schemas/cli/opentp.cli.schema.json` — CLI settings (`opentp.cli.yaml`)

## Next Steps

- [CLI Reference](/cli) — learn all available commands
- [opentp.cli.yaml](/cli/config) — CLI settings: keygen, checks, plugins, generator runs
- [Configuration](/schema/opentp-yaml) — detailed configuration options
- [Transforms](/transforms) — string transformation pipelines
- [Checks](/rules) — portable constraints and checks
