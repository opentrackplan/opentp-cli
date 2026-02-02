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

Example step module:

```javascript
// my-transforms/reverse/index.js
module.exports = {
  name: "reverse",
  factory: () => (value) => value.split("").reverse().join(""),
};
```
