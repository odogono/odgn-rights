# odgn.net/rights

Go implementation of odgn-rights: hierarchical access rules over slash-separated paths, with simple glob patterns.

```sh
go get odgn.net/rights
```

Requires Go 1.23 or newer and has no dependencies outside the standard library.

```go
import "odgn.net/rights"

rs := rights.NewRights()
_ = rs.Allow("/", rights.Read)
_ = rs.Add(rights.MustParseRight("-r+c:/*/device/**"))
_ = rs.Add(rights.MustParseRight("+*:/system/user/*"))

rs.Read("/system/user/1")     // true
rs.Write("/system/user/1")    // true
rs.Create("/system/device/a") // true
rs.Read("/system/device/a")   // false: the more specific rule denies it
```

Roles, subjects, conditions and validity windows:

```go
reg, _ := rights.RoleRegistryFromJSON([]rights.RoleJSON{
	{Name: "viewer", Rights: []rights.RightJSON{{Path: "/", Allow: "r"}}},
	{Name: "editor", Rights: []rights.RightJSON{{Path: "/posts", Allow: "w"}}, Inherits: []string{"viewer"}},
})
reg.Seal() // safe to share between goroutines

user := rights.NewSubject().MemberOf(reg.Get("editor"))
user.Write("/posts/1") // true
user.Write("/config")  // false

owner := rights.MustRight("/posts/*", rights.RightOptions{
	Allow:     rights.Write,
	Condition: func(ctx rights.Context) bool { return ctx["userId"] == ctx["ownerId"] },
})
_ = user.Rights().Add(owner)
user.Write("/posts/9", rights.WithContext(rights.Context{"userId": "a", "ownerId": "a"})) // true
user.Read("/posts/9", rights.At(time.Now().Add(24*time.Hour)))                              // check at another time
```

## Same answers as the TypeScript library

Both implementations run the shared cases in [`../conformance`](../conformance), which define the decision order and the text and JSON forms. A change to either belongs in one pull request with new cases. See [`GLOSSARY.md`](../GLOSSARY.md) for the terms and [ADR 0001](../docs/adr/0001-go-port-shares-conformance-cases.md) for why.

Where Go differs from TypeScript:

- Errors are returned instead of thrown: `*SealedError`, `ErrInvalidWindow`, `ErrMissingRole`, `ErrInheritanceCycle`.
- A role cannot inherit from a role that already inherits from it (`ErrInheritanceCycle`). TypeScript accepts the cycle and then overflows its stack on the first check.
- Dates are read only in ISO 8601 form (a date, optionally with a time and offset). TypeScript also accepts the engine's other formats, such as `Jan 1 2025`; Go ignores them, as both ignore unreadable dates.
- A `?` in a path pattern matches one character. In TypeScript it matches one UTF-16 code unit, so there a character outside the Basic Multilingual Plane, such as an emoji, needs `??`.
- Priorities are integers. TypeScript's JSON loader also accepts fractional priorities; Go rejects JSON that has them.
- Checks never see a stale view of a subject's roles; TypeScript caches a subject's rights until `invalidateCache()` is called.
- Explanations, database adapters and the CLI are not ported yet.

## Concurrency

Any number of checks can run at once on any value. Changes need the caller's own locking unless the value is sealed, in which case they return a `*SealedError`.

## Versions

Go releases are tagged `go/vX.Y.Z` and versioned separately from the npm package.
