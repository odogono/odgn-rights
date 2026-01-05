/* eslint-disable no-console */
/**
 * Example: PostgreSQL Adapter Usage
 *
 * This example demonstrates how to use the PostgreSQL adapter
 * to persist rights, roles, and subjects.
 *
 * Note: You need a running PostgreSQL instance to run this example.
 * Example: docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=test postgres:16
 *
 * Run with: bun run examples/postgres-adapter.ts
 *
 * Note: When using as a package, replace '../src' imports with 'odgn-rights'
 * and '../src/adapters' with 'odgn-rights/adapters'
 */

import { Flags, Right, Role, RoleRegistry, Subject } from '../src';
import {
  PostgresAdapter,
  createPostgresRegistry,
  createPostgresRights
} from '../src/adapters';

// Connection configuration - adjust to your PostgreSQL instance
const PG_URL =
  process.env.DATABASE_URL ||
  'postgres://postgres:test@localhost:5432/postgres';

// =============================================================================
// Example 1: Basic Rights Operations
// =============================================================================
const basicUsage = async (): Promise<void> => {
  console.log('--- Basic Rights Operations ---\n');

  const adapter = new PostgresAdapter({
    tablePrefix: 'demo_',
    url: PG_URL
  });

  await adapter.connect();
  await adapter.migrate();

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

  // Clean up
  await adapter.clear();
  await adapter.disconnect();
};

// =============================================================================
// Example 2: Factory Functions
// =============================================================================
const factoryUsage = async (): Promise<void> => {
  console.log('\n--- Factory Function Usage ---\n');

  // Create adapter with rights collection
  const { adapter: rightsAdapter, rights } = await createPostgresRights({
    tablePrefix: 'rights_',
    url: PG_URL
  });

  rights.allow('/admin/**', Flags.ALL);
  rights.allow('/public/**', Flags.READ);

  const ids = await rightsAdapter.saveRights(rights);
  console.log('Saved', ids.length, 'rights');

  await rightsAdapter.clear();
  await rightsAdapter.disconnect();

  // Create adapter with registry
  const { adapter: registryAdapter, registry } = await createPostgresRegistry({
    tablePrefix: 'reg_',
    url: PG_URL
  });

  const admin = registry.define('admin');
  admin.rights.allow('/**', Flags.ALL);

  await registryAdapter.saveRegistry(registry);
  console.log('Saved registry with admin role');

  await registryAdapter.clear();
  await registryAdapter.disconnect();
};

// =============================================================================
// Example 3: RBAC with Role Inheritance
// =============================================================================
const rbacExample = async (): Promise<void> => {
  console.log('\n--- RBAC with Role Inheritance ---\n');

  const adapter = new PostgresAdapter({
    tablePrefix: 'rbac_',
    url: PG_URL
  });

  await adapter.connect();
  await adapter.migrate();

  // Create role hierarchy
  const registry = new RoleRegistry();

  const viewer = registry.define('viewer');
  viewer.rights.allow('/content/**', Flags.READ);
  viewer.rights.allow('/public/**', Flags.READ);

  const editor = registry.define('editor');
  editor.rights.allow('/content/**', Flags.WRITE);
  editor.rights.allow('/drafts/**', Flags.READ, Flags.WRITE);
  editor.inheritsFrom(viewer);

  const publisher = registry.define('publisher');
  publisher.rights.allow('/content/**', Flags.DELETE);
  publisher.rights.allow('/published/**', Flags.ALL);
  publisher.inheritsFrom(editor);

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

  // Test publisher permissions (should inherit from editor and viewer)
  const publisherSubject = new Subject();
  const loadedPublisher = loadedRegistry.get('publisher');
  if (loadedPublisher) {
    publisherSubject.memberOf(loadedPublisher);
  }

  console.log(
    'Publisher can read /content/article:',
    publisherSubject.has('/content/article', Flags.READ)
  );
  console.log(
    'Publisher can write /content/article:',
    publisherSubject.has('/content/article', Flags.WRITE)
  );
  console.log(
    'Publisher can delete /content/article:',
    publisherSubject.has('/content/article', Flags.DELETE)
  );

  await adapter.clear();
  await adapter.disconnect();
};

// =============================================================================
// Example 4: Subject Persistence
// =============================================================================
const subjectExample = async (): Promise<void> => {
  console.log('\n--- Subject Persistence ---\n');

  const adapter = new PostgresAdapter({
    tablePrefix: 'subj_',
    url: PG_URL
  });

  await adapter.connect();
  await adapter.migrate();

  // Create roles
  const memberRole = new Role('member');
  memberRole.rights.allow('/member/**', Flags.READ);

  const premiumRole = new Role('premium');
  premiumRole.rights.allow('/premium/**', Flags.READ);

  // Create subjects with different configurations
  const alice = new Subject();
  alice.memberOf(memberRole);
  alice.memberOf(premiumRole);
  alice.rights.allow('/alice-private/*', Flags.ALL);

  const bob = new Subject();
  bob.memberOf(memberRole);
  bob.rights.allow('/bob-private/*', Flags.ALL);

  // Save subjects
  await adapter.saveSubject('user-alice', alice);
  await adapter.saveSubject('user-bob', bob);
  console.log('Saved subjects: user-alice, user-bob');

  // Load and verify
  const loadedAlice = await adapter.loadSubject('user-alice');
  const loadedBob = await adapter.loadSubject('user-bob');

  console.log(
    'Alice roles:',
    loadedAlice?.roles.map(r => r.name)
  );
  console.log(
    'Bob roles:',
    loadedBob?.roles.map(r => r.name)
  );

  console.log(
    'Alice has /premium/content READ:',
    loadedAlice?.has('/premium/content', Flags.READ)
  );
  console.log(
    'Bob has /premium/content READ:',
    loadedBob?.has('/premium/content', Flags.READ)
  );

  await adapter.clear();
  await adapter.disconnect();
};

// =============================================================================
// Example 5: Transactions
// =============================================================================
const transactionExample = async (): Promise<void> => {
  console.log('\n--- Transaction Support ---\n');

  const adapter = new PostgresAdapter({
    tablePrefix: 'tx_',
    url: PG_URL
  });

  await adapter.connect();
  await adapter.migrate();

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

  await adapter.clear();
  await adapter.disconnect();
};

// =============================================================================
// Example 6: Connection Pool Settings
// =============================================================================
const connectionPoolExample = async (): Promise<void> => {
  console.log('\n--- Connection Pool Settings ---\n');

  const adapter = new PostgresAdapter({
    // Individual connection options (alternative to url)
    // hostname: 'localhost',
    // port: 5432,
    // database: 'postgres',
    // username: 'postgres',
    // password: 'test',

    // Using URL
    url: PG_URL,

    // Pool settings
    idleTimeout: 30, // Seconds before idle connection is closed
    max: 10, // Maximum connections in pool

    // Optional SSL settings
    // ssl: true,
    // ssl: 'require',
    // ssl: { rejectUnauthorized: false },

    tablePrefix: 'pool_'
  });

  await adapter.connect();
  await adapter.migrate();

  console.log('Connected with connection pool (max: 10, idleTimeout: 30s)');

  // Perform some operations
  await adapter.saveRight(new Right('/pool/test', { allow: [Flags.READ] }));
  const rights = await adapter.loadRights();
  console.log('Rights count:', rights.allRights().length);

  await adapter.clear();
  await adapter.disconnect();
};

// =============================================================================
// Example 7: Time-Based Rights
// =============================================================================
const timeBasedExample = async (): Promise<void> => {
  console.log('\n--- Time-Based Rights ---\n');

  const adapter = new PostgresAdapter({
    tablePrefix: 'time_',
    url: PG_URL
  });

  await adapter.connect();
  await adapter.migrate();

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

  await adapter.clear();
  await adapter.disconnect();
};

// =============================================================================
// Main
// =============================================================================
const main = async (): Promise<void> => {
  console.log('PostgreSQL Adapter Examples');
  console.log('===========================\n');
  console.log(`Using connection: ${PG_URL.replace(/:[^:@]+@/, ':***@')}\n`);

  try {
    await basicUsage();
    await factoryUsage();
    await rbacExample();
    await subjectExample();
    await transactionExample();
    await connectionPoolExample();
    await timeBasedExample();

    console.log('\n--- All examples completed successfully! ---');
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('connection refused')
    ) {
      console.error('\nError: Could not connect to PostgreSQL.');
      console.error('Make sure PostgreSQL is running and accessible at:');
      console.error(`  ${PG_URL.replace(/:[^:@]+@/, ':***@')}`);
      console.error('\nYou can start PostgreSQL with Docker:');
      console.error(
        '  docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=test postgres:16'
      );
    } else {
      console.error('Error:', error);
    }
    process.exit(1);
  }
};

main();
