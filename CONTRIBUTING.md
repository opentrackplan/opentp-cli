# Contributing to OpenTrackPlan

Thank you for your interest in contributing to OpenTrackPlan! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/opentrackplan/opentp-cli/issues)
2. If not, create a new issue using the bug report template
3. Include:
   - Clear description of the problem
   - Steps to reproduce
   - Expected vs actual behavior
   - Your environment (OS, `opentp --version`, and how you installed it: installer, GitHub Release binary or from source)

### Suggesting Features

1. Check existing [Issues](https://github.com/opentrackplan/opentp-cli/issues) for similar suggestions
2. Create a new issue using the feature request template
3. Describe the use case and expected behavior

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `npm test`
5. Run linter: `npm run lint`
6. Run the type-checks: `npm run typecheck`
7. Commit with a clear message
8. Push and create a Pull Request

## Development Setup

### Prerequisites

- Node.js `^20.19.0 || >=22.12.0` (the `engines` range; CI tests Node 20 and 22). Node 18 is end-of-life and the dev tooling (vite 7 / vitest 4) does not run on it. `engines` describes only this development toolchain: users install the standalone binaries, which do not need Node.js.
- npm

### Getting Started

```bash
# Clone the repository
git clone https://github.com/opentrackplan/opentp-cli.git
cd opentp-cli

# Install dependencies (exactly as locked, like CI)
npm ci

# Run tests
npm test

# Build
npm run build

# Run linter
npm run lint

# Type-check src/ (tsconfig.json) and src/ + *.spec.ts (tsconfig.test.json)
npm run typecheck
```

### Project Structure

```
src/
├── cli.ts              # CLI entry point
├── core/               # Core modules (config, validator, etc.)
├── rules/              # Validation checks (historical folder name)
├── transforms/         # String transformations
├── generators/         # Output generators (JSON, YAML, template)
├── types/              # TypeScript type definitions
└── util/               # Utility functions

dist/                   # Bundled CLI output (esbuild)
docs/                   # CLI documentation (Starlight)
tests/data/             # Integration fixtures for validation tests
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

### Code Style

We use [Biome](https://biomejs.dev/) for linting and formatting:

```bash
# Check for issues
npm run lint

# Auto-fix issues
npm run lint:fix

# Format code
npm run format
```

### Adding New Features

#### Adding a Transform Step

1. Create a new directory: `src/transforms/my-step/`
2. Create `index.ts` with `StepDefinition`
3. Create `transform.spec.ts` with tests
4. Register in `src/transforms/index.ts`

#### Adding a Validation Check

1. Create a new directory: `src/rules/my-check/`
2. Create `index.ts` with `RuleDefinition`
3. Create `rule.spec.ts` with tests
4. Register in `src/rules/index.ts`

#### Adding a Generator

1. Create a new directory: `src/generators/my-generator/`
2. Create `index.ts` with `GeneratorDefinition`
3. Create `generator.spec.ts` with tests
4. Register in `src/generators/index.ts`

### Continuous Integration

`.github/workflows/ci.yml` runs on every push and pull request to `main`, on Node 20 and 22:

1. `npm ci`
2. `npm run lint`
3. `npx tsc --noEmit -p .` and `npx tsc --noEmit -p tsconfig.test.json`
4. `npm test`
5. `npm run build`
6. Smoke tests with the built CLI: `tests/data/coverage-valid` must pass with `count=4`, `tests/data/coverage-invalid` must fail, `opentp mcp` must answer over stdio (`tests/mcp-smoke.mjs`, with plugins that print to stdout), and the `simple` and `full` examples of [opentp-spec](https://github.com/opentrackplan/opentp-spec), checked out at the tag that equals `specVersion` in `package.json`, must pass.
7. Node 22 job only: a linux-x64 binary compiled with Bun (the version pinned in `release.yml` and in the `bun` devDependency) must pass `--version`, `coverage-valid` and the MCP smoke test, and must ignore a `bunfig.toml` and a `.env` in its working directory.

## Releasing (maintainers)

1. Bump the version: `npm version X.Y.Z --no-git-tag-version` (updates `package.json` and `package-lock.json`). While the version is `0.x`, a release with breaking changes bumps the minor version.
2. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and start a new empty `## [Unreleased]` section above it. The release notes start with that section (without it the workflow warns and uses only GitHub's generated notes).
3. Commit, tag `vX.Y.Z` and push the commit and the tag.
4. `.github/workflows/release.yml` then:
   - fails unless the tag equals `v` + the `package.json` version (and `package-lock.json` agrees);
   - runs the full CI workflow as its `verify` job;
   - builds the four binaries (`opentp-linux`, `opentp.exe`, `opentp-mac`, `opentp-mac-intel`, with `--no-compile-autoload-bunfig --no-compile-autoload-dotenv`) and runs each one on its own platform (version, the two fixtures, an unknown command, an external rule, `generate json`, the MCP smoke test, and a check that `bunfig.toml` and `.env` in the working directory are ignored) before uploading it;
   - generates `SHA256SUMS` and publishes a GitHub Release with all five files and the changelog section. A tag with a pre-release suffix (`v1.0.0-rc.1`) becomes a GitHub pre-release, which the installers do not treat as latest.

The installers download the latest GitHub Release by default, so they need no change for a release. Never move or re-push a published tag: if a release is broken, release a new patch version.

### Distribution: binaries only

The CLI is distributed only as the release binaries (GitHub Releases and the install scripts). It is not published to npm, now or later: `package.json` is `"private": true`, and the old npm package `opentp` (0.5.0) is obsolete. Do not add an npm publish step, `npm install -g` / `npx` instructions or npm badges. npm remains a development tool only (`npm ci`, `npm test`, `npm run build`, `package-lock.json`). Moving the whole toolchain (tests, build, compile) to Bun is a possible future direction, not a decision.

## Commit Messages

Use clear, descriptive commit messages:

- `feat: add new transform step`
- `fix: resolve validation error for empty fields`
- `docs: update README with examples`
- `test: add tests for webhook rule`
- `refactor: simplify pattern matching logic`

## Questions?

Feel free to open an issue for any questions about contributing.

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
