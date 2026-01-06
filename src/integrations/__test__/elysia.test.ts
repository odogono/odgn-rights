// @ts-nocheck - Elysia has complex generic types that are difficult to satisfy statically
import { beforeAll, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';

import { Flags } from '../../constants';
import { Right } from '../../right';
import { Rights } from '../../rights';
import { RoleRegistry } from '../../role-registry';
import { Subject } from '../../subject';
import { SubjectRegistry } from '../../subject-registry';
import {
  createRightsGuard,
  elysiaRights,
  elysiaRightsStandalone
} from '../elysia';

describe('elysiaRights', () => {
  describe('with SubjectRegistry', () => {
    let app: Elysia;
    let registry: SubjectRegistry;
    let roleRegistry: RoleRegistry;

    beforeAll(() => {
      // Set up roles
      roleRegistry = new RoleRegistry();
      const adminRole = roleRegistry.define(
        'admin',
        new Rights()
          .allow('/admin', Flags.ALL)
          .allow('/admin/**', Flags.ALL)
          .allow('/users', Flags.ALL)
          .allow('/users/**', Flags.ALL)
      );
      const userRole = roleRegistry.define(
        'user',
        new Rights()
          .allow('/users', Flags.READ)
          .allow('/users/**', Flags.READ)
          .allow('/posts', Flags.READ)
          .allow('/posts/**', Flags.READ)
      );

      // Set up subjects
      registry = new SubjectRegistry();

      const adminSubject = new Subject().memberOf(adminRole);
      registry.register('admin-user', adminSubject);

      const normalSubject = new Subject().memberOf(userRole);
      registry.register('normal-user', normalSubject);

      // Create app with rights middleware
      app = new Elysia()
        .use(
          elysiaRights({
            getSubject: ({ headers }) => headers.get('x-user-id'),
            registry
          })
        )
        .get('/users', () => ({ users: [] }))
        .get('/users/:id', ({ params }) => ({ user: params.id }))
        .post('/users', () => ({ created: true }))
        .delete('/users/:id', ({ params }) => ({ deleted: params.id }))
        .get('/admin/dashboard', () => ({ dashboard: true }))
        .get('/posts', () => ({ posts: [] }));
    });

    it('should allow admin to access admin routes', async () => {
      const response = await app.handle(
        new Request('http://localhost/admin/dashboard', {
          headers: { 'x-user-id': 'admin-user' }
        })
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ dashboard: true });
    });

    it('should deny normal user access to admin routes', async () => {
      const response = await app.handle(
        new Request('http://localhost/admin/dashboard', {
          headers: { 'x-user-id': 'normal-user' }
        })
      );
      expect(response.status).toBe(403);
    });

    it('should allow normal user to read users', async () => {
      const response = await app.handle(
        new Request('http://localhost/users', {
          headers: { 'x-user-id': 'normal-user' }
        })
      );
      expect(response.status).toBe(200);
    });

    it('should deny normal user to create users (POST requires CREATE flag)', async () => {
      const response = await app.handle(
        new Request('http://localhost/users', {
          headers: { 'x-user-id': 'normal-user' },
          method: 'POST'
        })
      );
      expect(response.status).toBe(403);
    });

    it('should allow admin to create users', async () => {
      const response = await app.handle(
        new Request('http://localhost/users', {
          headers: { 'x-user-id': 'admin-user' },
          method: 'POST'
        })
      );
      expect(response.status).toBe(200);
    });

    it('should return 401 when no user header is provided', async () => {
      const response = await app.handle(new Request('http://localhost/users'));
      expect(response.status).toBe(401);
    });

    it('should return 401 when user is not found in registry', async () => {
      const response = await app.handle(
        new Request('http://localhost/users', {
          headers: { 'x-user-id': 'unknown-user' }
        })
      );
      expect(response.status).toBe(401);
    });
  });

  describe('with direct Subject', () => {
    let app: Elysia;

    beforeAll(() => {
      const userSubject = new Subject();
      userSubject.rights.allow('/api/**', Flags.READ);
      userSubject.rights.allow('/api/my-data', Flags.WRITE);

      app = new Elysia()
        .derive(() => ({
          subject: userSubject
        }))
        .use(
          elysiaRights({
            getSubject: ctx => ctx.subject
          })
        )
        .get('/api/data', () => ({ data: 'public' }))
        .put('/api/my-data', () => ({ updated: true }))
        .delete('/api/data', () => ({ deleted: true }));
    });

    it('should allow read access', async () => {
      const response = await app.handle(
        new Request('http://localhost/api/data')
      );
      expect(response.status).toBe(200);
    });

    it('should allow write to specific path', async () => {
      const response = await app.handle(
        new Request('http://localhost/api/my-data', { method: 'PUT' })
      );
      expect(response.status).toBe(200);
    });

    it('should deny delete access', async () => {
      const response = await app.handle(
        new Request('http://localhost/api/data', { method: 'DELETE' })
      );
      expect(response.status).toBe(403);
    });
  });

  describe('with pathMapper', () => {
    let app: Elysia;
    let registry: SubjectRegistry;

    beforeAll(() => {
      registry = new SubjectRegistry();
      const subject = new Subject();
      subject.rights.allow('/users', Flags.READ);
      subject.rights.allow('/users/**', Flags.READ);
      registry.register('user1', subject);

      app = new Elysia()
        .use(
          elysiaRights({
            getSubject: ({ headers }) => headers.get('x-user-id'),
            pathMapper: ({ path }) => path.replace('/api/v1', ''),
            registry
          })
        )
        .get('/api/v1/users', () => ({ users: [] }));
    });

    it('should use mapped path for permission check', async () => {
      const response = await app.handle(
        new Request('http://localhost/api/v1/users', {
          headers: { 'x-user-id': 'user1' }
        })
      );
      expect(response.status).toBe(200);
    });
  });

  describe('with custom flagMapper', () => {
    let app: Elysia;
    let registry: SubjectRegistry;

    beforeAll(() => {
      registry = new SubjectRegistry();
      const subject = new Subject();
      subject.rights.allow('/resources/**', Flags.EXECUTE);
      registry.register('user1', subject);

      app = new Elysia()
        .use(
          elysiaRights({
            flagMapper: () => Flags.EXECUTE, // Always require EXECUTE
            getSubject: ({ headers }) => headers.get('x-user-id'),
            registry
          })
        )
        .get('/resources/action', () => ({ executed: true }));
    });

    it('should use custom flag mapping', async () => {
      const response = await app.handle(
        new Request('http://localhost/resources/action', {
          headers: { 'x-user-id': 'user1' }
        })
      );
      expect(response.status).toBe(200);
    });
  });

  describe('with custom error handlers', () => {
    let app: Elysia;

    beforeAll(() => {
      const registry = new SubjectRegistry();
      const subject = new Subject();
      subject.rights.deny('/forbidden', Flags.ALL);
      registry.register('user1', subject);

      app = new Elysia()
        .use(
          elysiaRights({
            getSubject: ({ headers }) => headers.get('x-user-id'),
            onNoSubject: () => new Response('Custom: No user', { status: 401 }),
            onUnauthorized: ({ path }) =>
              new Response(`Custom: Access denied to ${path}`, { status: 403 }),
            registry
          })
        )
        .get('/forbidden', () => 'should not reach');
    });

    it('should use custom onNoSubject handler', async () => {
      const response = await app.handle(
        new Request('http://localhost/forbidden')
      );
      expect(response.status).toBe(401);
      expect(await response.text()).toBe('Custom: No user');
    });

    it('should use custom onUnauthorized handler', async () => {
      const response = await app.handle(
        new Request('http://localhost/forbidden', {
          headers: { 'x-user-id': 'user1' }
        })
      );
      expect(response.status).toBe(403);
      expect(await response.text()).toBe('Custom: Access denied to /forbidden');
    });
  });
});

describe('elysiaRightsStandalone', () => {
  let app: Elysia;

  beforeAll(() => {
    const rights = new Rights();
    rights.allow('/public/**', Flags.READ);
    rights.allow('/api/**', Flags.READ);
    rights.deny('/api/internal/**', Flags.ALL);

    app = new Elysia()
      .use(elysiaRightsStandalone({ rights }))
      .get('/public/info', () => ({ info: 'public' }))
      .get('/api/data', () => ({ data: 'api' }))
      .get('/api/internal/secret', () => ({ secret: 'hidden' }));
  });

  it('should allow access to public routes', async () => {
    const response = await app.handle(
      new Request('http://localhost/public/info')
    );
    expect(response.status).toBe(200);
  });

  it('should allow access to api routes', async () => {
    const response = await app.handle(new Request('http://localhost/api/data'));
    expect(response.status).toBe(200);
  });

  it('should deny access to internal routes', async () => {
    const response = await app.handle(
      new Request('http://localhost/api/internal/secret')
    );
    expect(response.status).toBe(403);
  });
});

describe('createRightsGuard', () => {
  let app: Elysia;

  beforeAll(() => {
    const registry = new SubjectRegistry();
    const subject = new Subject();
    subject.rights.allow('/protected/**', Flags.READ);
    registry.register('user1', subject);

    const guard = createRightsGuard({
      getSubject: ({ headers }) => headers.get('x-user-id'),
      registry
    });

    app = new Elysia()
      .get('/public', () => ({ public: true }))
      .guard(guard, app =>
        app.get('/protected/resource', () => ({ protected: true }))
      );
  });

  it('should allow access to unguarded routes', async () => {
    const response = await app.handle(new Request('http://localhost/public'));
    expect(response.status).toBe(200);
  });

  it('should protect guarded routes', async () => {
    const response = await app.handle(
      new Request('http://localhost/protected/resource', {
        headers: { 'x-user-id': 'user1' }
      })
    );
    expect(response.status).toBe(200);
  });

  it('should deny access to guarded routes without auth', async () => {
    const response = await app.handle(
      new Request('http://localhost/protected/resource')
    );
    expect(response.status).toBe(401);
  });
});

describe('ABAC conditions', () => {
  let app: Elysia;

  beforeAll(() => {
    const registry = new SubjectRegistry();
    const subject = new Subject();
    subject.rights.add(
      new Right('/posts/*', {
        allow: [Flags.DELETE],
        condition: (ctx: { ownerId?: string; userId?: string }) =>
          ctx?.userId === ctx?.ownerId
      })
    );
    registry.register('user1', subject);

    app = new Elysia()
      .use(
        elysiaRights({
          getContext: ({ headers }) => ({
            ownerId: headers.get('x-owner-id'),
            userId: headers.get('x-user-id')
          }),
          getSubject: ({ headers }) => headers.get('x-user-id'),
          registry
        })
      )
      .delete('/posts/:id', ({ params }) => ({ deleted: params.id }));
  });

  it('should allow when condition is met', async () => {
    const response = await app.handle(
      new Request('http://localhost/posts/123', {
        headers: {
          'x-owner-id': 'user1',
          'x-user-id': 'user1'
        },
        method: 'DELETE'
      })
    );
    expect(response.status).toBe(200);
  });

  it('should deny when condition is not met', async () => {
    const response = await app.handle(
      new Request('http://localhost/posts/123', {
        headers: {
          'x-owner-id': 'other-user',
          'x-user-id': 'user1'
        },
        method: 'DELETE'
      })
    );
    expect(response.status).toBe(403);
  });
});

describe('HTTP method to flag mapping', () => {
  let app: Elysia;
  let registry: SubjectRegistry;

  beforeAll(() => {
    registry = new SubjectRegistry();
    const subject = new Subject();
    subject.rights.allow('/resource', Flags.READ);
    subject.rights.allow('/resource', Flags.CREATE);
    subject.rights.allow('/resource', Flags.WRITE);
    subject.rights.allow('/resource', Flags.DELETE);
    registry.register('user1', subject);

    app = new Elysia()
      .use(
        elysiaRights({
          getSubject: ({ headers }) => headers.get('x-user-id'),
          registry
        })
      )
      .get('/resource', () => 'read')
      .post('/resource', () => 'create')
      .put('/resource', () => 'write')
      .patch('/resource', () => 'write')
      .delete('/resource', () => 'delete');
  });

  it('GET should require READ flag', async () => {
    const response = await app.handle(
      new Request('http://localhost/resource', {
        headers: { 'x-user-id': 'user1' }
      })
    );
    expect(response.status).toBe(200);
  });

  it('POST should require CREATE flag', async () => {
    const response = await app.handle(
      new Request('http://localhost/resource', {
        headers: { 'x-user-id': 'user1' },
        method: 'POST'
      })
    );
    expect(response.status).toBe(200);
  });

  it('PUT should require WRITE flag', async () => {
    const response = await app.handle(
      new Request('http://localhost/resource', {
        headers: { 'x-user-id': 'user1' },
        method: 'PUT'
      })
    );
    expect(response.status).toBe(200);
  });

  it('PATCH should require WRITE flag', async () => {
    const response = await app.handle(
      new Request('http://localhost/resource', {
        headers: { 'x-user-id': 'user1' },
        method: 'PATCH'
      })
    );
    expect(response.status).toBe(200);
  });

  it('DELETE should require DELETE flag', async () => {
    const response = await app.handle(
      new Request('http://localhost/resource', {
        headers: { 'x-user-id': 'user1' },
        method: 'DELETE'
      })
    );
    expect(response.status).toBe(200);
  });
});
