---
title: Transforms
description: String transformation pipelines for generating event keys.
sidebar:
  order: 7
---

# Transforms

Transforms modify taxonomy values when event keys are generated.

They are defined in [`opentp.cli.yaml`](/cli/config#keygen) as named pipelines of steps under `keygen.transforms`, and referenced in `keygen.template` as `{field | pipeline}`. (In `2026-01` plans they lived in `opentp.yaml` under `spec.events.x-opentp.keygen`; [`opentp migrate`](/cli/migrate) moves them.)

## Defining Transforms

```yaml
# opentp.cli.yaml
opentp: 2026-09

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

Each step is either:
- a string step name (e.g. `lower`)
- a single-key object with parameters (e.g. `replace: { from: " ", to: "_" }`)

A pipeline runs its steps in order; a placeholder with several pipelines (`{event | slug | short}`) runs them left to right. See the [template grammar](/cli/config#template-grammar).

An unknown step (neither built in nor loaded from a plugin) or a malformed step (for example a mapping with two keys) is a configuration error. It is reported once, against `opentp.cli.yaml`, at `keygen.transforms.<pipeline>[<index>]`:

```
[opentp.cli.yaml]
  ✗ keygen.transforms.slug[0]: Unknown transform step 'slugify' (custom steps: keygen.plugins in opentp.cli.yaml, or --external-transforms)
✗ Validation failed errorCount=1 warningCount=0 eventCount=1
```

Until it is fixed, `validate` and `fix` exit with code `1` without generating keys (`fix` rewrites nothing), and `generate` refuses to export the plan. Unknown parameters of a known step are not reported: most steps ignore parameters they cannot use.

## Built-in Steps

| Step | Parameters | Example |
|---|---|---|
| `lower` | none | `Sign Up` → `sign up` |
| `upper` | none | `Sign Up` → `SIGN UP` |
| `trim` | none (whitespace), or `{ chars: "<characters>" }` | `trim: { chars: "_" }`: `__sign_up__` → `sign_up` |
| `replace` | `{ from, to }`: every occurrence of the literal text `from` | `replace: { from: " ", to: "_" }`: `Sign Up Now` → `Sign_Up_Now` |
| `truncate` | a number, or `{ maxLen }` | `truncate: 4`: `Sign Up` → `Sign` |
| `collapse` | none: removes every character outside `A-Z`, `a-z`, `0-9` | `Sign-Up 2!` → `SignUp2` |
| `keep` | `{ chars: "<character class>" }`: keeps only those characters | `keep: { chars: "a-z_" }`: `sign up_now!` → `signup_now` |
| `to-snake-case` | none | `signUp Now` → `sign_up_now` |
| `to-kebab` | none (does not change case) | `Sign Up Now` → `Sign-Up-Now` |
| `to-camel-case` | none: lowercases, then joins on `-`, `_` and spaces | `sign_up now` → `signUpNow` |
| `to-underscore` | none: every run of characters outside `A-Z`, `a-z`, `0-9` becomes `_` (does not change case) | `Sign-Up  Now` → `Sign_Up_Now` |
| `transliterate` | `{ map: { <character>: <replacement> } }` (lowercase keys; an uppercase source character gets a capitalized replacement) | `transliterate: { map: { "é": "e", "ß": "ss" } }`: `Café Straße` → `Cafe Strasse` |

`collapse`, `keep` (with an ASCII class), `to-snake-case`, `to-kebab`, `to-underscore` and `to-camel-case` work on ASCII letters and digits: they drop or split on every other character, so a taxonomy value written in another script can become empty. Use `transliterate` first (with your own map: opentp has no built-in language presets), or write a custom step.

## Custom Steps

A step is a module with a `name` and a `factory(params)` that returns a function from string to string:

```javascript
// tools/transforms/reverse/index.js
module.exports = {
  name: "reverse",
  factory: () => (value) => value.split("").reverse().join(""),
};
```

Load custom steps in one of two ways:

- `keygen.plugins` in `opentp.cli.yaml` (directories relative to that file), loaded only with `--allow-plugins` or `OPENTP_ALLOW_PLUGINS=1`:

  ```yaml
  # opentp.cli.yaml
  opentp: 2026-09

  keygen:
    template: "{area | slug}::{event | slug}"
    transforms:
      slug:
        - lower
        - reverse
    plugins: [tools/transforms]
  ```

- `--external-transforms <dir>` on the command line (relative to the current directory, always loaded):

  ```bash
  opentp validate --external-transforms ./tools/transforms
  ```

Each `<dir>/<name>/index.js` is loaded as an ES module or a CommonJS module, depending on the nearest `package.json`. Steps are checked when the plan is loaded, so `validate`, `fix`, `generate` and `mcp` all need the plugins (pass `--allow-plugins` or the same `--external-transforms` to each). See [Plugins and --allow-plugins](/cli/config#plugins-and---allow-plugins).
