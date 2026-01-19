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
   - Your environment (OS, Node.js version)

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
6. Commit with a clear message
7. Push and create a Pull Request

## Development Setup

### Prerequisites

- Node.js >= 18.0.0
- npm

### Getting Started

```bash
# Clone the repository
git clone https://github.com/opentrackplan/opentp-cli.git
cd opentp-cli

# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Run linter
npm run lint
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
