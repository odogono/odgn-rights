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
