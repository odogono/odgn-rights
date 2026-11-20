# The Go Postgres adapter only reads, in its own module, bound to TypeScript by shared cases

Go services need to check the Rights that a TypeScript application saves through `PostgresAdapter`. ADR 0001 left adapters out of the first Go release, so a Go service would otherwise read the eight tables itself and depend on a layout the library can change. We add a Go Postgres adapter, `odgn.net/rights/postgres`, that reads the role registry, its Revision and subjects, and nothing else: saving, migrating and the other databases stay with TypeScript until a Go service needs them.

- **Its own module** under `go/postgres`, so the core keeps no dependencies outside the standard library. It uses `database/sql`, so callers bring any driver; only its tests need one (pgx).
- **Shared cases** in `conformance/postgres`: each lists table rows and what the registry and subjects load as. Both adapters run them against a real Postgres in CI. The Go tests create their tables from `conformance/postgres/schema.sql`, and a TypeScript test checks that file against the adapter's own schema, so the two can't drift apart.
- **A consistent snapshot without the lock.** `LoadRegistrySnapshot` reads the Revision and the roles in one read-only repeatable-read transaction. The TypeScript adapter takes a shared lock on the revision row instead; both pair the roles with the Revision they were read at, and the snapshot never waits on a registry change still in progress.
- **Differences from TypeScript.** An inheritance cycle saved in the tables is an error in Go (`ErrInheritanceCycle`), as in the core port. A table prefix must be a plain identifier, because it becomes part of SQL.

## Consequences

- A change to how rows load (columns, order, mask or tag handling) lands with new cases in `conformance/postgres` and fails CI in whichever adapter was not updated.
- The adapter is tagged `go/postgres/vX.Y.Z`. While both modules are unreleased it uses the core through a `replace` directive, which consumers ignore, so its first release must follow a core release.
