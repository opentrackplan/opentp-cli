---
title: Transforms
description: String transformation pipelines for event keys.
sidebar:
  order: 5
---

# Transforms

Transforms modify taxonomy values when generating event keys. They're defined as pipelines of steps.

## Defining Transforms

```yaml
# opentp.yaml
spec:
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

## Using Transforms

Reference transforms in key patterns:

```yaml
spec:
  events:
    key:
      pattern: "{area | slug}::{event | slug}"
```

Multiple transforms can be chained:

```yaml
pattern: "{area | lower | truncate}::{event | slug}"
```

## Built-in Transforms

### lower

Converts string to lowercase.

```yaml
- step: lower
```

| Input | Output |
|-------|--------|
| `Hello World` | `hello world` |
| `AUTH` | `auth` |

### upper

Converts string to uppercase.

```yaml
- step: upper
```

| Input | Output |
|-------|--------|
| `hello world` | `HELLO WORLD` |
| `auth` | `AUTH` |

### trim

Removes leading and trailing whitespace.

```yaml
- step: trim
```

| Input | Output |
|-------|--------|
| `  hello  ` | `hello` |
| `auth ` | `auth` |

### replace

Replaces occurrences of a pattern.

```yaml
- step: replace
  params:
    pattern: " "
    with: "_"
```

| Params | Input | Output |
|--------|-------|--------|
| `pattern: " ", with: "_"` | `hello world` | `hello_world` |
| `pattern: "-", with: "_"` | `my-event` | `my_event` |

### truncate

Limits string length.

```yaml
- step: truncate
  params:
    maxLen: 50
```

| Params | Input | Output |
|--------|-------|--------|
| `maxLen: 10` | `hello world` | `hello worl` |
| `maxLen: 5` | `auth` | `auth` |

### to-snake-case

Converts to snake_case.

```yaml
- step: to-snake-case
```

| Input | Output |
|-------|--------|
| `Hello World` | `hello_world` |
| `helloWorld` | `hello_world` |
| `HelloWorld` | `hello_world` |

### to-kebab

Converts to kebab-case.

```yaml
- step: to-kebab
```

| Input | Output |
|-------|--------|
| `Hello World` | `hello-world` |
| `helloWorld` | `hello-world` |
| `HelloWorld` | `hello-world` |

### to-camel-case

Converts to camelCase.

```yaml
- step: to-camel-case
```

| Input | Output |
|-------|--------|
| `hello world` | `helloWorld` |
| `hello_world` | `helloWorld` |
| `Hello World` | `helloWorld` |

### to-underscore

Replaces spaces with underscores.

```yaml
- step: to-underscore
```

| Input | Output |
|-------|--------|
| `hello world` | `hello_world` |
| `hello  world` | `hello__world` |

### collapse

Collapses multiple consecutive characters into one.

```yaml
- step: collapse
  params:
    char: "_"
```

| Params | Input | Output |
|--------|-------|--------|
| `char: "_"` | `hello___world` | `hello_world` |
| `char: " "` | `hello   world` | `hello world` |

### keep

Keeps only specified characters.

```yaml
- step: keep
  params:
    chars: "abcdefghijklmnopqrstuvwxyz0123456789_"
```

| Params | Input | Output |
|--------|-------|--------|
| `chars: "a-z0-9"` | `hello-123!` | `hello123` |

### transliterate

Maps characters to replacements.

```yaml
- step: transliterate
  params:
    map:
      "ä": "ae"
      "ö": "oe"
      "ü": "ue"
```

| Params | Input | Output |
|--------|-------|--------|
| `map: {"é": "e"}` | `café` | `cafe` |

## Common Pipelines

### URL-safe slug

```yaml
slug:
  steps:
    - step: lower
    - step: trim
    - step: replace
      params:
        pattern: " "
        with: "_"
    - step: keep
      params:
        chars: "abcdefghijklmnopqrstuvwxyz0123456789_"
```

### Truncated identifier

```yaml
short-id:
  steps:
    - step: lower
    - step: to-snake-case
    - step: truncate
      params:
        maxLen: 30
```

## Custom Transforms

Create custom transforms in JavaScript:

```javascript
// my-transforms/reverse/index.js
module.exports = {
  name: 'reverse',
  factory: (params) => (value) => {
    return value.split('').reverse().join('');
  }
};
```

Load with CLI:

```bash
opentp validate --external-transforms ./my-transforms
```

Or in config:

```yaml
# opentp.yaml
spec:
  external:
    transforms: ./my-transforms
```
