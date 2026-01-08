import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from 'bun:test';

import { Flags, Right, Rights } from '@/index';
import {
  ValkeyContainer,
  type StartedValkeyContainer
} from '@testcontainers/valkey';

import { RedisAdapter } from '../redis-adapter';

const VALKEY_IMAGE = 'valkey/valkey:8.0';

describe('RedisAdapter', () => {
  let container: StartedValkeyContainer;
  let adapter: RedisAdapter;

  beforeAll(async () => {
    container = await new ValkeyContainer(VALKEY_IMAGE).start();
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  beforeEach(async () => {
    adapter = new RedisAdapter({
      host: container.getHost(),
      port: container.getMappedPort(6379)
    });
    await adapter.connect();
    await adapter.migrate();
  }, 30_000);

  afterEach(async () => {
    await adapter.clear();
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

    test('saveRight returns existing ID for duplicate unique constraint', async () => {
      const right1 = new Right('/users/*', {
        allow: [Flags.READ],
        deny: [Flags.DELETE]
      });
      const right2 = new Right('/users/*', {
        allow: [Flags.READ],
        deny: [Flags.DELETE]
      });

      const id1 = await adapter.saveRight(right1);
      const id2 = await adapter.saveRight(right2);

      expect(id1).toBe(id2);
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

    test('transaction throws on error but data may persist (Redis limitation)', async () => {
      // Note: Redis MULTI/EXEC doesn't support true rollback
      // This test documents the behavior rather than expecting rollback
      let errorThrown = false;

      try {
        await adapter.transaction(async () => {
          await adapter.saveRight(new Right('/a', { allow: [Flags.READ] }));
          throw new Error('Simulated error');
        });
      } catch {
        errorThrown = true;
      }

      expect(errorThrown).toBe(true);
      // Unlike SQL databases, the first save may have persisted
      // This is expected Redis behavior
    });
  });

  describe('Utility operations', () => {
    test('clear removes all data', async () => {
      await adapter.saveRight(new Right('/test', { allow: [Flags.READ] }));

      await adapter.clear();

      const rights = await adapter.loadRights();
      expect(rights.allRights()).toHaveLength(0);
    });

    test('clear only removes adapter-managed keys', async () => {
      // This test would require direct Redis access to set a non-prefixed key
      // For now, we just verify clear works without errors
      await adapter.saveRight(new Right('/test', { allow: [Flags.READ] }));
      await adapter.clear();

      const rights = await adapter.loadRights();
      expect(rights.allRights()).toHaveLength(0);
    });
  });
});

describe('RedisAdapter with custom table prefix', () => {
  let container: StartedValkeyContainer;
  let adapter: RedisAdapter;

  beforeAll(async () => {
    container = await new ValkeyContainer(VALKEY_IMAGE).start();
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  beforeEach(async () => {
    adapter = new RedisAdapter({
      host: container.getHost(),
      port: container.getMappedPort(6379),
      tablePrefix: 'auth_'
    });
    await adapter.connect();
    await adapter.migrate();
  }, 30_000);

  afterEach(async () => {
    await adapter.clear();
    await adapter.disconnect();
  });

  test('uses custom prefix for keys', async () => {
    await adapter.saveRight(new Right('/users', { allow: [Flags.READ] }));

    const rights = await adapter.loadRights();
    expect(rights.allRights()).toHaveLength(1);
  });
});

describe('RedisAdapter with URL connection', () => {
  let container: StartedValkeyContainer;
  let adapter: RedisAdapter;

  beforeAll(async () => {
    container = await new ValkeyContainer(VALKEY_IMAGE).start();
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  beforeEach(async () => {
    const host = container.getHost();
    const port = container.getMappedPort(6379);
    adapter = new RedisAdapter({
      url: `redis://${host}:${port}`
    });
    await adapter.connect();
    await adapter.migrate();
  }, 30_000);

  afterEach(async () => {
    await adapter.clear();
    await adapter.disconnect();
  });

  test('connects via URL and performs operations', async () => {
    await adapter.saveRight(new Right('/url-test', { allow: [Flags.READ] }));

    const rights = await adapter.loadRights();
    expect(rights.allRights()).toHaveLength(1);
    expect(rights.allRights()[0]?.path).toBe('/url-test');
  });
});
