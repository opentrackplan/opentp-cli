---
title: CLI Reference
description: Complete reference for all OpenTrackPlan CLI commands.
sidebar:
  order: 3
  label: CLI
---

# CLI Reference

The `opentp` command-line interface provides tools for validating, fixing, and exporting your tracking plan.

## Global Options

These options are available for all commands:

| Option | Description |
|--------|-------------|
| `--root <path>` | Project root directory (default: current directory) |
| `--verbose` | Enable verbose output |
| `--help` | Show help |
| `--version` | Show version |

## Commands

| Command | Description |
|---------|-------------|
| [`validate`](/cli/validate) | Validate all events |
| [`fix`](/cli/fix) | Auto-fix `event.key` (requires `spec.events.x-opentp.keygen`) |
| [`generate`](/cli/generate) | Export tracking plan to various formats |

## Quick Examples

```bash
# Validate all events
opentp validate

# Validate with custom root
opentp validate --root ./my-project

# Auto-fix event keys
opentp fix

# Export to JSON
opentp generate json

# Export to YAML
opentp generate yaml

# Show version
opentp --version
```

## Exit Codes

| Code | Description |
|------|-------------|
| `0` | Success |
| `1` | Validation errors found |
| `2` | Configuration error |
