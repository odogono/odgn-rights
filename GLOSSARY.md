# ODGN Rights

Hierarchical access rules over slash-separated paths, decided the same way by every implementation of the library (TypeScript and Go).

## Rules

**Right**:
One rule: a path pattern with the flags it allows and the flags it denies, plus optional priority, tags, validity window and condition.
_Avoid_: Rule, permission, grant, ACE

**Rights**:
An ordered collection of Rights that answers checks as one unit.
_Avoid_: Ruleset, policy, ACL

**Flag**:
One kind of access: read, write, create, delete or execute. A check may ask for several flags at once and passes only if every one is allowed.
_Avoid_: Permission, action, verb

**Path pattern**:
The slash-separated path a Right applies to, which may use `*` (within one segment), `**` (across segments) and `?` (one character). A pattern with no wildcards also covers everything beneath it.
_Avoid_: Resource, route, glob

**Negated path**:
A path pattern written with a leading `!`, which swaps the Right's allowed and denied flags; a second `!` cancels the first.
_Avoid_: Exclusion path

**Specificity**:
How narrowly a path pattern targets paths, ranked by its count of wildcard-free segments, then their total length.

**Priority**:
An explicit rank on a Right that outweighs specificity; higher wins, and the default is zero.

**Validity window**:
The optional time span, from a start and/or until an end, outside of which a Right is ignored.
_Avoid_: Schedule, expiry

**Condition**:
A predicate over the check's context; a Right whose condition fails is ignored for that check. Conditions are code, so they never appear in the text or JSON forms.
_Avoid_: Policy, rule

**Context**:
The attributes supplied with a check, such as the caller's id, that conditions read.

**Tag**:
A label on a Right used to find or group Rights; tags never affect a decision.

## Decisions

**Check**:
A question of the form "may these flags be used on this path, at this time, with this context?", answered yes or no.
_Avoid_: Query, authorization, evaluation

**Deciding Right**:
For one flag, the first Right in decision order that is valid, whose condition holds and that mentions the flag; its deny or allow is the answer. With no deciding Right, the flag is denied.

**Decision order**:
Matching Rights ranked by priority, then specificity, then the order they were added.

**Explanation**:
A check's answer broken down per flag, naming the deciding Right for each.

## Roles and subjects

**Role**:
A named Rights that subjects can belong to and other roles can inherit from.
_Avoid_: Group, profile

**Inheritance**:
A role taking on every Right of the roles it inherits from, after its own.

**Role registry**:
The set of all roles known to an application, looked up by name.

**Subject**:
Whoever a check is made for: the Rights of its roles followed by its direct rights.
_Avoid_: User, principal, actor

**Direct right**:
A Right given to one subject rather than through a role.

**Sealed**:
Of a role registry, role, Rights or Right: no longer changeable, so it can be shared safely.
_Avoid_: Frozen, immutable, locked

**Revision**:
A counter identifying one saved state of a role registry, which advances on every change.

## Implementations

**Conformance case**:
One shared, language-neutral example (Rights, a check and its expected answer, or a text/JSON input and its expected parse) that every implementation must agree on.
_Avoid_: Fixture, golden test
