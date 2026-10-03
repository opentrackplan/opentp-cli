# OpenTrackPlan

**Open standard for describing tracking plans.** Schema-first analytics event specifications.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![CI](https://github.com/opentrackplan/opentp-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/opentrackplan/opentp-cli/actions/workflows/ci.yml)

## The Problem

Analytics tracking is broken:

1. **Analysts** describe events in Google Docs, Notion, or Confluence
2. **Developers** implement what they *think* was meant
3. **QA** checks manually, missing edge cases
4. **Data** in analytics diverges from specs
5. **Nobody knows** which events are active, deprecated, or broken

## The Solution

**Schema-first tracking plans.** Define your events in YAML, validate automatically.

```yaml
# events/auth/login_click.yaml
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
```

`auth_method` comes from the plan's field catalog (`type: string`, `enum: [email, google, github]`), so the event only says what it adds. A misspelled field is an error, two events that cannot be told apart are reported, and `opentp generate` exports the effective payload of every event per target.

This CLI reads OpenTrackPlan **2026-09** (the [specification](https://github.com/opentrackplan/opentp-spec)). `2026-01` plans are upgraded with `opentp migrate`.

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

The installers download the latest [GitHub release](https://github.com/opentrackplan/opentp-cli/releases) into `~/.opentp/bin` and verify it against the `SHA256SUMS` file of the same release (releases up to 0.7.4 have none and install with a warning). To pin a version, set `OPENTP_VERSION` on the shell that runs the script (not on `curl`):

```bash
curl -fsSL https://opentp.dev/install | OPENTP_VERSION=0.7.4 bash
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

### 1. Create `opentp.yaml`

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

The **catalog** (`spec.events.payload.schema`) lists the fields an event may use; **common fields** (`spec.targets.all.schema`, or `spec.targets.<target>.schema`) are part of every event. `policy: fixed` makes every event set the field's `value`.

### 2. Create `opentp.cli.yaml` (optional)

CLI settings live next to the plan. Key generation, for example, lets `opentp validate` check every key and `opentp fix` rewrite the wrong ones:

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

### 3. Create Events

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

Event fields take their type (and enum, name, title, example) from the catalog or the common fields. Use `name` when a payload field key is a transport or vendor slot, but the field has a clearer logical/code-facing name. `example` provides a representative value for documentation, mock data, and generators.

### 4. Validate

```bash
opentp validate
# ✓ All events are valid count=1
```

Validation fails closed (exit code `1`): event or dictionary files that cannot be loaded (YAML syntax errors with line and column, a missing `event` or `event.taxonomy`), unknown fields, keys that cannot be generated, checks that throw, and problems in `opentp.yaml` and `opentp.cli.yaml` (invalid templates, unknown keygen pipelines or transform steps, unknown dictionaries or target ids) are all reported as errors. Warnings (unknown check ids, overlapping events) are listed but do not change the exit code (`tests/data/overlap` ends with `✓ All events are valid warnings=4 count=12`). `opentp generate` refuses to export a plan that cannot be loaded completely. See [docs/validate.md](docs/validate.md).

### Upgrading a 2026-01 plan

opentp 0.10 reads only OpenTrackPlan `2026-09`. In a plan repository on `2026-01`, run:

```bash
opentp migrate --dry-run    # see what would change
opentp migrate              # rewrite the files (text edits; comments and formatting stay)
opentp validate
```

and bump every pinned opentp (`OPENTP_VERSION`, CI images, the `cli` range) to 0.10.x in the same commit. A repository that has to stay on `2026-01` can keep `OPENTP_VERSION=0.9.1`. See [docs/migrate.md](docs/migrate.md).

## CLI Commands

| Command | Description                                         |
|---------|-----------------------------------------------------|
| `opentp validate` | Validate the plan (the default command) |
| `opentp fix` | Rewrite `event.key` from `keygen` in `opentp.cli.yaml` (only the key's text changes; comments and formatting stay), then validate |
| `opentp generate json` | Export as JSON (catalog, targets, checks, every event with its raw and effective payload) |
| `opentp generate yaml` | Export as YAML |
| `opentp generate` | Run the `generate.run` entries of `opentp.cli.yaml` |
| `opentp migrate` | Upgrade a `2026-01` plan to `2026-09` |
| `opentp mcp` | Serve the plan to AI agents over MCP (stdio, read-only tools) |
| `opentp --help` | Show help                                           |
| `opentp --version` | Show version                                        |

### Options

```bash
opentp validate --root ./my-project     # Custom project root (-r; default: $OPENTP_ROOT or cwd)
opentp validate --cli-config ci.opentp.cli.yaml   # Another opentp.cli.yaml (relative to cwd)
opentp validate --verbose               # Debug logs on stderr (-v)
opentp validate --json > report.json    # Machine-readable result; stdout holds only the JSON
opentp validate --fail-on overlap       # Report overlapping events (or unknownCheck) as errors
opentp validate --allow-plugins         # Load the plugins named in opentp.cli.yaml
opentp validate --external-rules ./rules    # Custom checks (repeatable)
opentp validate --external-transforms ./transforms  # Custom keygen transforms (repeatable)
opentp generate json -o events.json     # Write to a file (relative to --root) instead of stdout
opentp generate json | jq '.events | length'   # stdout is complete and parseable
```

Logs go to stderr; stdout carries only the report, the `--json` document, the generator output, the list of migrated files, or the MCP protocol (`opentp mcp`). Arguments are strict: an unknown command or option (`opentp valdiate`), an option the command does not accept, or an unexpected argument exits with code `2`. Run `opentp --help` for every option.

| Exit code | Meaning |
|-----------|---------|
| `0` | Success (warnings do not change the exit code) |
| `1` | Validation errors, a plan that cannot be loaded completely, or a failed generator; `migrate --check` found files to migrate |
| `2` | Usage or configuration error: unknown command or option, invalid `OPENTP_LOG_LEVEL`, missing plugin directory, unknown generator, `opentp.yaml` missing or invalid (including a `2026-01` plan), `opentp.cli.yaml` not usable, `fix` without `keygen` |

### opentp.cli.yaml

Settings of this CLI live in `opentp.cli.yaml` next to `opentp.yaml` (or `--cli-config`), never in the plan: `keygen` (event key generation), `checks` (check bindings such as webhooks, check plugins, the severity of `overlap` and `unknownCheck`), `tracker` (where each field travels in a Snowplow, GA4, Amplitude or Segment payload), `generate` (generator plugins and the runs of `opentp generate`), `mcp` (the tool groups) and, in an application repository that uses a plan from another repository, `plan:` (a directory, or a git URL pinned to a tag or commit SHA). Plugins named there load only with `--allow-plugins` or `OPENTP_ALLOW_PLUGINS=1`. See [docs/config.md](docs/config.md).

### AI agents (MCP)

`opentp mcp` lets an AI agent (Claude Code, Codex, Cursor, VS Code, Claude Desktop, ...) search the plan, read an event's effective payload per target, and validate a draft (including its overlap with existing events) before writing it. All tools are read-only; the agent writes event files itself. Commit `.mcp.json` to the plan repository:

```json
{
  "mcpServers": {
    "opentp": { "command": "opentp", "args": ["mcp"] }
  }
}
```

Tools: `describe_plan`, `search_events`, `get_event`, `list_dictionaries`, `get_dictionary`, `validate_event_draft`, `validate_plan`, `suggest_event`, `generate`. Configuration for other clients and details: [docs/mcp.md](docs/mcp.md).

## Key Concepts

### Taxonomy vs Payload

| | Taxonomy | Payload |
|-|----------|---------|
| **Purpose** | Organize events for humans | Send data to analytics |
| **Contains** | area, event, action, owner | event_name, dimensions, properties |
| **Used for** | Folder structure, search, ownership | Amplitude, Mixpanel, GA |

They are intentionally separate for flexibility.

### Dictionaries

Define allowed values once, reference everywhere:

```yaml
# dictionaries/taxonomy/areas.yaml
opentp: 2026-09

dict:
  type: string
  values:
    - auth
    - dashboard
    - onboarding
```

```yaml
# opentp.yaml
taxonomy:
  area:
    title: Area
    type: string
    dict: taxonomy/areas  # Reference the dictionary
```

### Catalog, common fields and policy

`spec.events.payload.schema` is the field catalog: the fields an event may list (each with a `type`). `spec.targets.all.schema` and `spec.targets.<target>.schema` hold the common fields, which are part of every event on that target. An event field is merged over both (it needs no `type` of its own), and a field that is in neither is an error. A `policy` on a catalog or common field says what every event must write: `specified` (list the field), `restricted` (a `value`, `enum` or `dict`; an array field only a `value`) or `fixed` (a `value`).

### Transforms

Transforms modify taxonomy values when event keys are generated (`keygen.transforms` in `opentp.cli.yaml`). See [docs/transforms.md](docs/transforms.md).

| Transform | Description |
|-----------|-------------|
| `lower` | Lowercase |
| `upper` | Uppercase |
| `trim` | Remove whitespace (or the characters in `chars`) at both ends |
| `replace` | Replace every occurrence of a literal substring |
| `truncate` | Limit length |
| `collapse` | Remove every character outside `A-Z`, `a-z`, `0-9` |
| `keep` | Keep only the characters of a character class |
| `to-snake-case` | Convert to snake_case |
| `to-kebab` | Replace every run of non-alphanumeric characters with `-` (case unchanged) |
| `to-camel-case` | Convert to camelCase |
| `to-underscore` | Replace every run of non-alphanumeric characters with `_` (case unchanged) |
| `transliterate` | Character mapping |

### Validation Checks

Use JSON-Schema-like constraints for portable validation (e.g. `minLength`, `maximum`, `pattern`, `format`), and named checks for the rest. `checks: { <id>: <params> }` refers to a portable check in `spec.checks`, a built-in check, a check bound in `opentp.cli.yaml`, or a plugin:

```yaml
# opentp.yaml
spec:
  checks:
    jira-key:
      pattern: "^[A-Z]+-[0-9]+$"
  events:
    taxonomy:
      area:
        title: Area
        type: string
        minLength: 1
        maxLength: 50
        pattern: "^[a-z_]+$"
        checks:
          starts-with: "a"
      ticket:
        title: Ticket
        type: string
        checks:
          jira-key: true
```

Built-in checks: `max-length`, `min-length`, `pattern`, `starts-with`, `ends-with`, `contains`, `not-empty`. An id that nothing defines is a warning (`unknownCheck`), so a plan can carry checks for other tools. See [docs/rules.md](docs/rules.md).

### Webhook Validation

Webhooks are bound in `opentp.cli.yaml` and referred to by id in the plan (`ticket-exists: true`):

```yaml
# opentp.cli.yaml
opentp: 2026-09

checks:
  bindings:
    ticket-exists:
      webhook:
        url: https://tickets.example.com/api/check
        headers:
          Authorization: "Bearer ${TICKETS_TOKEN}"
        timeout: 5000
        retries: 2
```

A webhook may read only the variables listed in `OPENTP_WEBHOOK_ENV` in the environment of the run (e.g. `OPENTP_WEBHOOK_ENV=TICKETS_TOKEN opentp validate` in CI); unset, it may read none. It limits which variables are read, not where they are sent: whoever can change `opentp.cli.yaml` can point a binding at another URL, so protect that file like code and do not run webhook checks that use secrets on untrusted changes. See [docs/rules.md](docs/rules.md).

## Extensibility

Plugins are JavaScript modules: custom checks, keygen transform steps and generators. Name their directories in `opentp.cli.yaml` (`checks.plugins`, `keygen.plugins`, `generate.plugins`, relative to that file) and allow them per run with `--allow-plugins` or `OPENTP_ALLOW_PLUGINS=1`; without that, opentp warns and runs without them, so a change to the repository cannot make every machine run new code. The `--external-rules`, `--external-transforms` and `--external-generators` options (relative to the current directory) always load. Each `<dir>/<name>/index.js` is loaded as an ES module (`export default { ... }`) or a CommonJS module (`module.exports = { ... }`), depending on the nearest `package.json`. See [docs/config.md](docs/config.md).

### Custom Rules

```javascript
// tools/checks/company-id/index.js
module.exports = {
  name: 'company-id',
  validate: (value, params, context) =>
    typeof value === 'string' && value.startsWith('COMP-')
      ? { valid: true }
      : { valid: false, error: 'Must start with COMP-' },
};
```

```yaml
# opentp.cli.yaml
opentp: 2026-09

checks:
  plugins: [tools/checks]
```

```bash
opentp validate --allow-plugins                  # checks.plugins of opentp.cli.yaml
opentp validate --external-rules ./tools/checks  # or name the directory on the command line
```

The plan refers to the check by name (`checks: { company-id: true }`). A rule that throws does not abort validation: the value gets the error `check <name> failed: <message>`. See [docs/rules.md](docs/rules.md).

### Custom Transforms

```javascript
// tools/transforms/reverse/index.js
module.exports = {
  name: 'reverse',
  factory: (params) => (value) => value.split('').reverse().join('')
};
```

```yaml
# opentp.cli.yaml
opentp: 2026-09

keygen:
  template: "{area | slug}::{event | slug}"
  transforms:
    slug: [lower, reverse]
  plugins: [tools/transforms]
```

```bash
opentp validate --allow-plugins
opentp validate --external-transforms ./tools/transforms
```

An unknown or malformed step in a keygen pipeline is a configuration error reported against `opentp.cli.yaml`, so allow the plugins (or pass `--external-transforms`) for `fix`, `generate` and `mcp` as well. See [docs/transforms.md](docs/transforms.md).

## Project Structure

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

See `tests/data/coverage-valid/` for a complete working example used by the CLI test suite.

## JSON Schemas

IDE autocompletion and validation:

```yaml
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
```

Available schemas:
- `https://opentp.dev/schemas/2026-09/opentp.schema.json` — the plan (`opentp.yaml`)
- `https://opentp.dev/schemas/2026-09/event.schema.json` — events
- `https://opentp.dev/schemas/2026-09/dict.schema.json` — dictionaries
- `https://opentp.dev/schemas/cli/opentp.cli.schema.json` — CLI settings (`opentp.cli.yaml`; this repository's `schemas/opentp.cli.schema.json`)

## Enterprise Installation

To install from an internal mirror of the release assets, set `OPENTP_DOWNLOAD_BASE` to the mirror's `.../releases/download` URL. Set it on `bash` (the shell that runs the installer), not on `curl`:

```bash
curl -fsSL https://opentp.dev/install | \
  OPENTP_DOWNLOAD_BASE="https://github.mycompany.com/<org>/opentp-cli/releases/download" bash
```

```powershell
$env:OPENTP_DOWNLOAD_BASE = "https://github.mycompany.com/<org>/opentp-cli/releases/download"
irm opentp.dev/install.ps1 | iex
```

How the download URL is built:

| | URL |
|---|---|
| Pinned (`OPENTP_VERSION=0.7.4`) | `$OPENTP_DOWNLOAD_BASE/v0.7.4/<asset>` |
| Latest (default) | The tag is read once from the redirect of `$OPENTP_DOWNLOAD_BASE` without the trailing `/download`, then `/latest/download/<asset>`; the binary and `SHA256SUMS` are then downloaded as for that pinned version |

Assets are `opentp-mac`, `opentp-mac-intel`, `opentp-linux`, `opentp.exe` and `SHA256SUMS`. "Latest" works only for a base that ends with `/releases/download` and redirects `latest/download/<asset>` to `<tag>/<asset>` (GitHub and GitHub Enterprise); for any other mirror layout, set `OPENTP_VERSION` as well. Releases up to 0.7.4 have no `SHA256SUMS` and are installed with a warning; for any later release a missing `SHA256SUMS`, a missing entry or a checksum mismatch aborts the install, so mirror `SHA256SUMS` together with the binaries.

These variables are not persisted (set them again when needed).

## Roadmap

- [x] CLI validation
- [x] JSON Schemas
- [x] Auto-fix keys
- [x] Validation checks system
- [x] Custom checks and transforms
- [x] Generators (JSON, YAML)
- [x] MCP server for AI agents (`opentp mcp`)
- [x] Overlapping-event detection, tracker bindings, application repositories, `opentp migrate`
- [ ] GitHub Action
- [ ] VS Code extension
- [ ] TypeScript SDK generator
- [ ] Swift/Kotlin SDK generators
- [ ] Amplitude/Mixpanel sync

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

[Apache 2.0](./LICENSE)
