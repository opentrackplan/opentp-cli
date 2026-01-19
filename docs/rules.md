---
title: Validation Checks
description: Field validation checks for enforcing constraints.
sidebar:
  order: 6
---

# Validation Checks

Checks validate field values in taxonomy and payload definitions.

## Using Checks

Add checks to field definitions:

```yaml
# opentp.yaml
spec:
  events:
    taxonomy:
      area:
        type: string
        checks:
          max-length: 50
          pattern: "^[a-z_]+$"
          not-empty: true
```

Checks can also be applied in event payload schemas:

```yaml
# events/auth/login.yaml
payload:
  schema:
    user_id:
      type: string
      checks:
        min-length: 1
        max-length: 100
```

## Built-in Checks

### max-length

Maximum string length.

```yaml
checks:
  max-length: 50
```

| Value | Params | Result |
|-------|--------|--------|
| `hello` | `50` | Valid |
| `hello...` (60 chars) | `50` | Invalid |

### min-length

Minimum string length.

```yaml
checks:
  min-length: 3
```

| Value | Params | Result |
|-------|--------|--------|
| `hello` | `3` | Valid |
| `hi` | `3` | Invalid |

### pattern

Match a regular expression.

```yaml
checks:
  pattern: "^[a-z_]+$"
```

| Value | Pattern | Result |
|-------|---------|--------|
| `hello_world` | `^[a-z_]+$` | Valid |
| `Hello World` | `^[a-z_]+$` | Invalid |

### not-empty

Value must not be empty.

```yaml
checks:
  not-empty: true
```

| Value | Result |
|-------|--------|
| `hello` | Valid |
| `` | Invalid |
| `   ` | Invalid (whitespace only) |

### starts-with

Value must start with a prefix.

```yaml
checks:
  starts-with: "app_"
```

| Value | Params | Result |
|-------|--------|--------|
| `app_login` | `app_` | Valid |
| `login` | `app_` | Invalid |

### ends-with

Value must end with a suffix.

```yaml
checks:
  ends-with: "_event"
```

| Value | Params | Result |
|-------|--------|--------|
| `login_event` | `_event` | Valid |
| `login` | `_event` | Invalid |

### contains

Value must contain a substring.

```yaml
checks:
  contains: "_"
```

| Value | Params | Result |
|-------|--------|--------|
| `hello_world` | `_` | Valid |
| `helloworld` | `_` | Invalid |

### webhook

Validate against an external API.

```yaml
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
// Valid
{ "valid": true }

// Invalid
{ "valid": false, "error": "Company ID not found" }
```

## Combining Checks

Multiple checks are evaluated in order:

```yaml
checks:
  not-empty: true
  min-length: 3
  max-length: 50
  pattern: "^[a-z_]+$"
```

All checks must pass for the value to be valid.

## Custom Checks

Create custom validation checks in JavaScript:

```javascript
// my-rules/company-id/index.js
module.exports = {
  name: 'company-id',
  validate: (value, params, context) => {
    if (!value.startsWith('COMP-')) {
      return {
        valid: false,
        error: 'Must start with COMP-'
      };
    }
    if (value.length !== 12) {
      return {
        valid: false,
        error: 'Must be exactly 12 characters'
      };
    }
    return { valid: true };
  }
};
```

Use in your tracking plan:

```yaml
taxonomy:
  company:
    type: string
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
