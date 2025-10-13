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
  - String form: `-denies+allows:/path` (e.g., `-c+rw:/system`)
  - `Right.parse(str)` creates a Right from its string form
- `Rights`
  - `add(right)`, `allow(path, ...flags)`, `deny(path, flag)`
  - Checks: `read|write|delete|create|execute|all(path)`
  - Serialization: `format(separator?)`, `toJSON()`, `Rights.parse(str)`, `Rights.fromJSON(json)`

Matching precedence: the most specific matching rule wins; within a rule, a denied flag blocks that flag even if allowed by a less specific rule.

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
