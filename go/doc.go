// Package rights expresses and checks hierarchical access rules over
// slash-separated paths.
//
// It is the Go implementation of odgn-rights. The TypeScript and Go
// implementations reach the same decision for every check, and read and write
// the same text and JSON forms; the shared conformance cases in the
// repository's conformance/ directory define that behaviour. The README lists
// the known exceptions, such as a TypeScript subject that keeps using a role's
// old rights until its cache is invalidated.
//
// A [Right] allows and denies [Flags] on a path pattern. A [Rights] collection
// answers checks: for each flag asked about, the matching Rights are ranked by
// priority, then specificity, then the order they were added, and the first
// one that is in its validity window, whose condition holds and that mentions
// the flag decides it. A flag nothing decides is denied.
//
//	rs := rights.NewRights()
//	_ = rs.Allow("/", rights.Read)
//	r, _ := rights.ParseRight("-r+c:/*/device/**")
//	_ = rs.Add(r)
//
//	rs.Read("/system/user/1")     // true
//	rs.Read("/system/device/a")   // false
//	rs.Create("/system/device/a") // true
//
// A [Role] is a named Rights that can inherit from other roles, kept in a
// [RoleRegistry]. A [Subject] belongs to roles and may have direct rights of
// its own.
//
// # Concurrency
//
// Any number of checks may run at once on any value. Changes need the
// caller's own locking, unless the value is sealed: sealing a [RoleRegistry],
// [Role], [Rights] or [Right] makes every later change return a
// [*SealedError], so a sealed value can be shared freely.
package rights
