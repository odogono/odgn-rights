/* eslint-disable no-console */
/**
 * Example: SQLite Adapter Usage
 *
 * This example demonstrates how to use SQLite adapter
 * to persist rights, roles, and subjects.
 *
 * Run with: bun run examples/sqlite-adapter.ts
 *
 * Note: When using as a package, replace '../src' imports with 'odgn-rights'
 * and '../src/adapters' with 'odgn-rights/adapters'
 */

import { Flags, Right, Role, RoleRegistry, Subject } from '../src';
import {
  SQLiteAdapter,
  createSQLiteRegistry,
  createSQLiteRights
} from '../src/adapters';

// =============================================================================
// Example 1: Basic Rights Operations
// =============================================================================
const basicUsage = async (): Promise<void> => {
  console.log('--- Basic Rights Operations ---\n');

  const adapter = new SQLiteAdapter({
    filename: ':memory:', // Use in-memory for demo
    tablePrefix: 'tbl_'
  });

  await adapter.connect();
  await adapter.migrate();
  adapter.prepareStatementsAfterMigration();

  // Create and save a single right
  const right = new Right('/users/*', {
    allow: [Flags.READ],
    deny: [Flags.DELETE],
    description: 'User read access',
    tags: ['api', 'user']
  });

  const rightId = await adapter.saveRight(right);
  console.log('Saved right with ID:', rightId);
  console.log('Right dbId property:', right.dbId);

  // Load it back
  const loaded = await adapter.loadRight(rightId);
  console.log('Loaded right:', loaded?.toString());
  console.log('Description:', loaded?.description);
  console.log('Tags:', loaded?.tags);

  await adapter.disconnect();
};

// =============================================================================
// Example 2: Batch Rights with Factory
// =============================================================================
const factoryUsage = async (): Promise<void> => {
  console.log('\n--- Factory Function Usage ---\n');

  const { adapter, rights } = await createSQLiteRights({
    filename: ':memory:',
    tablePrefix: 'auth_'
  });

  // Add multiple rights
  rights.allow('/admin/**', Flags.ALL);
  rights.allow('/public/**', Flags.READ);
  rights.allow('/api/v1/*', Flags.READ, Flags.WRITE);
  rights.add(
    new Right('/premium/**', {
      allow: [Flags.READ],
      validFrom: new Date('2025-01-01'),
      validUntil: new Date('2025-12-31')
    })
  );

  const ids = await adapter.saveRights(rights);
  console.log('Saved', ids.length, 'rights');

  // Reload and verify
  const loaded = await adapter.loadRights();
  console.log('Loaded rights count:', loaded.allRights().length);

  // Test permission checks
  console.log('Has /admin/users READ:', loaded.has('/admin/users', Flags.READ));
  console.log(
    'Has /public/page WRITE:',
    loaded.has('/public/page', Flags.WRITE)
  );

  await adapter.disconnect();
};

// =============================================================================
// Example 3: RBAC with Roles and Inheritance
// =============================================================================
const rbacExample = async (): Promise<void> => {
  console.log('\n--- RBAC with Role Inheritance ---\n');

  const { adapter, registry } = await createSQLiteRegistry({
    filename: ':memory:'
  });

  // Create role hierarchy
  const viewer = registry.define('viewer');
  viewer.rights.allow('/content/**', Flags.READ);
  viewer.rights.allow('/public/**', Flags.READ);

  const editor = registry.define('editor');
  editor.rights.allow('/content/**', Flags.WRITE);
  editor.rights.allow('/drafts/**', Flags.READ, Flags.WRITE);
  editor.inheritsFrom(viewer);

  const admin = registry.define('admin');
  admin.rights.allow('/**', Flags.ALL);

  // Save and reload
  await registry.saveTo(adapter);
  const loadedRegistry = await RoleRegistry.loadFrom(adapter);

  // Verify roles exist
  console.log(
    'Roles in registry:',
    loadedRegistry.toJSON().map((r: { name: string }) => r.name)
  );

  // Create a subject with editor role
  const editorSubject = new Subject();
  const loadedEditor = loadedRegistry.get('editor');
  if (loadedEditor) {
    editorSubject.memberOf(loadedEditor);
  }

  console.log(
    'Editor can read /content/article:',
    editorSubject.has('/content/article', Flags.READ)
  );
  console.log(
    'Editor can write /content/article:',
    editorSubject.has('/content/article', Flags.WRITE)
  );
  console.log(
    'Editor can delete /content/article:',
    editorSubject.has('/content/article', Flags.DELETE)
  );

  await adapter.disconnect();
};

// =============================================================================
// Example 4: Subject Persistence
// =============================================================================
const subjectExample = async (): Promise<void> => {
  console.log('\n--- Subject Persistence ---\n');

  const adapter = new SQLiteAdapter({ filename: ':memory:' });
  await adapter.connect();
  await adapter.migrate();
  adapter.prepareStatementsAfterMigration();

  // Create roles
  const memberRole = new Role('member');
  memberRole.rights.allow('/member/**', Flags.READ);

  const premiumRole = new Role('premium');
  premiumRole.rights.allow('/premium/**', Flags.READ);

  // Create subject with roles and direct rights
  const user = new Subject();
  user.memberOf(memberRole);
  user.memberOf(premiumRole);
  user.rights.allow('/profile/me', Flags.ALL);

  // Save subject
  await adapter.saveSubject('user-alice', user);
  console.log('Saved subject: user-alice');

  // Load it back
  const loaded = await adapter.loadSubject('user-alice');
  console.log(
    'Loaded subject roles:',
    loaded?.roles.map(r => r.name)
  );
  console.log(
    'Has /member/content READ:',
    loaded?.has('/member/content', Flags.READ)
  );
  console.log(
    'Has /premium/content READ:',
    loaded?.has('/premium/content', Flags.READ)
  );
  console.log('Has /profile/me ALL:', loaded?.has('/profile/me', Flags.ALL));

  await adapter.disconnect();
};

// =============================================================================
// Example 5: Transactions
// =============================================================================
const transactionExample = async (): Promise<void> => {
  console.log('\n--- Transaction Support ---\n');

  const adapter = new SQLiteAdapter({ filename: ':memory:' });
  await adapter.connect();
  await adapter.migrate();
  adapter.prepareStatementsAfterMigration();

  // Successful transaction
  await adapter.transaction(async () => {
    await adapter.saveRight(new Right('/tx/a', { allow: [Flags.READ] }));
    await adapter.saveRight(new Right('/tx/b', { allow: [Flags.WRITE] }));
  });
  console.log(
    'After successful transaction:',
    (await adapter.loadRights()).allRights().length,
    'rights'
  );

  // Failed transaction (changes rolled back)
  try {
    await adapter.transaction(async () => {
      await adapter.saveRight(new Right('/tx/c', { allow: [Flags.READ] }));
      throw new Error('Simulated error');
    });
  } catch {
    console.log('Transaction rolled back as expected');
  }
  console.log(
    'After failed transaction:',
    (await adapter.loadRights()).allRights().length,
    'rights (no change)'
  );

  await adapter.disconnect();
};

// =============================================================================
// Example 6: Time-Based Rights
// =============================================================================
const timeBasedExample = async (): Promise<void> => {
  console.log('\n--- Time-Based Rights ---\n');

  const adapter = new SQLiteAdapter({ filename: ':memory:' });
  await adapter.connect();
  await adapter.migrate();
  adapter.prepareStatementsAfterMigration();

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Active right (valid now)
  await adapter.saveRight(
    new Right('/active/*', {
      allow: [Flags.READ],
      validFrom: yesterday,
      validUntil: tomorrow
    })
  );

  // Future right (not yet valid)
  await adapter.saveRight(
    new Right('/future/*', {
      allow: [Flags.READ],
      validFrom: tomorrow,
      validUntil: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    })
  );

  const rights = await adapter.loadRights();
  console.log(
    'Active right valid now:',
    rights.has('/active/test', Flags.READ)
  );
  console.log(
    'Future right valid now:',
    rights.has('/future/test', Flags.READ)
  );

  await adapter.disconnect();
};

// =============================================================================
// Example 7: WAL Mode for Better Concurrency
// =============================================================================
const walModeExample = async (): Promise<void> => {
  console.log('\n--- WAL Mode ---\n');

  const adapter = new SQLiteAdapter({
    enableWAL: true,
    filename: ':memory:'
  });

  await adapter.connect();
  await adapter.migrate();
  adapter.prepareStatementsAfterMigration();

  // Alternatively, enable WAL after connection:
  await adapter.enableWAL();

  console.log('WAL mode enabled for better read/write concurrency');
  console.log('Recommended for multi-threaded applications');

  await adapter.disconnect();
};

// =============================================================================
// Main
// =============================================================================
const main = async (): Promise<void> => {
  try {
    await basicUsage();
    await factoryUsage();
    await rbacExample();
    await subjectExample();
    await transactionExample();
    await timeBasedExample();
    await walModeExample();

    console.log('\n--- All examples completed successfully! ---');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

main();
