# Repository Guidelines

## Project Structure & Modules

This is a monorepo using Bun workspaces with two packages:

- `packages/odgn-rights/` - Core library (published to npm)
  - `packages/odgn-rights/src/` - Source code (entry: `src/index.ts`)
  - `packages/odgn-rights/src/adapters/` - Database adapters (SQLite, Postgres, Redis)
  - `packages/odgn-rights/src/cli/` - Command-line interface tool
  - `packages/odgn-rights/src/integrations/` - Framework integrations (Elysia)
  - `packages/odgn-rights/src/__test__/` - Tests (and co-located `__test__/` folders)
- `packages/playground/` - Interactive browser-based testing environment (private, not published)
  - `packages/playground/src/` - React application source
  - `packages/playground/e2e/` - Playwright E2E tests
- Root config: `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `playwright.config.ts`
- Root package: `package.json` (workspace config), `bun.lock`

## Build, Test, and Development

- Install deps: `bun install`
- Run tests: `bun test packages/odgn-rights/src`
- Watch tests: `bun test --watch packages/odgn-rights/src`
- Run E2E tests: `bun run test:e2e`
- Ad-hoc script run (TS): `bun path/to/file.ts`
- Build: `bun run build`
- Playground: `bun run playground`

## Linting & Formatting

- Lint: `bun run lint` (ESLint)
- Lint fix: `bun run lint:fix`
- Format: `bun run format` (Prettier)
- Format check: `bun run format:check`

## Coding Style & Naming

- Language: TypeScript (ESM). Prefer named exports over default.
- Indentation: 2 spaces; max line length ~100 chars.
- Types: enable strict, avoid `any`; narrow unions; use `as const` for flags.
- Files: lower-case with dots (e.g., `rights.test.ts`, `index.ts`).
- Public API: keep small, stable; document breaking changes in README.

## Testing Guidelines

- Framework: `bun:test`.
- Location: place tests under `packages/odgn-rights/src/__test__/` or co-located `__test__/` folders within submodules (e.g., `src/adapters/__test__/`).
- Names: `feature-or-class.test.ts` (e.g., `rights.test.ts`).
- Coverage: add tests for new behavior, edge-cases, and regressions. Include toString/serialization and path-matching scenarios.
- E2E: Playwright tests for playground in `packages/playground/e2e/`.
- Run: `bun test packages/odgn-rights/src` locally before opening a PR.

## Commit & Pull Requests

- Commits: use Conventional Commits (e.g., `feat:`, `fix:`, `chore:`). Keep changes focused.
- PRs must include:
  - Clear summary and motivation; reference issues if applicable.
  - Tests for new/changed behavior.
  - Notes on API changes and examples in `README.md` when relevant.
- CI expectations: PRs should be green under `bun test packages/odgn-rights/src`.

## Security & Configuration

- Runtime: Bun (latest stable). Ensure compatible TypeScript `^5` is installed.
- Avoid introducing Node-only APIs; prefer standard Web/JS APIs supported by Bun.
- Do not commit secrets or tokens. Use environment variables for local experiments.

## Agent-Specific Notes

- Keep edits minimal and surgical; follow existing patterns in source files and tests.
- Add new modules under `packages/odgn-rights/src/` and corresponding tests under `packages/odgn-rights/src/__test__/` or co-located `__test__/` folders.
- Database adapter tests use testcontainers; ensure Docker is available for running adapter tests.
