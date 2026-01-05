/**
 * Integration tests for database adapters.
 *
 * Tests full workflows with realistic scenarios:
 * - Loading complete RBAC configurations
 * - Saving and restoring subject permissions
 * - Migration and data persistence
 * - Cross-adapter compatibility patterns
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  SQLiteAdapter,
  createSQLiteRegistry,
  createSQLiteRights
} from '@/adapters';
import { Flags, Right, Rights, Role, RoleRegistry, Subject } from '@/index';

describe('Integration: Complete RBAC Configuration Workflow', () => {
  let adapter: SQLiteAdapter;

  beforeEach(async () => {
    adapter = new SQLiteAdapter({ filename: ':memory:' });
    await adapter.connect();
    await adapter.migrate();
    adapter.prepareStatementsAfterMigration();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  test('full RBAC setup and permission evaluation', async () => {
    // Create a complete RBAC hierarchy
    const registry = new RoleRegistry();

    // Base role: viewer
    const viewer = registry.define('viewer');
    viewer.rights.allow('/public/**', Flags.READ);
    viewer.rights.allow('/content/*', Flags.READ);

    // Editor inherits from viewer
    const editor = registry.define('editor');
    editor.rights.allow('/content/*', Flags.WRITE);
    editor.rights.allow('/drafts/**', Flags.READ, Flags.WRITE);
    editor.inheritsFrom(viewer);

    // Publisher inherits from editor
    const publisher = registry.define('publisher');
    publisher.rights.allow('/content/*', Flags.DELETE);
    publisher.rights.allow('/published/**', Flags.ALL);
    publisher.inheritsFrom(editor);

    // Admin with full access
    const admin = registry.define('admin');
    admin.rights.allow('/**', Flags.ALL);

    // Save to database
    await registry.saveTo(adapter);

    // Clear in-memory state and reload
    const loadedRegistry = await RoleRegistry.loadFrom(adapter);

    // Verify all roles exist
    expect(loadedRegistry.get('viewer')).not.toBeUndefined();
    expect(loadedRegistry.get('editor')).not.toBeUndefined();
    expect(loadedRegistry.get('publisher')).not.toBeUndefined();
    expect(loadedRegistry.get('admin')).not.toBeUndefined();

    // Verify inheritance is preserved
    const loadedPublisher = loadedRegistry.get('publisher')!;
    expect(loadedPublisher.parents.length).toBe(1);
    expect(loadedPublisher.parents[0]?.name).toBe('editor');

    // Verify permissions work correctly
    const publisherSubject = new Subject();
    publisherSubject.memberOf(loadedPublisher);

    // Publisher should have inherited read access
    expect(publisherSubject.has('/public/page', Flags.READ)).toBe(true);
    // Publisher should have write access
    expect(publisherSubject.has('/content/article', Flags.WRITE)).toBe(true);
    // Publisher should have delete on content
    expect(publisherSubject.has('/content/article', Flags.DELETE)).toBe(true);
    // Publisher should have all on published
    expect(publisherSubject.has('/published/item', Flags.ALL)).toBe(true);
  });

  test('subject with direct rights and roles', async () => {
    // Create role
    const userRole = new Role('user');
    userRole.rights.allow('/profile/*', Flags.READ);

    // Create subject with role and direct rights
    const subject = new Subject();
    subject.memberOf(userRole);
    subject.rights.allow('/profile/me', Flags.WRITE);
    subject.rights.allow('/settings', Flags.READ, Flags.WRITE);

    // Save and reload
    await adapter.saveSubject('user-abc', subject);
    const loaded = await adapter.loadSubject('user-abc');

    expect(loaded).not.toBeNull();
    expect(loaded!.roles.length).toBe(1);
    expect(loaded!.roles[0]?.name).toBe('user');

    // Check direct rights are preserved
    expect(loaded!.rights.has('/profile/me', Flags.WRITE)).toBe(true);
    expect(loaded!.rights.has('/settings', Flags.READ)).toBe(true);
    expect(loaded!.rights.has('/settings', Flags.WRITE)).toBe(true);
  });

  test('time-based rights with database persistence', async () => {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const rights = new Rights();

    // Active right
    rights.add(
      new Right('/active/*', {
        allow: [Flags.READ],
        validFrom: yesterday,
        validUntil: tomorrow
      })
    );

    // Expired right
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    rights.add(
      new Right('/expired/*', {
        allow: [Flags.READ],
        validFrom: twoDaysAgo,
        validUntil: yesterday
      })
    );

    // Future right
    rights.add(
      new Right('/future/*', {
        allow: [Flags.READ],
        validFrom: tomorrow,
        validUntil: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      })
    );

    // Save and reload
    await adapter.saveRights(rights);
    const loaded = await adapter.loadRights();

    expect(loaded.allRights()).toHaveLength(3);

    // Verify time-based access works
    expect(loaded.has('/active/file', Flags.READ)).toBe(true);
    expect(loaded.has('/expired/file', Flags.READ)).toBe(false);
    expect(loaded.has('/future/file', Flags.READ)).toBe(false);
  });

  test('multiple subjects with shared roles', async () => {
    // Create shared role
    const memberRole = new Role('member');
    memberRole.rights.allow('/member/**', Flags.READ);

    // Create multiple subjects
    const alice = new Subject();
    alice.memberOf(memberRole);
    alice.rights.allow('/alice-private/*', Flags.ALL);

    const bob = new Subject();
    bob.memberOf(memberRole);
    bob.rights.allow('/bob-private/*', Flags.ALL);

    // Save subjects
    await adapter.saveSubject('alice', alice);
    await adapter.saveSubject('bob', bob);

    // Reload and verify
    const loadedAlice = await adapter.loadSubject('alice');
    const loadedBob = await adapter.loadSubject('bob');

    expect(loadedAlice!.roles[0]?.name).toBe('member');
    expect(loadedBob!.roles[0]?.name).toBe('member');

    // Verify shared role gives same permissions
    expect(loadedAlice!.has('/member/resource', Flags.READ)).toBe(true);
    expect(loadedBob!.has('/member/resource', Flags.READ)).toBe(true);

    // Verify private rights are separate
    expect(loadedAlice!.has('/alice-private/file', Flags.ALL)).toBe(true);
    expect(loadedAlice!.has('/bob-private/file', Flags.ALL)).toBe(false);
    expect(loadedBob!.has('/bob-private/file', Flags.ALL)).toBe(true);
    expect(loadedBob!.has('/alice-private/file', Flags.ALL)).toBe(false);
  });
});

describe('Integration: Factory Functions', () => {
  test('createSQLiteRights initializes correctly', async () => {
    const { adapter, rights } = await createSQLiteRights({
      filename: ':memory:'
    });

    expect(adapter).toBeDefined();
    expect(rights).toBeDefined();
    expect(rights.allRights()).toHaveLength(0);

    // Add rights and save
    rights.allow('/test', Flags.READ);
    await adapter.saveRights(rights);

    // Reload and verify
    const loaded = await adapter.loadRights();
    expect(loaded.allRights()).toHaveLength(1);

    await adapter.disconnect();
  });

  test('createSQLiteRegistry with pre-populated data', async () => {
    // First, create and populate a database
    const setup = await createSQLiteRegistry({ filename: ':memory:' });
    const admin = setup.registry.define('admin');
    admin.rights.allow('/**', Flags.ALL);
    await setup.registry.saveTo(setup.adapter);

    // Create a new factory on same (in-memory) adapter won't work
    // but we can test the loaded registry
    const loaded = await setup.adapter.loadRegistry();
    expect(loaded.get('admin')).toBeDefined();

    await setup.adapter.disconnect();
  });

  test('createSQLiteRegistry with custom prefix', async () => {
    const { adapter, registry } = await createSQLiteRegistry({
      filename: ':memory:',
      tablePrefix: 'custom_'
    });

    const role = registry.define('test');
    role.rights.allow('/test', Flags.READ);
    await registry.saveTo(adapter);

    const loaded = await adapter.loadRegistry();
    expect(loaded.get('test')).toBeDefined();

    await adapter.disconnect();
  });
});

describe('Integration: Data Migration and Persistence', () => {
  test('rights with tags persist correctly', async () => {
    const adapter = new SQLiteAdapter({ filename: ':memory:' });
    await adapter.connect();
    await adapter.migrate();
    adapter.prepareStatementsAfterMigration();

    const right = new Right('/tagged/*', {
      allow: [Flags.READ, Flags.WRITE],
      description: 'Tagged resource',
      tags: ['api', 'internal', 'v2']
    });

    await adapter.saveRight(right);
    const loaded = await adapter.loadRight(right.dbId!);

    expect(loaded!.description).toBe('Tagged resource');
    expect(loaded!.tags).toEqual(['api', 'internal', 'v2']);

    await adapter.disconnect();
  });

  test('rights with all flags persist correctly', async () => {
    const adapter = new SQLiteAdapter({ filename: ':memory:' });
    await adapter.connect();
    await adapter.migrate();
    adapter.prepareStatementsAfterMigration();

    const right = new Right('/all-flags/*', {
      allow: [
        Flags.READ,
        Flags.WRITE,
        Flags.CREATE,
        Flags.DELETE,
        Flags.EXECUTE
      ]
    });

    await adapter.saveRight(right);
    const loaded = await adapter.loadRight(right.dbId!);

    expect(loaded!.has(Flags.READ)).toBe(true);
    expect(loaded!.has(Flags.WRITE)).toBe(true);
    expect(loaded!.has(Flags.CREATE)).toBe(true);
    expect(loaded!.has(Flags.DELETE)).toBe(true);
    expect(loaded!.has(Flags.EXECUTE)).toBe(true);

    await adapter.disconnect();
  });

  test('rights with allow and deny masks persist correctly', async () => {
    const adapter = new SQLiteAdapter({ filename: ':memory:' });
    await adapter.connect();
    await adapter.migrate();
    adapter.prepareStatementsAfterMigration();

    const right = new Right('/mixed/*', {
      allow: [Flags.READ, Flags.WRITE],
      deny: [Flags.DELETE]
    });

    await adapter.saveRight(right);
    const loaded = await adapter.loadRight(right.dbId!);

    expect(loaded!.has(Flags.READ)).toBe(true);
    expect(loaded!.has(Flags.WRITE)).toBe(true);
    // Verify deny mask is preserved
    expect(loaded!.denyMaskValue & Flags.DELETE).toBe(Flags.DELETE);

    await adapter.disconnect();
  });
});

describe('Integration: Concurrent Access Patterns', () => {
  test('batch save with transaction', async () => {
    const adapter = new SQLiteAdapter({ filename: ':memory:' });
    await adapter.connect();
    await adapter.migrate();
    adapter.prepareStatementsAfterMigration();

    const rights = new Rights();
    for (let i = 0; i < 100; i++) {
      rights.allow(`/path/${i}`, Flags.READ);
    }

    // Save in transaction
    const ids = await adapter.saveRights(rights);
    expect(ids).toHaveLength(100);

    // Verify all saved
    const loaded = await adapter.loadRights();
    expect(loaded.allRights()).toHaveLength(100);

    await adapter.disconnect();
  });

  test('nested transactions behave correctly', async () => {
    const adapter = new SQLiteAdapter({ filename: ':memory:' });
    await adapter.connect();
    await adapter.migrate();
    adapter.prepareStatementsAfterMigration();

    await adapter.transaction(async () => {
      await adapter.saveRight(new Right('/outer', { allow: [Flags.READ] }));

      await adapter.transaction(async () => {
        await adapter.saveRight(new Right('/inner', { allow: [Flags.WRITE] }));
      });
    });

    const rights = await adapter.loadRights();
    expect(rights.allRights()).toHaveLength(2);

    await adapter.disconnect();
  });

  test('transaction rollback on nested error', async () => {
    const adapter = new SQLiteAdapter({ filename: ':memory:' });
    await adapter.connect();
    await adapter.migrate();
    adapter.prepareStatementsAfterMigration();

    try {
      await adapter.transaction(async () => {
        await adapter.saveRight(new Right('/outer', { allow: [Flags.READ] }));

        // Inner error should rollback everything
        throw new Error('Simulated error');
      });
    } catch {
      // Expected
    }

    const rights = await adapter.loadRights();
    expect(rights.allRights()).toHaveLength(0);

    await adapter.disconnect();
  });
});

describe('Integration: Edge Cases', () => {
  test('empty rights collection persists correctly', async () => {
    const adapter = new SQLiteAdapter({ filename: ':memory:' });
    await adapter.connect();
    await adapter.migrate();
    adapter.prepareStatementsAfterMigration();

    const rights = new Rights();
    const ids = await adapter.saveRights(rights);
    expect(ids).toHaveLength(0);

    const loaded = await adapter.loadRights();
    expect(loaded.allRights()).toHaveLength(0);

    await adapter.disconnect();
  });

  test('role with no rights persists correctly', async () => {
    const adapter = new SQLiteAdapter({ filename: ':memory:' });
    await adapter.connect();
    await adapter.migrate();
    adapter.prepareStatementsAfterMigration();

    const role = new Role('empty');
    await adapter.saveRole(role);

    const loaded = await adapter.loadRole('empty');
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('empty');
    expect(loaded!.rights.allRights()).toHaveLength(0);

    await adapter.disconnect();
  });

  test('subject with no roles or rights persists correctly', async () => {
    const adapter = new SQLiteAdapter({ filename: ':memory:' });
    await adapter.connect();
    await adapter.migrate();
    adapter.prepareStatementsAfterMigration();

    const subject = new Subject();
    await adapter.saveSubject('empty-user', subject);

    const loaded = await adapter.loadSubject('empty-user');
    expect(loaded).not.toBeNull();
    expect(loaded!.roles).toHaveLength(0);
    expect(loaded!.rights.allRights()).toHaveLength(0);

    await adapter.disconnect();
  });

  test('special characters in paths persist correctly', async () => {
    const adapter = new SQLiteAdapter({ filename: ':memory:' });
    await adapter.connect();
    await adapter.migrate();
    adapter.prepareStatementsAfterMigration();

    const paths = [
      '/path/with spaces',
      '/path/with-dashes',
      '/path/with_underscores',
      '/path/with.dots',
      '/path/with:colons',
      '/path/with%percent',
      '/path/**/wildcards/**',
      '/path/?/single/char/?'
    ];

    for (const path of paths) {
      await adapter.saveRight(new Right(path, { allow: [Flags.READ] }));
    }

    const loaded = await adapter.loadRights();
    expect(loaded.allRights()).toHaveLength(paths.length);

    for (const path of paths) {
      const found = loaded.allRights().some(r => r.path === path);
      expect(found).toBe(true);
    }

    await adapter.disconnect();
  });

  test('unicode in descriptions and tags persists correctly', async () => {
    const adapter = new SQLiteAdapter({ filename: ':memory:' });
    await adapter.connect();
    await adapter.migrate();
    adapter.prepareStatementsAfterMigration();

    const right = new Right('/unicode', {
      allow: [Flags.READ],
      description: 'Access pour les utilisateurs',
      tags: ['api', 'internacional']
    });

    await adapter.saveRight(right);
    const loaded = await adapter.loadRight(right.dbId!);

    expect(loaded!.description).toBe('Access pour les utilisateurs');
    expect(loaded!.tags).toContain('internacional');

    await adapter.disconnect();
  });

  test('deep inheritance chain persists and evaluates correctly', async () => {
    const adapter = new SQLiteAdapter({ filename: ':memory:' });
    await adapter.connect();
    await adapter.migrate();
    adapter.prepareStatementsAfterMigration();

    const registry = new RoleRegistry();

    // Create deep inheritance: level1 -> level2 -> level3 -> level4
    const level1 = registry.define('level1');
    level1.rights.allow('/level1/*', Flags.READ);

    const level2 = registry.define('level2');
    level2.rights.allow('/level2/*', Flags.READ);
    level2.inheritsFrom(level1);

    const level3 = registry.define('level3');
    level3.rights.allow('/level3/*', Flags.READ);
    level3.inheritsFrom(level2);

    const level4 = registry.define('level4');
    level4.rights.allow('/level4/*', Flags.READ);
    level4.inheritsFrom(level3);

    await registry.saveTo(adapter);
    const loaded = await RoleRegistry.loadFrom(adapter);

    const level4Role = loaded.get('level4')!;
    const subject = new Subject();
    subject.memberOf(level4Role);

    // Should have access from all inheritance levels
    expect(subject.has('/level1/file', Flags.READ)).toBe(true);
    expect(subject.has('/level2/file', Flags.READ)).toBe(true);
    expect(subject.has('/level3/file', Flags.READ)).toBe(true);
    expect(subject.has('/level4/file', Flags.READ)).toBe(true);

    await adapter.disconnect();
  });
});
