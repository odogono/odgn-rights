# Go port lives in this repo and is bound to TypeScript by shared conformance cases

Go services need to check the same Rights that TypeScript code writes, so the two implementations must reach the same decision for every check. We port the library to Go as a separate Go module under `go/` in this repo, written in ordinary Go style but keeping the glossary's names, and make language-neutral conformance cases (stored as JSON) the contract both `bun test` and `go test` run. The text and JSON forms and the decision order are defined by those cases rather than by either implementation.

## Consequences

- A change to decision rules or the text/JSON forms lands in one PR with new conformance cases, and fails CI in whichever language was not updated.
- The first Go release covers the core only (Right, Rights, Role, Role registry, Subject, sealing, both forms, batch checks, validity windows). Database adapters, the CLI and explanations need their own decision; the Elysia integration, React package and playground are not ported.
- Go release tags carry the subdirectory prefix (`go/vX.Y.Z`).
- The module path is on our own domain, `odgn.net`, rather than the forge's, so the code can change host without breaking imports. Module paths are permanent once published.
