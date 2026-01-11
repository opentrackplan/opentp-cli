---
title: Getting Started
description: Install OpenTrackPlan and create your first tracking plan in minutes.
sidebar:
  order: 2
---

# Getting Started

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

Create a configuration file in your project root:

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

### 2. Create Your First Event

Create the folder structure and your first event file:

```bash
mkdir -p events/auth
```

```yaml
# events/auth/login_click.yaml
opentp: 2025-06

event:
  key: auth::login_click

  taxonomy:
    area: auth
    event: login_click
    action: User clicks the login button

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

Run validation to check your tracking plan:

```bash
opentp validate
```

Expected output:

```
✓ All events are valid count=1
```

## Project Structure

A typical OpenTrackPlan project looks like this:

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

## IDE Support

Add JSON schema references for autocompletion:

```yaml
# yaml-language-server: $schema=https://opentp.dev/schemas/latest/opentp.schema.json
opentp: 2025-06
...
```

Available schemas:

- `https://opentp.dev/schemas/latest/opentp.schema.json` — main config
- `https://opentp.dev/schemas/latest/event.schema.json` — events
- `https://opentp.dev/schemas/latest/dict.schema.json` — dictionaries

## Next Steps

- [CLI Reference](/cli) — learn all available commands
- [Configuration](/schema/opentp-yaml) — detailed configuration options
- [Transforms](/transforms) — string transformation pipelines
- [Rules](/rules) — field validation rules
