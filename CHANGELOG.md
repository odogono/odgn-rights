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
