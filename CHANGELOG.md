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
