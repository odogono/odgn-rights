import { SQL } from 'bun';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from 'bun:test';
import {
  GenericContainer,
  Wait,
  type StartedTestContainer
} from 'testcontainers';

import { Flags, Right, Rights } from '@/index';

import { PostgresAdapter } from '../postgres-adapter';

const POSTGRES_IMAGE = 'postgres:17-alpine';

const startPostgresContainer = async (): Promise<StartedTestContainer> =>
  new GenericContainer(POSTGRES_IMAGE)
    .withCommand([
      'postgres',
      '-c',
      'shared_preload_libraries=pg_stat_statements',
      '-c',
      'compute_query_id=on'
    ])
    .withEnvironment({
      POSTGRES_DB: 'test',
      POSTGRES_PASSWORD: 'test',
      POSTGRES_USER: 'test'
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage('database system is ready to accept connections', 2)
    )
    .start();

const getConnectionUri = (container: StartedTestContainer): string => {
  const host = container.getHost();
  const port = container.getMappedPort(5432);
  return `postgres://test:test@${host}:${port}/test`;
};

const countPermissionQueries = async <T>(
  container: StartedTestContainer,
  operation: () => Promise<T>
): Promise<{ calls: number; result: T }> => {
  const sql = new SQL(getConnectionUri(container));
  await sql`SELECT pg_stat_statements_reset()`;

  const result = await operation();
  const [row] = await sql<{ calls: string }[]>`
    SELECT COALESCE(SUM(calls), 0)::text AS calls
    FROM pg_stat_statements
    WHERE query NOT ILIKE '%pg_stat_statements%'
      AND (
        query ILIKE '%roles%'
        OR query ILIKE '%role_rights%'
        OR query ILIKE '%role_inheritance%'
        OR query ILIKE '%rights%'
        OR query ILIKE '%subjects%'
        OR query ILIKE '%subject_roles%'
        OR query ILIKE '%subject_rights%'
      )
  `;
  await sql.end();

  return { calls: Number(row?.calls ?? '0'), result };
};

describe('PostgresAdapter', () => {
  let container: StartedTestContainer;
  let adapter: PostgresAdapter;

  beforeAll(async () => {
    container = await startPostgresContainer();
    const sql = new SQL(getConnectionUri(container));
    await sql`CREATE EXTENSION IF NOT EXISTS pg_stat_statements`;
    await sql.end();
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  beforeEach(async () => {
    adapter = new PostgresAdapter({ url: getConnectionUri(container) });
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

      const rights = await adapter.loadRightsByPath('/users/%');
      expect(rights.allRights()).toHaveLength(2);
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
    test('loadRegistry uses two queries regardless of registry size', async () => {
      const { RoleRegistry, Subject } = await import('../../index');

      const registry = new RoleRegistry();
      const shared = registry.define('shared');
      shared.rights.allow('/shared', Flags.READ);

      for (let index = 0; index < 12; index += 1) {
        const role = registry.define(`role-${index}`);
        role.rights.allow(`/role-${index}`, Flags.READ);
        role.rights.add(shared.rights.allRights()[0]!);
        if (index > 0) {
          role.inheritsFrom(registry.get(`role-${index - 1}`)!);
        }
      }
      registry.define('empty');
      await adapter.saveRegistry(registry);

      const { calls, result: loaded } = await countPermissionQueries(
        container,
        () => adapter.loadRegistry()
      );

      expect(calls).toBe(2);
      expect(loaded.get('empty')).toBeDefined();
      const subject = new Subject().memberOf(loaded.get('role-11')!);
      expect(subject.read('/shared')).toBe(true);
      expect(subject.read('/role-0')).toBe(true);
    });

    test('loadRegistry keeps a production-shaped query count constant', async () => {
      const sql = new SQL(getConnectionUri(container));
      await sql`
        INSERT INTO tbl_roles (name)
        SELECT 'production-role-' || role_number
        FROM generate_series(1, 52) role_number
      `;
      await sql`
        INSERT INTO tbl_rights (path, allow_mask, deny_mask, priority)
        SELECT '/production/right/' || right_number, 1, 0, 0
        FROM generate_series(1, 52051) right_number
      `;
      await sql`
        INSERT INTO tbl_role_rights (role_id, right_id)
        SELECT role.id, mapped_right.id
        FROM (
          SELECT id, row_number() OVER (ORDER BY id) AS role_number
          FROM tbl_roles
          WHERE name LIKE 'production-role-%'
        ) role
        JOIN (
          SELECT id, row_number() OVER (ORDER BY id) AS right_number
          FROM tbl_rights
          WHERE path LIKE '/production/right/%'
        ) mapped_right
          ON ((mapped_right.right_number - 1) % 52) + 1 = role.role_number
        WHERE mapped_right.right_number <= 1026
      `;
      await sql`
        INSERT INTO tbl_role_inheritance (child_role_id, parent_role_id)
        SELECT child.id, parent.id
        FROM (
          SELECT id, row_number() OVER (ORDER BY id) AS role_number
          FROM tbl_roles
          WHERE name LIKE 'production-role-%'
        ) child
        JOIN (
          SELECT id, row_number() OVER (ORDER BY id) AS role_number
          FROM tbl_roles
          WHERE name LIKE 'production-role-%'
        ) parent ON parent.role_number = child.role_number - 1
        WHERE child.role_number BETWEEN 2 AND 10
      `;
      await sql.end();

      const { calls, result: loaded } = await countPermissionQueries(
        container,
        () => adapter.loadRegistry()
      );
      const mappedRights = loaded
        .getAll()
        .reduce((total, role) => total + role.rights.allRights().length, 0);

      expect(calls).toBe(2);
      expect(loaded.getAll()).toHaveLength(52);
      expect(mappedRights).toBe(1026);
      expect(loaded.get('production-role-10')?.parents[0]?.name).toBe(
        'production-role-9'
      );
    });

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
    test('loadSubject uses two queries with a preloaded registry', async () => {
      const { RoleRegistry, Subject } = await import('../../index');

      const registry = new RoleRegistry();
      const viewer = registry.define('viewer');
      viewer.rights.allow('/shared', Flags.READ);
      const editor = registry.define('editor');
      editor.rights.allow('/content', Flags.WRITE);
      editor.inheritsFrom(viewer);
      await adapter.saveRegistry(registry);

      const subject = new Subject().memberOf(editor);
      subject.rights.allow('/profile', Flags.READ);
      await adapter.saveSubject('batched-user', subject);
      const preloadedRegistry = await adapter.loadRegistry();

      const { calls, result: loaded } = await countPermissionQueries(
        container,
        () => adapter.loadSubject('batched-user', preloadedRegistry)
      );

      expect(calls).toBe(2);
      expect(loaded?.read('/shared')).toBe(true);
      expect(loaded?.write('/content')).toBe(true);
      expect(loaded?.read('/profile')).toBe(true);
    });

    test('loadSubject uses four queries when it loads the registry', async () => {
      const { RoleRegistry, Subject } = await import('../../index');

      const registry = new RoleRegistry();
      const role = registry.define('cold-reader');
      role.rights.allow('/cold', Flags.READ);
      await adapter.saveRegistry(registry);
      await adapter.saveSubject('cold-user', new Subject().memberOf(role));

      const { calls, result: loaded } = await countPermissionQueries(
        container,
        () => adapter.loadSubject('cold-user')
      );

      expect(calls).toBe(4);
      expect(loaded?.read('/cold')).toBe(true);
    });

    test('loadSubject returns a missing subject after one query', async () => {
      const { calls, result } = await countPermissionQueries(container, () =>
        adapter.loadSubject('missing-user')
      );

      expect(calls).toBe(1);
      expect(result).toBeNull();
    });

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
      await adapter
        .transaction(async () => {
          await adapter.saveRight(new Right('/a', { allow: [Flags.READ] }));
          throw new Error('Simulated error');
        })
        .catch(() => {});

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

describe('PostgresAdapter with custom table prefix', () => {
  let container: StartedTestContainer;
  let adapter: PostgresAdapter;

  beforeAll(async () => {
    container = await startPostgresContainer();
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  beforeEach(async () => {
    adapter = new PostgresAdapter({
      tablePrefix: 'auth_',
      url: getConnectionUri(container)
    });
    await adapter.connect();
    await adapter.migrate();
  }, 30_000);

  afterEach(async () => {
    await adapter.clear();
    await adapter.disconnect();
  });

  test('creates tables with custom prefix', async () => {
    await adapter.saveRight(new Right('/users', { allow: [Flags.READ] }));

    const rights = await adapter.loadRights();
    expect(rights.allRights()).toHaveLength(1);
  });
});
