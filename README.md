# ODGN Rights

Tiny TypeScript library for expressing and evaluating hierarchical rights with simple glob patterns.

## Install & Dev

- Install: `bun install`
- Test: `bun test` (watch: `bun test --watch`)

Use in TS:

```ts
import { Flags, Right, Rights } from 'odgn-rights'; // when packaged

// or locally: import { Rights, Right, Flags } from './src/index.ts';
```

## Quick Start

```ts
const rights = new Rights();
rights.allow('/', Flags.READ);

// Deny read, allow create anywhere matching /*/device/**
rights.add(
  new Right('/*/device/**', { allow: [Flags.CREATE], deny: [Flags.READ] })
);

// Grant everything under /system/user/*
rights.add(new Right('/system/user/*', { allow: [Flags.ALL] }));

rights.read('/system/user/1'); // true
rights.write('/system/user/1'); // true
rights.create('/system/device/a'); // true
rights.read('/system/device/a'); // false (denied by more specific rule)
```

## API Overview

- `Right(path, {allow?, deny?, description?})`
  - Flags: `Flags.READ | WRITE | DELETE | CREATE | EXECUTE | ALL`
  - Methods: `allow(flag)`, `deny(flag)`, `clear()`, `has(mask)`
  - String form: `-denies+allows:/path` (e.g., `-d+rw:/system`)
  - `Right.parse(str)` creates a Right from its string form
- `Rights`
  - `add(right)`, `allow(path, ...flags)`, `deny(path, flag)`
  - Checks: `read|write|delete|create|execute|all(path)`
  - Serialization: `format(separator?)`, `toJSON()`, `Rights.parse(str)`, `Rights.fromJSON(json)`
- `Role(name, rights?)`
  - `inheritsFrom(role)`: Inherit rights from another role.
- `Subject`
  - `memberOf(role)`: Assign a role to the subject.
  - `rights`: Direct `Rights` assigned to the subject.
  - `has(path, flag)`: Evaluates permissions across all roles and direct rights.
- `RoleRegistry`
  - `define(name, rights?)`: Define or update a role.
  - `toJSON() / RoleRegistry.fromJSON(json)`: Serialization with inheritance.

Matching precedence: the most specific matching rule wins; within a rule, a denied flag blocks that flag even if allowed by a less specific rule.

## RBAC Example

```ts
const registry = new RoleRegistry();
const viewer = registry.define('viewer', new Rights().allow('/', Flags.READ));
const editor = registry.define(
  'editor',
  new Rights().allow('/posts', Flags.WRITE)
);
editor.inheritsFrom(viewer);

const user = new Subject().memberOf(editor);
user.read('/posts/1'); // true (inherited from viewer)
user.write('/posts/1'); // true (from editor)
user.write('/config'); // false
```

## Contextual Rights (ABAC)

Rights can include a condition predicate that is evaluated at runtime with a provided context.

```ts
rights.add(
  new Right('/posts/*', {
    allow: [Flags.WRITE],
    condition: ctx => ctx.userId === ctx.ownerId
  })
);

// Provide context to the check
rights.write('/posts/1', { userId: 'abc', ownerId: 'abc' }); // true
rights.write('/posts/1', { userId: 'abc', ownerId: 'xyz' }); // false
```

## Glob Patterns

- `*` matches within a single path segment (`/system/*/id`)
- `**` matches across segments (`/*/device/**`)
- `?` matches a single character (no slash)

## JSON Round‑Trip

```ts
const json = rights.toJSON();
// [ { path: '/', allow: 'r' }, { path: '/*/device/**', allow: 'c' }, ... ]
const loaded = Rights.fromJSON(json);
```
