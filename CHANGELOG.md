# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## 0.7.0 - 2026-08-12

### Added

- Database adapters now expose stable role summaries, batch role hydration,
  revisioned registry snapshots, and compare-and-swap registry commits across
  PostgreSQL, SQLite, and Redis.
- `RoleRegistry.delete()` removes a role together with inheritance edges that
  reference it.

### Changed

- Whole-registry saves now advance a persisted registry revision, while
  conditional commits replace deleted roles atomically and report stale
  revisions explicitly.
- PostgreSQL registry summaries, snapshots, and saves coordinate through the
  revision row, and Redis registry operations use a distributed lock,
  preventing readers from pairing role data with the wrong revision.

### Deprecated

- `DatabaseAdapter.saveRole()`, `deleteRole()`, and `saveRegistry()` are
  revision-blind and invisible to conditional commits. Route production role
  writes through `loadRegistrySnapshot()` + `saveRegistryIfRevision()`.

### Notes for adapter implementers

- `DatabaseAdapter` gains four required methods — `loadRoleSummaries()`,
  `loadRolesByName()`, `loadRegistrySnapshot()`, and
  `saveRegistryIfRevision()`. Adapters extending `BaseAdapter` inherit
  `loadRolesByName()`; the other three must be implemented. External
  implementations of the bare interface are a breaking change.

## 0.6.4 - 2026-08-01

### Fixed

- PostgreSQL role registries now load roles with mapped rights and inheritance
  in two batched queries instead of issuing queries per role and right.
- PostgreSQL subjects now batch role-name and direct-right hydration while
  continuing to support optional preloaded registries.

## odgn-rights-react 0.1.1 - 2026-06-25

### Fixed

- React permission queries now use compact, order-sensitive cache-key
  fingerprints while preserving normalized server-backed permission check
  requests and prefix invalidation behavior.

## 0.6.3 - 2026-06-08

### Fixed

- Database adapters now hydrate inherited role rights when loading roles,
  subjects, subject lists, paginated subjects, and subject access queries.
  This preserves persisted subject access for roles that inherit permissions
  from parent roles across SQLite, PostgreSQL, and Redis adapters.

## 0.6.2 - 2026-01-21

### Fixed

- postgres adapter not forming sql properly

## 0.6.1 - 2026-01-21

### Added

- **Batch Subject Loading**: New optimized methods for loading multiple subjects without N+1 query problems.
  - `loadSubjects()`: Load all subjects with their roles and rights using batch JOINs (4 queries total).
  - `loadSubjectsPaginated(options)`: Load subjects with pagination using batch JOINs (5 queries total).
  - New types: `PaginationOptions`, `PaginatedResult<T>`, `SubjectWithIdentifier`.
  - Implemented in all adapters: `PostgresAdapter`, `SQLiteAdapter`, `RedisAdapter`.
  - Reduces query count from O(N) to O(1) for listing subjects, fixing timeout issues with large datasets.

## 0.6.0 - 2026-01-08

### Changed

- **Monorepo Restructure**: Converted to Bun workspaces monorepo to separate the core library from the playground.
  - `packages/odgn-rights/` - Core library (published to npm)
  - `packages/playground/` - Interactive browser-based testing environment (private, not published)
- **Reduced Dependencies**: Removed `react`, `react-dom`, and `jotai` from the core package dependencies. These are now only installed when developing the playground locally. Users installing `odgn-rights` from npm no longer get unnecessary React dependencies.

## 0.5.1 - 2026-01-08

### Fixed

- **Registry Loading**: Fixed role inheritance not being properly restored when loading a `RoleRegistry` from database adapters. The registered role instance is now correctly used when rebuilding parent-child relationships.

### Added

- `Rights.remove(right)`: Method to remove a specific right from a collection.
- `Role.clearParents()`: Method to clear all parent role relationships, useful when rebuilding inheritance hierarchies.

## 0.5.0 - 2026-01-07

### Added

- **Elysia Integration**: New middleware for ElysiaJS web framework authorization.
  - `elysiaRights()`: Main plugin with Subject/SubjectRegistry support.
  - `elysiaRightsStandalone()`: Simplified plugin using a `Rights` instance directly.
  - `createRightsGuard()`: Guard configuration for selective route protection via `.guard()`.
  - `createRightsMacro()`: Macro for declarative per-route authorization.
  - Automatic HTTP method to permission flag mapping (GET→READ, POST→CREATE, etc.).
  - ABAC support via `getContext` option for attribute-based checks.
  - New export: `./integrations/elysia`.

- **Subject Registry**: New `SubjectRegistry` class for managing and querying named subjects.
  - `register(id, subject)`: Register subjects with unique identifiers.
  - `findSubjectsWithAccess(path, flags, context?)`: Reverse-query to find all subjects with access to a resource.
  - Full database adapter support with optimized batch queries (SQLite, PostgreSQL, Redis).

- **Negation Patterns**: Paths prefixed with `!` swap allow/deny semantics for easy exclusion rules.
  - `Right.parse('+r:!/api/internal/**')` creates a deny rule for READ.
  - `Rights.exclude(path, ...flags)` helper method for common exclusion patterns.
  - Double negation supported (`!!` cancels out).

- **Batch Checking**: Check multiple permissions in a single call.
  - `Rights.checkMany(requests, context?)`: Returns array of booleans for each request.
  - `Subject.checkMany(requests, context?)`: Same API on Subject instances.
  - Useful for bulk authorization, feature flags, and UI rendering.

- **Explicit Rule Priority**: Rules can now have a `priority` value that overrides specificity-based resolution.
  - Higher priority wins regardless of path specificity.
  - Equal priorities fall back to specificity comparison.
  - Negative priorities can deprioritize rules below the default (0).
  - Text serialization format: `+rw:/path^100` (priority after path, using `^`).
  - JSON serialization: optional `priority` field (omitted when 0).
  - Full support in all database adapters (SQLite, PostgreSQL, Redis).
  - CLI `explain` command now displays priority alongside specificity.

### Changed

- Elysia added as optional peer dependency (`^1.0.0`).
- Updated `ioredis` dependency from `^5.6.1` to `^5.9.0`.

## 0.4.0 - 2026-01-06

### Added

- **Redis Adapter**: New persistence adapter for storing rights, roles, and subjects in Redis/Valkey.
  - `RedisAdapter`: Full-featured adapter using `ioredis` with support for both host/port and URL-based connections.
  - Factory functions (`createRedisRights`, `createRedisRegistry`) for quick setup.
  - Configurable key prefix (default: `tbl_`) to avoid key conflicts.
  - Transaction support via Redis MULTI/EXEC (note: no true rollback).
  - Full entity support: `Right`, `Rights`, `Role`, `RoleRegistry`, and `Subject`.
  - Path pattern queries via `loadRightsByPath()`.
- **New Export**: `./adapters/redis` subpath export for the Redis adapter.

### Changed

- Updated Postgres test container image from `postgres:16-alpine` to `postgres:17-alpine`.

## 0.3.0 - 2026-01-05

### Added

- **Database Adapters**: New persistence layer for storing rights, roles, and subjects in relational databases.
  - `SQLiteAdapter`: Full-featured adapter for SQLite/Bun SQLite with synchronous operations.
  - `PostgresAdapter`: Adapter for PostgreSQL using the `postgres` package.
  - `BaseAdapter`: Abstract base class for implementing custom adapters.
  - `DatabaseAdapter` interface defining the contract for all adapters.
- **Schema Management**: Automatic table creation and migrations via `migrate()` method.
- **Transaction Support**: ACID-compliant transactions via `transaction()` method for atomic operations.
- **Factory Functions**: Convenience functions (`createSQLiteRights`, `createSQLiteRegistry`, `createPostgresRights`, `createPostgresRegistry`) for quick setup.
- **Configurable Table Prefix**: All table names can be prefixed (default: `tbl_`) to avoid conflicts.
- **Full Entity Support**: Save and load `Right`, `Rights`, `Role`, `RoleRegistry`, and `Subject` instances.
- **Path Pattern Queries**: Load rights by path pattern with `loadRightsByPath()`.

## 0.2.0 - 2026-01-05

### Added

- **CLI Tool**: New command-line interface for testing and debugging permission configurations.
  - `check`: Test permission checks against a configuration file with support for context and time overrides.
  - `explain`: Get detailed breakdowns of why permissions are allowed or denied, including rule matching and suggestions.
  - `validate`: Validate configuration files (JSON or text format) with optional strict mode for detecting broad patterns.
- **Binary Executables**: Available as `odgn-rights` or `rights` after installation.
- **Scripting Support**: `--quiet` mode for `check` and `--json` output for `explain` and `validate` commands.

## 0.1.0 - 2025-12-22

### Added

- **RBAC Support**: New `Role`, `Subject`, and `RoleRegistry` classes for hierarchical permission management.
- **ABAC / Contextual Rights**: Support for `condition` predicates in `Right` definitions to evaluate permissions based on runtime context.
- **Audit & Explanation API**: `explain()` method on `Rights` and `Subject` to provide detailed reasons for permission decisions, including role source tracking.
- **Performance Optimizations**:
  - Regex pre-compilation and specificity memoization.
  - Aggregation and match results caching for `Subject` and `Rights`.

### Changed

- **Serialization Fix**: Unique identifiers for `CREATE` (`c`) and `DELETE` (`d`) flags to prevent data loss during JSON round-trips.
- **Refactoring**: Split monolithic `index.ts` into modular files (`right.ts`, `role.ts`, `subject.ts`, etc.) for better maintainability.

## 0.0.2 - 2025-10-13

### Changed

- More robust path normalization (collapse duplicate slashes, handle trailing slash; use `replaceAll`).
- Safer glob-to-RegExp conversion and escaping.
- Consistent handling of composite flag checks across Right/Rights.
- String formats collapse CREATE and DELETE to `c` in masks.
- Minor API typings and serialization shape made more explicit (stable keys in `toJSON`).
