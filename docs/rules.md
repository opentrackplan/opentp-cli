---
title: Checks
description: Portable constraints and named checks - spec.checks, built-in checks, check bindings, webhooks and custom checks.
sidebar:
  order: 8
---

# Checks

A tracking plan validates values in two ways:

- **Constraints**: JSON-Schema-like keywords written on a field (`minLength`, `pattern`, `minimum`, ...). They are part of OpenTrackPlan, so every tool applies them the same way.
- **Checks**: named validations written as `checks: { <id>: <params> }`. A check id is defined in the plan itself (`spec.checks`, portable) or implemented by a tool: a built-in check of this CLI, a check bound in [`opentp.cli.yaml`](/cli/config#checks) (a rule with default parameters, or a webhook), or a plugin.

## Constraints

Use constraints directly on fields: taxonomy fields and fragments, payload fields (catalog, common and event fields), array `items`, PII settings, and `spec.events.key`:

```yaml
# opentp.yaml
spec:
  events:
    taxonomy:
      area:
        title: Area
        type: string
        minLength: 1
        maxLength: 50
        pattern: "^[a-z_]+$"
    payload:
      targets:
        all: [web]
      schema:
        user_id:
          type: string
          minLength: 1
          maxLength: 100
        release_date:
          type: string
          format: date
```

| Type | Keywords |
|---|---|
| `string` | `minLength`, `maxLength` (counted in Unicode code points), `pattern` (ECMAScript regular expression with the `u` flag, not anchored: add `^` and `$`), `format` (`date`, `date-time`, `email`, `uuid`, `uri`, `ipv4`, `ipv6`) |
| `number`, `integer` | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf` |
| `array` | `minItems`, `maxItems`, `uniqueItems`, and `items` with the keywords of its type |

Constraints apply to fixed values (`value`), enum members, examples, taxonomy values, PII values and event keys. A failed `format` reads `Value is not a valid <format>`. `ipv4` means four decimal octets from 0 to 255 without leading zeros (`192.168.1.1`; `192.168.001.1` is not valid), as JSON Schema validators read it.

## checks

`checks` can be written on payload fields and their `items`, on taxonomy fields and fragments, and on PII settings and PII meta fields. Ids start with a letter and contain only letters, digits, `_`, `.` and `-` (any other id is an error, not an unknown check); tool-specific ids often carry a prefix (`acme.no-pii`). Parameters are whatever the check takes; `false` disables a check (for example one inherited from the catalog), and `true` means "with the default parameters".

```yaml
taxonomy:
  ticket:
    title: Ticket
    type: string
    checks:
      jira-key: true          # spec.checks.jira-key
      ticket-exists: true     # a webhook binding in opentp.cli.yaml
payload:
  schema:
    screen_name:
      type: string
      checks:
        not-empty: true       # a built-in check
        starts-with: "scr_"   # a built-in check with parameters
```

`checks` merge by id across the layers of a field (catalog, `spec.targets.all`, `spec.targets.<target>`, the event): a later layer replaces the parameters of an id, or turns it off with `false`.

### Where a check id comes from

opentp looks up an id in this order:

1. `spec.checks` in `opentp.yaml`: a portable check (below). Its parameters must be `true` or `false`.
2. `checks.bindings` in `opentp.cli.yaml`: a rule with default parameters, or a webhook.
3. A built-in check, or a check loaded from a plugin (`checks.plugins` with `--allow-plugins`, or `--external-rules`).

A `spec.checks` id that is also the name of a built-in or plugin check wins, with one warning (`spec.checks.not-empty shadows the tool check 'not-empty'`). A binding cannot reuse a built-in, plugin or `spec.checks` id (exit code `2`). `webhook` is reserved: webhooks are bound in `opentp.cli.yaml` and referred to by the binding's id, so `checks: { webhook: {...} }` in the plan is an error:

```
[auth/login_click.yaml]
  ✗ payload.schema.auth_method.checks.webhook: Webhook checks are bound in opentp.cli.yaml (checks.bindings.<id>.webhook); refer to them by id
```

### Unknown check ids

An id that none of these define is reported as a warning (tool rule `unknownCheck`), once for `opentp.yaml` and once per event file, and skipped. The plan stays valid: another tool may implement it.

```
[auth/login_click.yaml]
  ⚠ payload.schema.auth_method.checks.acme.no-pii: Unknown check 'acme.no-pii': not in spec.checks, not a built-in or plugin check, not bound in opentp.cli.yaml
✓ All events are valid warnings=1 count=1
```

`--fail-on unknownCheck` (or `checks.severity.unknownCheck: error` in `opentp.cli.yaml`) makes them errors; `checks.severity.unknownCheck: off` hides them.

A check bound to a rule that is not loaded (a plugin rule from `checks.plugins` without `--allow-plugins`) is skipped the same way, with its own message: `Check 'mine' is bound to rule 'my-rule', which is not loaded: plugins from checks.plugins load only with --allow-plugins or OPENTP_ALLOW_PLUGINS=1`.

## Portable checks (`spec.checks`)

A portable check is a named set of constraints in `opentp.yaml`. Every tool that reads OpenTrackPlan `2026-09` runs it, so it is the way to share a rule across fields:

```yaml
# opentp.yaml
spec:
  checks:
    jira-key:
      description: A ticket key such as ANALYTICS-123
      pattern: "^[A-Z]+-[0-9]+$"
      maxLength: 32
```

A portable check has a `title`, a `description`, `x-*` keys and at least one of `minLength`, `maxLength`, `pattern`, `format`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`. A value passes when it satisfies every keyword that applies to its type (string keywords to strings, number keywords to numbers). Fields refer to it with `true`:

```
[auth/login_click.yaml]
  ✗ taxonomy.ticket: Value does not match pattern "^[A-Z]+-[0-9]+$" (check 'jira-key')
```

## Built-in checks

| Id | Parameters | Passes when the value |
|---|---|---|
| `not-empty` | `true`, or `{ trim: true }` | is not null, an empty string (after trimming with `trim`), an empty array or an empty object |
| `min-length` | a number | is a string of at least that many code points |
| `max-length` | a number | is a string of at most that many code points |
| `pattern` | a regular expression, or `{ pattern, flags }` | is a string that matches it |
| `starts-with` | a string | is a string that starts with it |
| `ends-with` | a string | is a string that ends with it |
| `contains` | a string | is a string that contains it |

Prefer the portable constraints (`minLength`, `pattern`, ...) or `spec.checks` where they fit: every tool understands them.

## Check bindings

`checks.bindings` in `opentp.cli.yaml` gives a check id an implementation that the plan refers to by name. A **rule binding** names a built-in or plugin check and its default parameters:

```yaml
# opentp.cli.yaml
opentp: 2026-09

checks:
  bindings:
    snake-case:
      rule: pattern
      params: "^[a-z][a-z0-9_]*$"
```

Where the plan writes `snake-case: true`, the `pattern` check runs with `params`; other parameters written in the plan replace them. With the `jira-key` check and the binding above, an event that sets `ticket: analytics-12` and `screen_name: { value: Login Screen }` gets:

```
[auth/login_click.yaml]
  ✗ taxonomy.ticket: Value does not match pattern "^[A-Z]+-[0-9]+$" (check 'jira-key')
  ✗ payload.web.schema.screen_name.value: Value "Login Screen" does not match pattern /^[a-z][a-z0-9_]*$/
  ✗ payload.ios.schema.screen_name.value: Value "Login Screen" does not match pattern /^[a-z][a-z0-9_]*$/
  ✗ payload.android.schema.screen_name.value: Value "Login Screen" does not match pattern /^[a-z][a-z0-9_]*$/
✗ Validation failed errorCount=4 warningCount=0 eventCount=1
```

A **webhook binding** sends values to an HTTP endpoint (below). See [checks](/cli/config#checks) for every key of a binding.

## Which values are checked

| Check | Runs on |
|---|---|
| Portable checks (`spec.checks`) | Everything constraints apply to: fixed values (`value`), enum members (also `items.enum`), examples, taxonomy values and fragments, PII values |
| Every other check (built-in, bound, plugin) | Fixed values (`value`), taxonomy values and fragments, PII values |

An array value is checked item by item (paths end in `[<index>]`); the items of an array example also get the portable checks of `items`. A field without a fixed value (a free field) has no value in the plan to check, so its checks do not run until the field gets a `value`. Values written in `opentp.yaml` (a fixed value of a common field, or a PII value of a catalog or common field, for example) are checked once, against `opentp.yaml`; checks that an event adds to an inherited fixed value run in that event. A check that throws, rejects or returns no result does not stop the run: that value gets `check <id> failed: <message>`.

## Webhook checks

A webhook binding validates values against an external service:

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
        timeout: 2000
```

```yaml
# opentp.yaml
spec:
  events:
    taxonomy:
      ticket:
        title: Ticket
        type: string
        checks:
          ticket-exists: true
```

For each checked value, opentp sends a request (`POST` by default) with a JSON body:

```json
{"field":"ticket","value":"ANALYTICS-12","params":true,"context":{"eventKey":"auth::login_click","fieldPath":"taxonomy.ticket"}}
```

`params` is what the plan writes for the id (`true` above). A `2xx` response means valid. Any other status means invalid; the error is the `error` (or `message`) member of a JSON response body, else `Webhook returned <status>`:

```
[auth/login_click.yaml]
  ✗ taxonomy.ticket: Ticket ANALYTICS-12 not found
```

A timeout gives `Webhook timeout after <ms>ms`, a network error `Webhook error: <message>`. `retries` repeats a request after a network error or a timeout (not after a non-2xx response), and `cache` reuses a result for the same value and field for that many milliseconds.

### Environment variables

`url` and `headers` may use `${NAME}`. opentp reads only the variables listed in `OPENTP_WEBHOOK_ENV` (names separated by commas or spaces), which must be set in the environment of the run, for example in your CI job, never in a file:

```bash
TICKETS_TOKEN=... OPENTP_WEBHOOK_ENV=TICKETS_TOKEN opentp validate
```

Unset or empty, `OPENTP_WEBHOOK_ENV` allows no variables (opentp up to 0.9.x read every variable when it was unset). A check that uses a variable that is not allowed fails and sends no request:

```
[auth/login_click.yaml]
  ✗ taxonomy.ticket: Webhook check uses environment variables that OPENTP_WEBHOOK_ENV does not allow: TICKETS_TOKEN. No request was sent (set OPENTP_WEBHOOK_ENV=TICKETS_TOKEN in the environment of the run to allow them)
```

### Security

`OPENTP_WEBHOOK_ENV` limits which variables a webhook can read, not where it sends them. Webhooks are defined only in `opentp.cli.yaml` (the plan can only refer to a binding by its id), so protect that file like code (see the [CODEOWNERS recommendation](/cli/config#plugins-and---allow-plugins)), and do not run webhook checks that use secrets on changes you do not trust (for example on pull requests from forks). `opentp mcp` never runs a webhook binding for a draft that an agent sends; it does run them for the files on disk.

## Custom Checks

Create custom checks in JavaScript:

```javascript
// tools/checks/company-id/index.js
module.exports = {
  name: "company-id",
  validate: (value, params, context) =>
    typeof value === "string" && value.startsWith("COMP-")
      ? { valid: true }
      : { valid: false, error: "Must start with COMP-" },
};
```

Use it in your tracking plan:

```yaml
taxonomy:
  company:
    title: Company
    type: string
    checks:
      company-id: true
```

Load it in one of two ways:

- `checks.plugins: [tools/checks]` in `opentp.cli.yaml` (relative to that file), loaded only with `--allow-plugins` or `OPENTP_ALLOW_PLUGINS=1` (see [Plugins and --allow-plugins](/cli/config#plugins-and---allow-plugins));
- `--external-rules ./tools/checks` on the command line (relative to the current directory, always loaded):

```bash
opentp validate --allow-plugins
opentp validate --external-rules ./tools/checks
```

Each `<dir>/<name>/index.js` is loaded as an ES module (`export default { ... }`) or a CommonJS module (`module.exports = { ... }`), depending on the nearest `package.json` (`"type": "module"` or not). A check registers under its `name`; a plugin with the name of a built-in check replaces it. A check that is not loaded is an unknown check (a warning).

A check should return `{ valid: false, error }` for invalid values rather than throw. If a check throws (or its promise rejects, or it returns something other than a result object), validation does not stop: the value gets the error `check <name> failed: <message>` and the run exits with code `1`.

### Check Context

Custom checks receive a context object:

```javascript
validate: (value, params, context) => {
  // context.fieldName  - field name
  // context.fieldPath  - the path of the checked value (e.g. "taxonomy.area", "payload.web.schema.user_id.value")
  // context.eventKey   - current event key (e.g. "auth::login_click"; empty for values in opentp.yaml)
}
```
