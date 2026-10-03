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
# events/auth/login_button_click.yaml
opentp: 2026-01

event:
  key: auth::login_button_click

  taxonomy:
    action: User clicks the login button

  payload:
    schema:
      event_name:
        value: login_button_click
      auth_method:
        type: string
        enum: [email, google, github]
        required: true
```

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

> **The npm package `opentp` is obsolete.** The CLI is not published to npm. The old npm package (last version 0.5.0, spec `2025-06`) cannot read `2026-01` plans; if you installed it, remove it with `npm uninstall -g opentp`.

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
opentp: 2026-01

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

    x-opentp:
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
      schema:
        application_id:
          type: string
          dict: data/application_id
          valueRequired: true
        event_name:
          type: string
          required: true
        dimension_1:
          type: string
          name: orgType
          title: Organization Type
          example: enterprise

```

### 2. Create Events

```yaml
# events/auth/login_click.yaml
opentp: 2026-01

event:
  key: auth::login_click
  taxonomy:
    action: User clicks login button
  payload:
    schema:
      application_id:
        value: web-app
      event_name:
        value: login_click
      dimension_1:
        value: enterprise
```

Note: taxonomy fields referenced in `spec.paths.events.template` (e.g. `area`, `event`) are extracted from the file path, so you don't need to duplicate them in `event.taxonomy`.

Use `name` when a payload field key is a transport or vendor slot, but the field has a clearer logical/code-facing name. `example` provides a representative value for documentation, mock data, and generators.

### 3. Validate

```bash
opentp validate
# ✓ All events are valid count=42
```

Validation fails closed (exit code `1`): event or dictionary files that cannot be loaded (YAML syntax errors with line and column, a missing `event` or `event.taxonomy`), keys that cannot be generated, checks that throw, and problems in `opentp.yaml` itself (invalid templates, unknown keygen pipelines or transform steps, unknown dictionaries or target ids) are all reported as errors. `opentp generate` refuses to export a plan that cannot be loaded completely. See [docs/validate.md](docs/validate.md).

## CLI Commands

| Command | Description                                         |
|---------|-----------------------------------------------------|
| `opentp validate` | Validate all events                                 |
| `opentp fix` | Auto-fix `event.key` (requires `spec.events.x-opentp.keygen`) |
| `opentp generate json` | Export as JSON                                      |
| `opentp generate yaml` | Export as YAML                                      |
| `opentp mcp` | Serve the plan to AI agents over MCP (stdio, read-only tools) |
| `opentp --help` | Show help                                           |
| `opentp --version` | Show version                                        |

### Options

```bash
opentp validate --root ./my-project     # Custom project root (-r; default: $OPENTP_ROOT or cwd)
opentp validate --verbose               # Debug logs on stderr (-v)
opentp validate --json > report.json    # Machine-readable result; stdout holds only the JSON
opentp validate --external-rules ./rules    # Custom validation checks (repeatable)
opentp validate --external-transforms ./transforms  # Custom keygen transforms (repeatable)
opentp generate json -o events.json     # Write to a file (relative to --root) instead of stdout
opentp generate json | jq '.events | length'   # stdout is complete and parseable
```

Logs go to stderr; stdout carries only the report, the `--json` document, the generator output, or the MCP protocol (`opentp mcp`). Arguments are strict: an unknown command or option (`opentp valdiate`), an option the command does not accept, or an unexpected argument exits with code `2`. Run `opentp --help` for every option.

| Exit code | Meaning |
|-----------|---------|
| `0` | Success |
| `1` | Validation errors, a plan that cannot be loaded completely, or a failed generator |
| `2` | Usage or configuration error: unknown command or option, invalid `OPENTP_LOG_LEVEL`, missing plugin directory, unknown generator, `opentp.yaml` missing or invalid |

### AI agents (MCP)

`opentp mcp` lets an AI agent (Claude Code, Codex, Cursor, VS Code, Claude Desktop, ...) search the plan, read an event's effective payload per target, and validate a draft before writing it. All tools are read-only; the agent writes event files itself. Commit `.mcp.json` to the plan repository:

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
opentp: 2026-01

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
    type: string
    dict: taxonomy/areas  # Reference the dictionary
```

### Transforms

Transforms modify taxonomy values when generating event keys (via `spec.events.x-opentp.keygen`).

| Transform | Description |
|-----------|-------------|
| `lower` | Lowercase |
| `upper` | Uppercase |
| `trim` | Remove whitespace |
| `replace` | Replace literal substring |
| `truncate` | Limit length |
| `collapse` | Collapse repeated characters |
| `keep` | Keep only allowed characters |
| `to-snake-case` | Convert to snake_case |
| `to-kebab` | Convert to kebab-case |
| `to-camel-case` | Convert to camelCase |
| `to-underscore` | Replace spaces with underscores |
| `transliterate` | Character mapping |

### Validation Checks

Use JSON-Schema-like constraints for portable validation (e.g. `minLength`, `maximum`, `pattern`).

For CLI-specific validation rules, use `x-opentp.checks`.

```yaml
taxonomy:
  area:
    type: string
    minLength: 1
    maxLength: 50
    pattern: "^[a-z_]+$"
    x-opentp:
      checks:
        starts-with: "a"
```

Built-in `x-opentp.checks`: `max-length`, `min-length`, `pattern`, `starts-with`, `ends-with`, `contains`, `not-empty`, `webhook`

### Webhook Validation

Validate against external API:

```yaml
taxonomy:
  company_id:
    type: string
    x-opentp:
      checks:
        webhook:
          url: https://api.company.com/validate
          headers:
            Authorization: "Bearer ${API_KEY}"
          timeout: 5000
          retries: 2
```

Allow the variables a webhook may read with `OPENTP_WEBHOOK_ENV` in the environment of the run (e.g. `OPENTP_WEBHOOK_ENV=API_KEY opentp validate` in CI); without it, opentp reads any variable and warns. It limits which variables are read, not where they are sent: whoever can change the plan (`opentp.yaml` or an event file) can point a check at another URL, so do not run webhook checks that use secrets on untrusted changes. See [docs/rules.md](docs/rules.md).

## Extensibility

### Custom Rules

```javascript
// my-rules/company-id/index.js
module.exports = {
  name: 'company-id',
  validate: (value, params, context) => {
    if (!value.startsWith('COMP-')) {
      return { valid: false, error: 'Must start with COMP-' };
    }
    return { valid: true };
  }
};
```

```bash
opentp validate --external-rules ./my-rules
```

A rule that throws does not abort validation: the field gets the error `check <name> failed: <message>`.

Plugin directories (`--external-rules`, `--external-transforms`, `--external-generators`) are resolved against the current directory. Each `<dir>/<name>/index.js` is loaded as an ES module (`export default { ... }`) or a CommonJS module (`module.exports = { ... }`), depending on the nearest `package.json`.

### Custom Transforms

```javascript
// my-transforms/reverse/index.js
module.exports = {
  name: 'reverse',
  factory: (params) => (value) => value.split('').reverse().join('')
};
```

```bash
opentp validate --external-transforms ./my-transforms
```

An unknown or malformed step in a keygen pipeline is a configuration error reported against `opentp.yaml`, so pass `--external-transforms` to `fix` and `generate` as well when the pipelines use custom steps.

## Project Structure

```
my-tracking-plan/
├── opentp.yaml                 # Main config
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
# yaml-language-server: $schema=https://opentp.dev/schemas/2026-01/event.schema.json
opentp: 2026-01
event:
  ...
```

Available schemas:
- `https://opentp.dev/schemas/2026-01/opentp.schema.json` — main config
- `https://opentp.dev/schemas/2026-01/event.schema.json` — events
- `https://opentp.dev/schemas/2026-01/dict.schema.json` — dictionaries

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
- [ ] GitHub Action
- [ ] VS Code extension
- [ ] TypeScript SDK generator
- [ ] Swift/Kotlin SDK generators
- [ ] Amplitude/Mixpanel sync

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

[Apache 2.0](./LICENSE)
