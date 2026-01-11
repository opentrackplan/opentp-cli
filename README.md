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
opentp: 2025-06

event:
  key: auth::login_button_click

  taxonomy:
    area: auth
    event: login_button_click
    action: User clicks the login button

  payload:
    platforms:
      all:
        active: 1.0.0
        history:
          1.0.0:
            schema:
              event_name:
                value: login_button_click
              auth_method:
                enum: [email, google, github]
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
opentp: 2025-06

info:
  title: My App Tracking Plan
  version: 1.0.0

spec:
  events:
    key:
      pattern: "{area | slug}::{event | slug}"
    paths:
      events:
        root: /events
        pattern: "{area}/{event}.yaml"
      dictionaries:
        root: /dictionaries
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
      platforms:
        all: [web, ios, android]
      schema:
        event_name:
          type: string
          required: true

  transforms:
    slug:
      steps:
        - step: lower
        - step: trim
        - step: replace
          params:
            pattern: " "
            with: "_"
```

### 2. Create Events

```yaml
# events/auth/login_click.yaml
opentp: 2025-06

event:
  key: auth::login_click
  taxonomy:
    action: User clicks login button
  payload:
    platforms:
      all:
        active: 1.0.0
        history:
          1.0.0:
            schema:
              event_name:
                value: login_click
```

### 3. Validate

```bash
opentp validate
# ✓ All events are valid count=42
```

## CLI Commands

| Command | Description                                         |
|---------|-----------------------------------------------------|
| `opentp validate` | Validate all events                                 |
| `opentp fix` | Auto-fix structure and event keys based on taxonomy |
| `opentp generate json` | Export as JSON                                      |
| `opentp generate yaml` | Export as YAML                                      |
| `opentp --help` | Show help                                           |
| `opentp --version` | Show version                                        |

### Options

```bash
opentp validate --root ./my-project     # Custom project root
opentp validate --verbose               # Verbose output
opentp validate --external-rules ./rules    # Custom validation rules
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
opentp: 2025-06

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

Transform taxonomy values into event keys:

| Transform | Description |
|-----------|-------------|
| `lower` | Lowercase |
| `upper` | Uppercase |
| `trim` | Remove whitespace |
| `replace` | Replace pattern |
| `truncate` | Limit length |
| `to-snake-case` | Convert to snake_case |
| `to-kebab` | Convert to kebab-case |
| `to-camel-case` | Convert to camelCase |
| `transliterate` | Character mapping |

### Validation Rules

Add rules to fields:

```yaml
taxonomy:
  area:
    type: string
    rules:
      max-length: 50
      regex: "^[a-z_]+$"
      not-empty: true
```

Built-in rules: `max-length`, `min-length`, `regex`, `starts-with`, `ends-with`, `contains`, `not-empty`, `webhook`

### Webhook Validation

Validate against external API:

```yaml
taxonomy:
  company_id:
    type: string
    rules:
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

See [example/](./example) for a complete working example.

## JSON Schemas

IDE autocompletion and validation:

```yaml
# yaml-language-server: $schema=https://opentp.dev/schemas/latest/event.schema.json
opentp: 2025-06
event:
  ...
```

Available schemas:
- `https://opentp.dev/schemas/latest/opentp.schema.json` — main config
- `https://opentp.dev/schemas/latest/event.schema.json` — events
- `https://opentp.dev/schemas/latest/dict.schema.json` — dictionaries

## Enterprise Installation

For internal/private repositories:

```bash
OPENTP_BASE_URL="https://github.mycompany.com/org/opentrackplan/releases" \
  curl -fsSL https://opentp.dev/install | bash
```

Config is saved to `~/.opentp/config` for future upgrades.

## Roadmap

- [x] CLI validation
- [x] JSON Schemas
- [x] Auto-fix keys
- [x] Validation rules system
- [x] Custom rules and transforms
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
