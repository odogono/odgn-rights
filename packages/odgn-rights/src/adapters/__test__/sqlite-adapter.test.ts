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

    test('queries stable role summaries and hydrates an ordered batch', async () => {
      const { RoleRegistry } = await import('../../index');
      const registry = new RoleRegistry();
      registry.define('Zulu');
      registry.define('alpha');
      registry.define('Alpine');
      await adapter.saveRegistry(registry);

      const page = await adapter.loadRoleSummaries({ name: 'al' });
      expect(page.revision).toBeGreaterThan(0);
      expect(page.items.map(item => item.name)).toEqual(['alpha', 'Alpine']);
      expect(page.items[0]?.createdAt).toBeString();

      const roles = await adapter.loadRolesByName(
        ['Alpine', 'alpha'],
        page.revision
      );
      expect(roles.map(role => role.name)).toEqual(['Alpine', 'alpha']);
    });

    test('conditionally commits a registry snapshot once', async () => {
      const first = await adapter.loadRegistrySnapshot();
      const second = await adapter.loadRegistrySnapshot();
      first.registry.define('first-writer');
      second.registry.define('stale-writer');

      const committed = await adapter.saveRegistryIfRevision(
        first.registry,
        first.revision
      );
      const stale = await adapter.saveRegistryIfRevision(
        second.registry,
        second.revision
      );

      expect(committed).toEqual({ committed: true, revision: 1 });
      expect(stale).toEqual({ committed: false, revision: 1 });
      expect((await adapter.loadRegistry()).get('first-writer')).toBeDefined();
      expect(
        (await adapter.loadRegistry()).get('stale-writer')
      ).toBeUndefined();
    });

    test('conditionally committing a snapshot removes deleted roles', async () => {
      const { RoleRegistry } = await import('../../index');
      const registry = new RoleRegistry();
      registry.define('keep');
      registry.define('remove');
      await adapter.saveRegistry(registry);

      const snapshot = await adapter.loadRegistrySnapshot();
      expect(snapshot.registry.delete('remove')).toBe(true);
      expect(
        await adapter.saveRegistryIfRevision(
          snapshot.registry,
          snapshot.revision
        )
      ).toEqual({ committed: true, revision: snapshot.revision + 1 });

      expect((await adapter.loadRegistry()).get('keep')).toBeDefined();
      expect((await adapter.loadRegistry()).get('remove')).toBeUndefined();
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

    test('loaded roles and subjects preserve inherited role access', async () => {
      const { RoleRegistry, Subject } = await import('../../index');

      const registry = new RoleRegistry();
      const parent = registry.define('parent');
      parent.rights.allow('/meta', Flags.ALL);

      const middle = registry.define('middle');
      middle.rights.allow('/middle', Flags.READ);
      middle.inheritsFrom(parent);

      const child = registry.define('child');
      child.inheritsFrom(middle);

      await adapter.saveRegistry(registry);

      const loadedChild = await adapter.loadRole('child');
      expect(loadedChild).not.toBeNull();
      expect(loadedChild!.parents.map(role => role.name)).toEqual(['middle']);

      const roleSubject = new Subject().memberOf(loadedChild!);
      expect(roleSubject.read('/meta/prod/controller-defs')).toBe(true);

      const subject = new Subject();
      subject.memberOf(child);
      await adapter.saveSubject('runtime-token', subject);

      const loadedSubject = await adapter.loadSubject('runtime-token');
      expect(loadedSubject).not.toBeNull();
      expect(loadedSubject!.toJSON().roles).toEqual(['child']);
      expect(loadedSubject!.read('/meta/prod/controller-defs')).toBe(true);

      const loadedSubjects = await adapter.loadSubjects();
      expect(
        loadedSubjects
          .find(entry => entry.identifier === 'runtime-token')
          ?.subject.read('/meta/prod/controller-defs')
      ).toBe(true);

      const paginatedSubjects = await adapter.loadSubjectsPaginated({
        page: 1,
        pageSize: 10
      });
      expect(
        paginatedSubjects.items
          .find(entry => entry.identifier === 'runtime-token')
          ?.subject.read('/meta/prod/controller-defs')
      ).toBe(true);

      const matchingSubjects = await adapter.findSubjectsWithAccess(
        '/meta/prod/controller-defs',
        Flags.READ
      );
      expect(matchingSubjects).toContain('runtime-token');
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

    test('findSubjectsWithAccess returns subjects with matching rights', async () => {
      const { Right, RoleRegistry, Subject } = await import('../../index');

      const registry = new RoleRegistry();
      const admin = registry.define('admin');
      admin.rights.allow('/admin/**', Flags.ALL);
      const editor = registry.define('editor');
      editor.rights.allow('/posts/**', Flags.WRITE);

      const adminUser = new Subject();
      adminUser.memberOf(admin);
      await adapter.saveSubject('admin-user', adminUser);

      const editorUser = new Subject();
      editorUser.memberOf(editor);
      await adapter.saveSubject('editor-user', editorUser);

      const directUser = new Subject();
      directUser.rights.add(
        new Right('/admin/dashboard', { allow: [Flags.READ] })
      );
      await adapter.saveSubject('direct-user', directUser);

      const noRightsUser = new Subject();
      await adapter.saveSubject('no-rights-user', noRightsUser);

      const adminAccess = await adapter.findSubjectsWithAccess(
        '/admin/**',
        Flags.ALL
      );
      expect(adminAccess).toContain('admin-user');
      expect(adminAccess).not.toContain('editor-user');
      expect(adminAccess).not.toContain('direct-user');
      expect(adminAccess).not.toContain('no-rights-user');

      const writeAccess = await adapter.findSubjectsWithAccess(
        '/posts/**',
        Flags.WRITE
      );
      expect(writeAccess).toContain('editor-user');
      expect(writeAccess).not.toContain('admin-user');
      expect(writeAccess).not.toContain('direct-user');
      expect(writeAccess).not.toContain('no-rights-user');

      const dashboardRead = await adapter.findSubjectsWithAccess(
        '/admin/dashboard',
        Flags.READ
      );
      expect(dashboardRead).toContain('admin-user');
      expect(dashboardRead).toContain('direct-user');
      expect(dashboardRead).not.toContain('editor-user');
      expect(dashboardRead).not.toContain('no-rights-user');
    });

    test('findSubjectsWithAccess returns empty array when no subjects match', async () => {
      const { Subject } = await import('../../index');
      const subject = new Subject();
      await adapter.saveSubject('user', subject);

      const results = await adapter.findSubjectsWithAccess(
        '/admin/**',
        Flags.ALL
      );
      expect(results).toEqual([]);
    });

    test('findSubjectsWithAccess handles wildcard patterns correctly', async () => {
      const { RoleRegistry, Subject } = await import('../../index');

      const registry = new RoleRegistry();
      const apiUser = registry.define('api-user');
      apiUser.rights.allow('/api/**', Flags.READ);

      const user1 = new Subject();
      user1.memberOf(apiUser);
      await adapter.saveSubject('api-user-1', user1);

      const user2 = new Subject();
      user2.rights.allow('/api/v1/users', Flags.READ);
      await adapter.saveSubject('api-user-2', user2);

      const v1UsersAccess = await adapter.findSubjectsWithAccess(
        '/api/v1/users',
        Flags.READ
      );
      expect(v1UsersAccess).toContain('api-user-1');
      expect(v1UsersAccess).toContain('api-user-2');

      const v1WildcardAccess = await adapter.findSubjectsWithAccess(
        '/api/v1/**',
        Flags.READ
      );
      expect(v1WildcardAccess).toContain('api-user-1');
      expect(v1WildcardAccess).not.toContain('api-user-2');

      const allApiAccess = await adapter.findSubjectsWithAccess(
        '/api/**',
        Flags.READ
      );
      expect(allApiAccess).toContain('api-user-1');
      expect(allApiAccess).not.toContain('api-user-2');
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

  describe('Right dbId assignment', () => {
    test('loadRight returns right with dbId set', async () => {
      const right = new Right('/users/*', { allow: [Flags.READ] });
      expect(right.dbId).toBeUndefined();

      const id = await adapter.saveRight(right);
      const loaded = await adapter.loadRight(id);

      expect(loaded).not.toBeNull();
      expect(loaded!.dbId).toBe(id);
    });

    test('loadRights returns all rights with dbIds set', async () => {
      const rights = new Rights();
      rights.allow('/a', Flags.READ);
      rights.allow('/b', Flags.WRITE);
      rights.allow('/c', Flags.DELETE);

      const ids = await adapter.saveRights(rights);

      const loaded = await adapter.loadRights();
      const loadedRights = loaded.allRights();

      expect(loadedRights).toHaveLength(3);
      for (const right of loadedRights) {
        expect(right.dbId).toBeDefined();
        expect(ids).toContain(right.dbId!);
      }
    });

    test('loadRightsByPath returns rights with dbIds set', async () => {
      await adapter.saveRight(new Right('/users/123', { allow: [Flags.READ] }));
      await adapter.saveRight(
        new Right('/users/456', { allow: [Flags.WRITE] })
      );

      const rights = await adapter.loadRightsByPath('/users/*');
      const loadedRights = rights.allRights();

      expect(loadedRights).toHaveLength(2);
      for (const right of loadedRights) {
        expect(right.dbId).toBeDefined();
        expect(right.dbId).toBeGreaterThan(0);
      }
    });
  });

  describe('loadRegistry inheritance fix', () => {
    test('loaded registry has working inheritance', async () => {
      const { RoleRegistry, Subject } = await import('../../index');

      // Create and save a registry with inheritance
      const registry = new RoleRegistry();
      const viewer = registry.define('viewer');
      viewer.rights.allow('/read/*', Flags.READ);

      const editor = registry.define('editor');
      editor.rights.allow('/write/*', Flags.WRITE);
      editor.inheritsFrom(viewer);

      await adapter.saveRegistry(registry);

      // Load the registry fresh
      const loaded = await adapter.loadRegistry();

      // Get the editor role from loaded registry
      const loadedEditor = loaded.get('editor');
      expect(loadedEditor).not.toBeUndefined();

      // Verify inheritance works - editor should have both own rights and inherited viewer rights
      const allRights = loadedEditor!.allRights();
      expect(allRights.length).toBe(2);

      const paths = allRights.map(r => r.right.path).sort();
      expect(paths).toContain('/read/*');
      expect(paths).toContain('/write/*');

      // Verify a Subject using the loaded role works correctly
      const subject = new Subject();
      subject.memberOf(loadedEditor!);

      expect(subject.read('/read/something')).toBe(true);
      expect(subject.write('/write/something')).toBe(true);
    });

    test('loaded registry handles multi-level inheritance', async () => {
      const { RoleRegistry, Subject } = await import('../../index');

      // Create a 3-level hierarchy
      const registry = new RoleRegistry();
      const base = registry.define('base');
      base.rights.allow('/base/*', Flags.READ);

      const middle = registry.define('middle');
      middle.rights.allow('/middle/*', Flags.WRITE);
      middle.inheritsFrom(base);

      const top = registry.define('top');
      top.rights.allow('/top/*', Flags.ALL);
      top.inheritsFrom(middle);

      await adapter.saveRegistry(registry);

      // Load and verify
      const loaded = await adapter.loadRegistry();
      const loadedTop = loaded.get('top');

      expect(loadedTop).not.toBeUndefined();

      const allRights = loadedTop!.allRights();
      expect(allRights.length).toBe(3);

      const subject = new Subject();
      subject.memberOf(loadedTop!);

      // Should have access from all levels
      expect(subject.read('/base/file')).toBe(true);
      expect(subject.write('/middle/file')).toBe(true);
      expect(subject.all('/top/file')).toBe(true);
    });

    test('loaded registry inheritance is in registry not just loaded role', async () => {
      const { RoleRegistry, Subject } = await import('../../index');

      const registry = new RoleRegistry();
      const parent = registry.define('parent');
      parent.rights.allow('/parent/*', Flags.READ);

      const child = registry.define('child');
      child.rights.allow('/child/*', Flags.WRITE);
      child.inheritsFrom(parent);

      await adapter.saveRegistry(registry);

      // Load registry
      const loaded = await adapter.loadRegistry();

      // Get roles from registry (not from loadRoles directly)
      const loadedParent = loaded.get('parent');
      const loadedChild = loaded.get('child');

      expect(loadedParent).not.toBeUndefined();
      expect(loadedChild).not.toBeUndefined();

      // Verify parent-child relationship is on the registered roles
      expect(loadedChild!.parents).toContain(loadedParent!);

      // Verify changes to parent propagate to child (cache invalidation works)
      loadedParent!.rights.allow('/new-parent-path/*', Flags.EXECUTE);

      const subject = new Subject();
      subject.memberOf(loadedChild!);

      expect(subject.execute('/new-parent-path/script')).toBe(true);
    });
  });
});
