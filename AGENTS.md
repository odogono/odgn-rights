# Repository Guidelines

## Project Structure & Modules

- Source: `src/` (entry: `src/index.ts`)
  - `src/adapters/` - Database adapters (SQLite, Postgres, Redis)
  - `src/cli/` - Command-line interface tool
  - `src/integrations/` - Framework integrations (Elysia)
- Tests: `src/__test__/` and co-located `__test__/` folders within submodules
- Playground: `playground/` - Interactive browser-based testing environment
- Config: `tsconfig.json`, `tsconfig.build.json`
- Package: `package.json` (TypeScript as peer dep), `bun.lock`

## Build, Test, and Development

- Install deps: `bun install`
- Run tests: `bun test src`
- Watch tests: `bun test --watch src`
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
- Location: place tests under `src/__test__/` or co-located `__test__/` folders within submodules (e.g., `src/adapters/__test__/`).
- Names: `feature-or-class.test.ts` (e.g., `rights.test.ts`).
- Coverage: add tests for new behavior, edge-cases, and regressions. Include toString/serialization and path-matching scenarios.
- E2E: Playwright tests for playground in `playwright.config.ts`.
- Run: `bun test src` locally before opening a PR.

## Commit & Pull Requests

- Commits: use Conventional Commits (e.g., `feat:`, `fix:`, `chore:`). Keep changes focused.
- PRs must include:
  - Clear summary and motivation; reference issues if applicable.
  - Tests for new/changed behavior.
  - Notes on API changes and examples in `README.md` when relevant.
- CI expectations: PRs should be green under `bun test src`.

## Security & Configuration

- Runtime: Bun (latest stable). Ensure compatible TypeScript `^5` is installed.
- Avoid introducing Node-only APIs; prefer standard Web/JS APIs supported by Bun.
- Do not commit secrets or tokens. Use environment variables for local experiments.

## Agent-Specific Notes

- Keep edits minimal and surgical; follow existing patterns in source files and tests.
- Add new modules under `src/` and corresponding tests under `src/__test__/` or co-located `__test__/` folders.
- Database adapter tests use testcontainers; ensure Docker is available for running adapter tests.
