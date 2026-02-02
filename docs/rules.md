---
title: Constraints & Rules
description: Portable JSON-Schema-like constraints, plus optional opentp-cli checks.
sidebar:
  order: 6
---

# Constraints & Rules

OpenTrackPlan `2026-01` standardizes JSON-Schema-like constraints on fields (e.g. `minLength`, `maximum`, `pattern`).

`opentp-cli` also supports additional validation via the `x-opentp.checks` extension. These checks are implemented by the CLI (built-in rules + external rules loaded via `--external-rules`).

## Pinned values per event (`valueRequired`)

Use `valueRequired: true` when a field must be pinned to a single constant per event (for example `application_id`).

`valueRequired` is independent of `required`. `required: false` + `valueRequired: true` is valid and means the field may be omitted in payload, but if present it must equal the fixed `value`.

Tooling enforces `valueRequired: true` by requiring a fixed `value` when either:

- the field is required (`required: true` in the effective schema), or
- the event explicitly defines the field in its payload schema.

```yaml
# opentp.yaml
spec:
  events:
    payload:
      schema:
        application_id:
          type: string
          dict: data/application_id
          valueRequired: true
```

```yaml
# events/auth/login.yaml
payload:
  schema:
    application_id:
      value: web-app
```

## Using Constraints (portable)

Use constraints directly on fields in taxonomy and payload schemas:

```yaml
# opentp.yaml
spec:
  events:
    taxonomy:
      area:
        type: string
        minLength: 1
        maxLength: 50
        pattern: "^[a-z_]+$"
```

```yaml
# events/auth/login.yaml
payload:
  schema:
    user_id:
      type: string
      minLength: 1
      maxLength: 100
```

## Using `x-opentp.checks` (opentp-cli extension)

Add checks under `x-opentp.checks`:

```yaml
taxonomy:
  company_id:
    type: string
    x-opentp:
      checks:
        starts-with: "COMP-"
```

Built-in `x-opentp.checks` in `opentp-cli`:

- `max-length`, `min-length`, `pattern`
- `starts-with`, `ends-with`, `contains`, `not-empty`
- `webhook`

### webhook

Validate against an external API.

```yaml
x-opentp:
  checks:
    webhook:
      url: https://api.company.com/validate
      headers:
        Authorization: "Bearer ${API_KEY}"
      timeout: 5000
      retries: 2
```

#### Webhook Parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | Validation endpoint URL |
| `headers` | object | No | HTTP headers |
| `timeout` | number | No | Timeout in ms (default: 5000) |
| `retries` | number | No | Retry attempts (default: 0) |

#### Environment Variables

Use `${VAR_NAME}` to reference environment variables:

```yaml
webhook:
  url: ${VALIDATOR_URL}/check
  headers:
    Authorization: "Bearer ${API_KEY}"
```

#### Expected Response

The webhook should return JSON:

```json
{ "valid": true }
```

```json
{ "valid": false, "error": "Company ID not found" }
```

## Combining `x-opentp.checks`

Multiple checks are evaluated in order:

```yaml
x-opentp:
  checks:
    not-empty: true
    starts-with: "app_"
    contains: "_"
```

All checks must pass for the value to be valid.

## Custom Checks

Create custom validation checks in JavaScript:

```javascript
// my-rules/company-id/index.js
module.exports = {
  name: "company-id",
  validate: (value, params, context) => {
    if (!value.startsWith("COMP-")) {
      return {
        valid: false,
        error: "Must start with COMP-",
      };
    }
    return { valid: true };
  },
};
```

Use in your tracking plan:

```yaml
taxonomy:
  company:
    type: string
    x-opentp:
      checks:
        company-id: true
```

Load with CLI:

```bash
opentp validate --external-rules ./my-rules
```

### Rule Context

Custom checks receive a context object:

```javascript
validate: (value, params, context) => {
  // context.fieldName  - field name
  // context.fieldPath  - full path (e.g., "taxonomy.area")
  // context.eventKey   - current event key (e.g., "auth::login_click")
  // context.specField  - field definition from opentp.yaml (optional)
}
```
