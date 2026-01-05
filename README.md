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

## CLI Tool

The CLI tool helps test and debug permission configurations from the command line.

### Installation

```bash
# Install globally
npm install -g @odgn/rights

# Or use with npx
npx @odgn/rights --help

# Or run directly with bun
bun run src/cli/index.ts --help
```

### Commands

#### check

Test if a permission is allowed:

```bash
# Basic usage
odgn-rights check -c config.json -p /users/123 -f READ

# With combined flags
odgn-rights check -c config.json -p /users/123 -f RW

# With comma-separated flags
odgn-rights check -c config.json -p /users/123 -f READ,WRITE

# Quiet mode for scripting (outputs 'true' or 'false')
odgn-rights check -c config.json -p /users/123 -f READ --quiet

# With context for conditional rights
odgn-rights check -c config.json -p /posts/1 -f WRITE --context '{"userId":"abc","ownerId":"abc"}'

# Override time for time-based rights
odgn-rights check -c config.json -p /scheduled -f READ --time 2025-06-15T12:00:00Z
```

Exit codes: `0` = allowed, `1` = denied, `2` = error

#### explain

Understand why a permission is allowed or denied:

```bash
# Basic usage
odgn-rights explain -c config.json -p /users/123 -f WRITE

# JSON output
odgn-rights explain -c config.json -p /users/123 -f READ --json
```

The explain command shows:

- Decision breakdown per flag
- Matching rules sorted by specificity
- Suggestions for granting denied permissions

#### validate

Validate a configuration file:

```bash
# Validate JSON config
odgn-rights validate config.json

# Validate string format config
odgn-rights validate config.txt

# Strict mode (warns on broad patterns like /**)
odgn-rights validate --strict config.json

# JSON output
odgn-rights validate --json config.json
```

Exit codes: `0` = valid, `1` = validation errors, `2` = file error

### Configuration Formats

The CLI supports two configuration formats:

**JSON format** (`config.json`):

```json
[
  { "path": "/", "allow": "r" },
  { "path": "/users/*", "allow": "rw" },
  { "path": "/admin/**", "allow": "*", "tags": ["admin"] },
  { "path": "/scheduled", "allow": "r", "validFrom": "2025-01-01T00:00:00Z" }
]
```

**String format** (`config.txt`):

```
# Comments start with #
+r:/
+rw:/users/*
+*:/admin/**
-d+rw:/public
```

### Flag Reference

| Flag    | Letter | Description        |
| ------- | ------ | ------------------ |
| READ    | R      | Read permission    |
| WRITE   | W      | Write permission   |
| CREATE  | C      | Create permission  |
| DELETE  | D      | Delete permission  |
| EXECUTE | X      | Execute permission |
| ALL     | \*     | All permissions    |

Flags can be combined: `RW`, `READ,WRITE`, `RWCDX`
