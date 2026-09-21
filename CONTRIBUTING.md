# Contributing to OpenClaw Zulip Bridge

Thank you for your interest in contributing! This document provides guidelines for contributing to the OpenClaw Zulip Bridge project.

## Table of Contents

- [Development Setup](#development-setup)
- [How to Contribute](#how-to-contribute)
- [Code Style](#code-style)
- [Testing](#testing)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Release Process](#release-process)

---

## Development Setup

1. **Fork and clone** the repository:

   ```bash
   git clone https://github.com/YOUR_USERNAME/openclaw-zulip-bridge.git
   cd openclaw-zulip-bridge
   ```

2. **Install dependencies** (this also configures the pre-push hook automatically):

   ```bash
   pnpm install
   ```

3. **Run the full check suite** to ensure everything works:

   ```bash
   pnpm run check
   ```

   This runs: bootstrap → typecheck → build → smoke test → unit tests → package check → clawscan → audit

> **Note:** `check:compat` (Tier 1 host compatibility) and `check:tier2` (outbound behaviour tests against a fake Zulip server) are **not** part of `pnpm run check`. Both download a real `openclaw` host (~390 MB) and run as separate CI jobs, gated behind the main job and skipped entirely for documentation-only changes.

> **Note:** A `pre-push` hook is automatically configured on `pnpm install`. It runs the full `pnpm run check` suite before any push, mirroring CI. If you want to bypass it in an emergency, use `git push --no-verify` (not recommended).

### Project Structure

```
src/
├── channel.ts            # Plugin entry point & channel config
├── setup-core.ts         # Interactive setup wizard
├── setup-surface.ts      # Setup wizard UI
├── config-schema.ts      # Configuration validation
├── types.ts              # Type definitions
├── zulip/
│   ├── auth.ts           # Authentication utilities
│   ├── bootstrap.ts      # Monitor initialization
│   ├── client.ts         # Zulip API client
│   ├── dedupe-store.ts   # Deduplication store
│   ├── media-utils.ts    # Media processing
│   ├── monitor-helpers.ts # Logging helpers
│   ├── monitor.ts       # Event polling & queue management
│   ├── policy.ts         # DM/group policy logic
│   ├── polling.ts       # Event polling
│   ├── probe.ts          # Connection probing
│   ├── queue-manager.ts  # Queue persistence
│   ├── reactions.ts      # Reaction handling
│   ├── reply-handler.ts  # Response processing
│   ├── send.ts           # Message sending with security
│   ├── text-utils.ts     # Text processing
│   ├── uploads.ts        # Upload handling
│   └── accounts.ts       # Multi-account config resolution
```

---

## How to Contribute

### Reporting Bugs

Before creating a bug report, please:

1. Check the [existing issues](https://github.com/niyazmft/openclaw-zulip-bridge/issues) to avoid duplicates
2. Check the [Known Issues](README.md#known-issues) section in the README
3. Gather information about your environment (Node.js version, OpenClaw version, OS)

When reporting a bug, please include:

- A clear, descriptive title
- Steps to reproduce the issue
- Expected behavior vs actual behavior
- Your environment details (Node.js version, OpenClaw version, OS)
- Any relevant logs or error messages
- If applicable, a minimal reproduction case

### Suggesting Features

Feature requests are welcome! Please:

1. Check existing issues and discussions first
2. Provide a clear description of the feature and its use case
3. Explain why this feature would be useful to the project

### Pull Requests

1. Fork the repository and create your branch from `main`
2. If you've added code that should be tested, add tests
3. Ensure the test suite passes (`pnpm run check`)
4. Update the README.md if you've changed interfaces or behavior
5. Update CHANGELOG.md with your changes (see [Release Process](#release-process))

---

## Code Style

- **ESM only**: All imports use `.js` extensions (NodeNext resolution)
- **TypeScript**: Source files are `.ts` but compiled to `.js`
- **Lenient config**: `strict: false`, `noImplicitAny: false` — do not add strictness flags without discussion
- **Formatting**: Follow the existing code style in the project

### Key Conventions

- Use `.js` extensions in TypeScript imports (e.g., `import { foo } from './bar.js'`)
- Keep functions focused and modular
- Add comments for complex logic
- Use descriptive variable names

---

## Testing

The project uses Node.js built-in test runner (`--test` flag), not Jest/Vitest.

### Running Tests

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test -- test/policy.test.ts

# Tier 2 behaviour tests (fake Zulip server; downloads a real host)
pnpm run check:tier2
```

### Writing Tests

- Tests live in the `test/` directory
- Use the built-in `node:test` and `node:assert` modules
- Follow the existing test patterns in the project
- **Outbound behaviour tests live in `test/tier2/`** and are excluded from `pnpm test` (the glob is `test/*.test.ts`) because they import built `dist/` artifacts and need a real host in `node_modules` — the `check:tier2` runner supplies both

---

## Commit Messages

Use clear, descriptive commit messages. Format:

```
<type>: <short summary>

<body - optional, but recommended for complex changes>
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, no logic change)
- `refactor`: Code refactoring
- `test`: Test changes
- `chore`: Build process, dependencies, etc.

Examples:
- `fix: resolve queue registration race condition`
- `feat: add support for custom reaction emojis`
- `docs: update README with offline installation steps`

---

## Pull Request Process

1. **Branch naming**: Use descriptive branch names like `feature/add-stream-filtering` or `fix/queue-race-condition`
2. **PR title**: Use the commit message format described above
3. **PR description**: Include:
   - What changes were made and why
   - How to test the changes
   - Any breaking changes or migration steps
4. **CI must pass**: All checks (typecheck, build, tests, package check) must pass
5. **Review**: Wait for maintainer review. Address feedback promptly.

---

## Release Process

The project uses calendar versioning (CalVer) in the format `YYYY.M.PATCH`:

- `YYYY`: Full year (e.g., 2026)
- `M`: Month number (e.g., 5 for May)
- `PATCH`: Patch number within that month

When preparing a release:

1. Update version in `package.json`
2. Update version in `openclaw.plugin.json` (must match `package.json`)
3. Update `CHANGELOG.md` with the new version and changes
4. Run `pnpm run check` to validate everything
5. Create a git tag: `git tag v2026.5.2`
6. Push the tag: `git push origin v2026.5.2`

---

## Questions?

If you have questions not covered here, feel free to:

- Open a [discussion](https://github.com/niyazmft/openclaw-zulip-bridge/discussions)
- Contact the maintainer through GitHub

Thank you for contributing! 🎉
