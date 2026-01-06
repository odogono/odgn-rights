import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { SQLiteAdapter } from '@/adapters/sqlite-adapter';
import { Flags, Right, Rights } from '@/index';

describe('SQLiteAdapter', () => {
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

  describe('Rights operations', () => {
    test('saveRight and loadRight round-trip', async () => {
      const right = new Right('/users/*', {
        allow: [Flags.READ, Flags.WRITE],
        deny: [Flags.DELETE],
        description: 'User access',
        tags: ['user', 'api']
      });

      const id = await adapter.saveRight(right);
      expect(id).toBeGreaterThan(0);

      const loaded = await adapter.loadRight(id);
      expect(loaded).not.toBeNull();
      expect(loaded!.path).toBe('/users/*');
      expect(loaded!.has(Flags.READ)).toBe(true);
      expect(loaded!.has(Flags.WRITE)).toBe(true);
      expect(loaded!.tags).toEqual(['api', 'user']);
    });

    test('saveRights batch operation', async () => {
      const rights = new Rights();
      rights.allow('/a', Flags.READ);
      rights.allow('/b', Flags.WRITE);
      rights.allow('/c', Flags.DELETE);

      const ids = await adapter.saveRights(rights);
      expect(ids).toHaveLength(3);

      const loaded = await adapter.loadRights();
      expect(loaded.allRights()).toHaveLength(3);
    });

    test('time-based rights persistence', async () => {
      const right = new Right('/temp/*', {
        allow: [Flags.READ],
        validFrom: new Date('2025-01-01'),
        validUntil: new Date('2025-12-31')
      });

      const id = await adapter.saveRight(right);
      const loaded = await adapter.loadRight(id);

      expect(loaded!.validFrom?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
      expect(loaded!.validUntil?.toISOString()).toBe(
        '2025-12-31T00:00:00.000Z'
      );
    });

    test('deleteRight removes from database', async () => {
      const right = new Right('/test', { allow: [Flags.READ] });
      const id = await adapter.saveRight(right);

      const deleted = await adapter.deleteRight(id);
      expect(deleted).toBe(true);

      const loaded = await adapter.loadRight(id);
      expect(loaded).toBeNull();
    });

    test('loadRightsByPath finds matching rights', async () => {
      await adapter.saveRight(new Right('/users/123', { allow: [Flags.READ] }));
      await adapter.saveRight(
        new Right('/users/456', { allow: [Flags.WRITE] })
      );
      await adapter.saveRight(new Right('/admin', { allow: [Flags.ALL] }));

      const rights = await adapter.loadRightsByPath('/users/*');
      expect(rights.allRights()).toHaveLength(2);
    });

    test('priority persistence round-trip', async () => {
      const right = new Right('/priority-test', {
        allow: [Flags.READ],
        priority: 100
      });

      const id = await adapter.saveRight(right);
      const loaded = await adapter.loadRight(id);

      expect(loaded).not.toBeNull();
      expect(loaded!.priority).toBe(100);
    });

    test('negative priority persistence', async () => {
      const right = new Right('/negative-priority', {
        allow: [Flags.READ],
        priority: -50
      });

      const id = await adapter.saveRight(right);
      const loaded = await adapter.loadRight(id);

      expect(loaded).not.toBeNull();
      expect(loaded!.priority).toBe(-50);
    });

    test('default priority is 0', async () => {
      const right = new Right('/default-priority', { allow: [Flags.READ] });

      const id = await adapter.saveRight(right);
      const loaded = await adapter.loadRight(id);

      expect(loaded).not.toBeNull();
      expect(loaded!.priority).toBe(0);
    });
  });

  describe('Role operations', () => {
    test('saveRole and loadRole round-trip', async () => {
      const roleRights = new Rights();
      roleRights.allow('/read/*', Flags.READ);

      const { Role } = await import('../../index');
      const role = new Role('viewer', roleRights);

      const id = await adapter.saveRole(role);
      expect(id).toBeGreaterThan(0);

      const loaded = await adapter.loadRole('viewer');
      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe('viewer');
      expect(loaded!.rights.has('/read/*', Flags.READ)).toBe(true);
    });

    test('loadRoles returns all roles', async () => {
      const { Role } = await import('../../index');

      await adapter.saveRole(new Role('viewer', new Rights()));
      await adapter.saveRole(new Role('editor', new Rights()));
      await adapter.saveRole(new Role('admin', new Rights()));

      const roles = await adapter.loadRoles();
      expect(roles).toHaveLength(3);
      const roleNames = roles.map(r => r.name).sort();
      expect(roleNames).toEqual(['admin', 'editor', 'viewer']);
    });

    test('deleteRole removes from database', async () => {
      const { Role } = await import('../../index');
      const role = new Role('temp', new Rights());

      await adapter.saveRole(role);
      const deleted = await adapter.deleteRole('temp');
      expect(deleted).toBe(true);

      const loaded = await adapter.loadRole('temp');
      expect(loaded).toBeNull();
    });
  });

  describe('RoleRegistry operations', () => {
    test('saveRegistry and loadRegistry round-trip', async () => {
      const { RoleRegistry } = await import('../../index');

      const registry = new RoleRegistry();
      const viewer = registry.define('viewer');
      viewer.rights.allow('/read/*', Flags.READ);

      const editor = registry.define('editor');
      editor.rights.allow('/write/*', Flags.WRITE);
      editor.inheritsFrom(viewer);

      await adapter.saveRegistry(registry);

      const loaded = await adapter.loadRegistry();
      expect(loaded.get('viewer')).not.toBeUndefined();
      expect(loaded.get('editor')).not.toBeUndefined();

      const editorRole = loaded.get('editor');
      expect(editorRole).not.toBeUndefined();
      const editorRights = editorRole!.allRights();
      expect(editorRights.length).toBeGreaterThan(0);
    });
  });

  describe('Subject operations', () => {
    test('saveSubject and loadSubject round-trip', async () => {
      const { RoleRegistry, Subject } = await import('../../index');

      const registry = new RoleRegistry();
      const admin = registry.define('admin');
      admin.rights.allow('/admin/**', Flags.ALL);

      const subject = new Subject();
      subject.memberOf(admin);
      subject.rights.allow('/profile', Flags.READ);

      const id = await adapter.saveSubject('user123', subject);
      expect(id).toBeGreaterThan(0);

      const loaded = await adapter.loadSubject('user123');
      expect(loaded).not.toBeNull();
      expect(loaded!.roles.length).toBe(1);
      expect(loaded!.roles[0]?.name).toBe('admin');
      expect(loaded!.rights.has('/profile', Flags.READ)).toBe(true);
    });

    test('deleteSubject removes from database', async () => {
      const { Subject } = await import('../../index');
      const subject = new Subject();

      await adapter.saveSubject('temp-user', subject);
      const deleted = await adapter.deleteSubject('temp-user');
      expect(deleted).toBe(true);

      const loaded = await adapter.loadSubject('temp-user');
      expect(loaded).toBeNull();
    });
  });

  describe('Transaction support', () => {
    test('transaction commits on success', async () => {
      await adapter.transaction(async () => {
        await adapter.saveRight(new Right('/a', { allow: [Flags.READ] }));
        await adapter.saveRight(new Right('/b', { allow: [Flags.READ] }));
      });

      const rights = await adapter.loadRights();
      expect(rights.allRights()).toHaveLength(2);
    });

    test('transaction rolls back on error', async () => {
      try {
        await adapter.transaction(async () => {
          await adapter.saveRight(new Right('/a', { allow: [Flags.READ] }));
          throw new Error('Simulated error');
        });
        // eslint-disable-next-line no-empty
      } catch {}

      const rights = await adapter.loadRights();
      expect(rights.allRights()).toHaveLength(0);
    });
  });

  describe('Utility operations', () => {
    test('clear removes all data', async () => {
      await adapter.saveRight(new Right('/test', { allow: [Flags.READ] }));

      await adapter.clear();

      const rights = await adapter.loadRights();
      expect(rights.allRights()).toHaveLength(0);
    });
  });
});
