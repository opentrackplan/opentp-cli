# OpenTrackPlan

**Open standard for describing tracking plans.** Schema-first analytics event specifications.

[![npm version](https://img.shields.io/npm/v/opentp.svg)](https://www.npmjs.com/package/opentp)
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

**macOS / Linux:**
```bash
curl -fsSL https://opentp.dev/install | bash
```

**Windows (PowerShell):**
```powershell
irm opentp.dev/install.ps1 | iex
```

**npm:**
```bash
npm install -g opentp
```

**npx (no install):**
```bash
npx opentp validate
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
```

Note: taxonomy fields referenced in `spec.paths.events.template` (e.g. `area`, `event`) are extracted from the file path, so you don't need to duplicate them in `event.taxonomy`.

### 3. Validate

```bash
opentp validate
# ✓ All events are valid count=42
```

## CLI Commands

| Command | Description                                         |
|---------|-----------------------------------------------------|
| `opentp validate` | Validate all events                                 |
| `opentp fix` | Auto-fix `event.key` (requires `spec.events.x-opentp.keygen`) |
| `opentp generate json` | Export as JSON                                      |
| `opentp generate yaml` | Export as YAML                                      |
| `opentp --help` | Show help                                           |
| `opentp --version` | Show version                                        |

### Options

```bash
opentp validate --root ./my-project     # Custom project root
opentp validate --verbose               # Verbose output
opentp validate --external-rules ./rules    # Custom validation checks
opentp validate --external-transforms ./transforms  # Custom transforms
```

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

For internal/private repositories:

```bash
OPENTP_DOWNLOAD_BASE="https://github.mycompany.com/org/opentrackplan/opentp-cli/releases/download" \
  curl -fsSL https://opentp.dev/install | bash
```

The `OPENTP_DOWNLOAD_BASE` value is not persisted (set it again when needed).

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
