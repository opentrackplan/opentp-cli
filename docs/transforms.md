---
title: Transforms
description: String transformation pipelines for generating event keys.
sidebar:
  order: 5
---

# Transforms

Transforms modify taxonomy values when generating event keys.

They are defined in `opentp.yaml` as named pipelines of steps and referenced in `spec.events.x-opentp.keygen.template` using `{field | transformName}`.

## Defining Transforms

```yaml
# opentp.yaml
spec:
  events:
    x-opentp:
      keygen:
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

An unknown step (neither built in nor loaded with `--external-transforms`) or a malformed step (for example a mapping with two keys) is a configuration error. It is reported once, against `opentp.yaml`, at `spec.events.x-opentp.keygen.transforms.<pipeline>[<index>]`:

```
[opentp.yaml]
  ✗ spec.events.x-opentp.keygen.transforms.slug[1]: Unknown transform step 'slugify' (custom steps are loaded with --external-transforms)
```

Until it is fixed, `validate` and `fix` exit with code `1` without generating keys (`fix` rewrites nothing), and `generate` refuses to export the plan.

## Using Transforms

```yaml
# opentp.yaml
spec:
  events:
    x-opentp:
      keygen:
        template: "{area | slug}::{event | slug}"
```

## Built-in Steps

- `lower`, `upper`, `trim`
- `replace`, `truncate`
- `collapse`, `keep`
- `to-snake-case`, `to-kebab`, `to-camel-case`, `to-underscore`
- `transliterate`

## Custom Steps

Load additional transform steps from a directory:

```bash
opentp validate --external-transforms ./my-transforms
```

The directory is resolved against the current directory, and each `<dir>/<name>/index.js` is loaded as an ES module or CommonJS module, depending on the nearest `package.json`. Pass the same flag to `opentp fix` and `opentp generate` when the keygen pipelines use custom steps.

Example step module:

```javascript
// my-transforms/reverse/index.js
module.exports = {
  name: "reverse",
  factory: () => (value) => value.split("").reverse().join(""),
};
```
