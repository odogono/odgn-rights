# ODGN Rights

TypeScript library for expressing and evaluating hierarchical rights with simple glob patterns.

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

## Rule Priority

By default, rules are matched by **specificity** — the most specific matching rule wins. However, you can override this with explicit **priority** values.

### How Priority Works

1. **Higher priority wins** regardless of specificity
2. **Equal priorities** fall back to specificity comparison
3. **Default priority is 0** when not specified
4. **Negative priorities** can deprioritize rules below the default

```ts
const rights = new Rights();

// Specific path, default priority (0)
rights.add(
  new Right('/posts/123', {
    allow: [Flags.READ],
    deny: [Flags.WRITE]
  })
);

// Wildcard path, but high priority (100) — this rule wins!
rights.add(
  new Right('/posts/*', {
    allow: [Flags.READ, Flags.WRITE],
    priority: 100
  })
);

rights.write('/posts/123'); // true — high-priority wildcard rule wins
```

### Priority in Serialization

Priority is included in both text and JSON serialization formats.

**Text format** uses `^` after the path:

```ts
const right = new Right('/posts/*', {
  allow: [Flags.WRITE],
  priority: 100
});
right.toString(); // "+w:/posts/*^100"

// With tags and time ranges
// Format: [flags]:[path]^[priority]#[tags]@[validFrom]/[validUntil]
Right.parse('+rw:/admin/*^50#secure');
```

**JSON format** includes an optional `priority` field:

```json
[
  { "path": "/posts/*", "allow": "rw", "priority": 100 },
  { "path": "/posts/123", "allow": "r", "deny": "w" }
]
```

Priority is omitted from serialization when it equals 0 (the default).

### Use Cases

- **Emergency overrides**: Grant temporary high-priority access that bypasses normal rules
- **Default deny rules**: Use negative priority for fallback deny rules
- **Policy layers**: Implement organizational policies at different priority levels

```ts
// Low-priority default: deny all writes
rights.add(
  new Right('/**', {
    deny: [Flags.WRITE],
    priority: -100
  })
);

// Normal priority: department-level permissions
rights.add(
  new Right('/dept/engineering/**', {
    allow: [Flags.READ, Flags.WRITE]
  })
);

// High priority: emergency maintenance access
rights.add(
  new Right('/system/**', {
    allow: [Flags.ALL],
    priority: 1000,
    tags: ['emergency']
  })
);
```

## JSON Round‑Trip

```ts
const json = rights.toJSON();
// [ { path: '/', allow: 'r' }, { path: '/*/device/**', allow: 'c' }, ... ]
const loaded = Rights.fromJSON(json);
```

## Batch Permission Checks

Efficiently check multiple permissions at once with `checkMany()`.

### Basic Usage

```ts
const rights = new Rights();
rights.allow('/users/*', Flags.READ);
rights.allow('/posts/*', Flags.WRITE);
rights.deny('/admin', Flags.ALL);

const results = rights.checkMany([
  { path: '/users/1', flags: Flags.READ },
  { path: '/posts/1', flags: Flags.WRITE },
  { path: '/admin', flags: Flags.ALL }
]);
// Returns: [true, true, false]
```

### With Context

The same context is shared across all checks:

```ts
rights.add(
  new Right('/posts/*', {
    allow: [Flags.WRITE],
    condition: ctx => ctx.userId === ctx.ownerId
  })
);

const results = rights.checkMany(
  [
    { path: '/posts/1', flags: Flags.WRITE },
    { path: '/posts/2', flags: Flags.WRITE },
    { path: '/posts/3', flags: Flags.WRITE }
  ],
  { userId: 'user1', ownerId: 'user1' }
);
// Returns: [true, true, true]
```

### With Subjects

Works with subjects that have multiple roles:

```ts
const viewer = new Role('viewer', new Rights().allow('/docs', Flags.READ));
const writer = new Role('writer', new Rights().allow('/docs', Flags.WRITE));

const subject = new Subject().memberOf(viewer).memberOf(writer);

const results = subject.checkMany([
  { path: '/docs', flags: Flags.READ },
  { path: '/docs', flags: Flags.WRITE },
  { path: '/docs', flags: Flags.DELETE }
]);
// Returns: [true, true, false]
```

### Use Cases

- **Bulk authorization**: Check multiple resource permissions in a single call
- **Feature flags**: Enable/disable multiple features based on permissions
- **API responses**: Include permission information for multiple resources
- **UI rendering**: Determine visibility of multiple UI elements efficiently

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

## Database Adapters

Database adapters enable persistent storage of rights configurations in SQLite or PostgreSQL databases. This is useful for applications that need to load permissions from a database, share configurations across services, or audit permission changes.

### Installation

The adapters use Bun's built-in database drivers (`bun:sqlite` and `bun` SQL), so no additional dependencies are required.

```ts
import { PostgresAdapter, SQLiteAdapter } from 'odgn-rights/adapters';
```

### Table Prefix

All adapters support a configurable table prefix. The default prefix is `tbl_`.

```ts
// Default prefix creates tables: tbl_rights, tbl_roles, etc.
const adapter = new SQLiteAdapter({ filename: './permissions.db' });

// Custom prefix creates tables: auth_rights, auth_roles, etc.
const adapter = new SQLiteAdapter({
  filename: './permissions.db',
  tablePrefix: 'auth_'
});

// No prefix creates tables: rights, roles, etc.
const adapter = new SQLiteAdapter({
  filename: './permissions.db',
  tablePrefix: ''
});
```

### SQLite Adapter

SQLite is ideal for single-process applications, embedded systems, or local development.

```ts
import { Flags, Right, Rights } from 'odgn-rights';
import { SQLiteAdapter } from 'odgn-rights/adapters';

// Create adapter and connect
const adapter = new SQLiteAdapter({
  filename: './permissions.db', // Use ':memory:' for in-memory
  enableWAL: true // Enable WAL mode for better concurrency
});

await adapter.connect();
await adapter.migrate();

// Save rights
const rights = new Rights();
rights.allow('/users/*', Flags.READ);
rights.allow('/admin/**', Flags.ALL);
await adapter.saveRights(rights);

// Load rights
const loaded = await adapter.loadRights();
loaded.has('/users/123', Flags.READ); // true

// Save and load roles
const { Role, RoleRegistry } = await import('odgn-rights');
const registry = new RoleRegistry();
const admin = registry.define('admin');
admin.rights.allow('/**', Flags.ALL);
await registry.saveTo(adapter);

// Load registry from database
const loadedRegistry = await RoleRegistry.loadFrom(adapter);

await adapter.disconnect();
```

### PostgreSQL Adapter

PostgreSQL is ideal for multi-process applications, microservices, or when you need shared access to permissions.

```ts
import { Flags, RoleRegistry, Subject } from 'odgn-rights';
import { PostgresAdapter } from 'odgn-rights/adapters';

const adapter = new PostgresAdapter({
  url: 'postgres://user:pass@localhost:5432/mydb',
  // Or use individual options:
  // hostname: 'localhost',
  // port: 5432,
  // database: 'mydb',
  // username: 'user',
  // password: 'pass',
  tablePrefix: 'perms_' // Optional custom prefix
});

await adapter.connect();
await adapter.migrate();

// Load registry and make changes
const registry = await adapter.loadRegistry();
const editor = registry.define('editor');
editor.rights.allow('/content/**', Flags.READ, Flags.WRITE);

// Save back
await adapter.saveRegistry(registry);

// Save subjects with roles
const user = new Subject();
user.memberOf(editor);
await adapter.saveSubject('user-123', user);

await adapter.disconnect();
```

### Factory Functions

Convenience functions for common patterns:

```ts
import {
  createPostgresRegistry,
  createPostgresRights,
  createSQLiteRegistry,
  createSQLiteRights
} from 'odgn-rights/adapters';

// Create SQLite adapter with rights
const { adapter, rights } = await createSQLiteRights({
  filename: './permissions.db'
});
rights.allow('/public/**', Flags.READ);
await adapter.saveRights(rights);
await adapter.disconnect();

// Create SQLite adapter with registry
const { adapter: regAdapter, registry } = await createSQLiteRegistry({
  filename: ':memory:'
});
const viewer = registry.define('viewer');
viewer.rights.allow('/read/*', Flags.READ);
await registry.saveTo(regAdapter);
await regAdapter.disconnect();
```

### Transactions

Both adapters support transactions for atomic operations:

```ts
await adapter.transaction(async () => {
  await adapter.saveRight(new Right('/a', { allow: [Flags.READ] }));
  await adapter.saveRight(new Right('/b', { allow: [Flags.WRITE] }));
  // If an error is thrown, all changes are rolled back
});
```

### Adapter Interface

All adapters implement the `DatabaseAdapter` interface:

| Method                             | Description                       |
| ---------------------------------- | --------------------------------- |
| `connect()`                        | Connect to the database           |
| `disconnect()`                     | Disconnect from the database      |
| `migrate()`                        | Create or update schema           |
| `saveRight(right)`                 | Save a single right               |
| `saveRights(rights)`               | Save multiple rights              |
| `loadRight(id)`                    | Load a right by ID                |
| `loadRights()`                     | Load all rights                   |
| `loadRightsByPath(pattern)`        | Load rights matching a pattern    |
| `deleteRight(id)`                  | Delete a right                    |
| `saveRole(role)`                   | Save a role with its rights       |
| `loadRole(name)`                   | Load a role by name               |
| `loadRoles()`                      | Load all roles                    |
| `deleteRole(name)`                 | Delete a role                     |
| `saveRegistry(registry)`           | Save entire RoleRegistry          |
| `loadRegistry()`                   | Load RoleRegistry with all roles  |
| `saveSubject(identifier, subject)` | Save a subject                    |
| `loadSubject(identifier)`          | Load a subject                    |
| `deleteSubject(identifier)`        | Delete a subject                  |
| `clear()`                          | Clear all data (for testing)      |
| `transaction(fn)`                  | Execute operations in transaction |

### Database Schema

The adapters create the following tables (with the configured prefix):

| Table                      | Purpose                              |
| -------------------------- | ------------------------------------ |
| `{prefix}rights`           | Individual rights with paths & flags |
| `{prefix}roles`            | Role definitions                     |
| `{prefix}role_rights`      | Role-to-rights mapping               |
| `{prefix}role_inheritance` | Role inheritance relationships       |
| `{prefix}subjects`         | Subject records                      |
| `{prefix}subject_roles`    | Subject-to-roles mapping             |
| `{prefix}subject_rights`   | Direct subject rights                |

### Persistence Metadata

Rights saved to the database receive a `dbId` property:

```ts
const right = new Right('/test', { allow: [Flags.READ] });
console.log(right.dbId); // undefined

await adapter.saveRight(right);
console.log(right.dbId); // 1 (database ID)
```
