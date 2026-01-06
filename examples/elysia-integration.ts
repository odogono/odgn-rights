/* eslint-disable no-console */
/**
 * Example: Elysia Integration
 *
 * This example demonstrates how to integrate odgn-rights with ElysiaJS
 * for HTTP route authorization.
 *
 * Run with: bun run examples/elysia-integration.ts
 *
 * Note: When using as a package, replace '../src' imports with 'odgn-rights'
 * and '../src/integrations/elysia' with 'odgn-rights/integrations/elysia'
 */

import { Elysia } from 'elysia';

import {
  Flags,
  Right,
  Rights,
  RoleRegistry,
  Subject,
  SubjectRegistry
} from '../src';
import {
  createRightsGuard,
  elysiaRights,
  elysiaRightsStandalone
} from '../src/integrations/elysia';

// =============================================================================
// Example 1: Basic Integration with SubjectRegistry
// =============================================================================
const basicExample = async (): Promise<void> => {
  console.log('--- Basic Integration with SubjectRegistry ---\n');

  // Set up role registry with different permission levels
  const roleRegistry = new RoleRegistry();

  const adminRole = roleRegistry.define(
    'admin',
    new Rights()
      .allow('/admin', Flags.ALL)
      .allow('/admin/**', Flags.ALL)
      .allow('/users', Flags.ALL)
      .allow('/users/**', Flags.ALL)
      .allow('/posts', Flags.ALL)
      .allow('/posts/**', Flags.ALL)
  );

  const userRole = roleRegistry.define(
    'user',
    new Rights()
      .allow('/users', Flags.READ)
      .allow('/users/**', Flags.READ)
      .allow('/posts', Flags.READ)
      .allow('/posts/**', Flags.READ)
  );

  // Set up subject registry with users
  const subjectRegistry = new SubjectRegistry();

  const adminSubject = new Subject().memberOf(adminRole);
  subjectRegistry.register('admin-user', adminSubject);

  const normalSubject = new Subject().memberOf(userRole);
  subjectRegistry.register('normal-user', normalSubject);

  // Create Elysia app with rights middleware
  const app = new Elysia()
    .use(
      elysiaRights({
        getSubject: ({ headers }) => headers.get('x-user-id'),
        registry: subjectRegistry
      })
    )
    .get('/users', () => ({ users: ['alice', 'bob'] }))
    .get('/users/:id', ({ params }) => ({
      user: { id: params.id, name: 'Alice' }
    }))
    .post('/users', () => ({ created: true, id: 'new-user-123' }))
    .delete('/users/:id', ({ params }) => ({ deleted: params.id }))
    .get('/admin/dashboard', () => ({ stats: { posts: 500, users: 100 } }))
    .get('/posts', () => ({ posts: [{ id: 1, title: 'Hello World' }] }));

  // Test requests
  console.log('Testing admin access to /admin/dashboard...');
  let response = await app.handle(
    new Request('http://localhost/admin/dashboard', {
      headers: { 'x-user-id': 'admin-user' }
    })
  );
  console.log(`  Status: ${response.status}, Body:`, await response.json());

  console.log('\nTesting normal user access to /admin/dashboard...');
  response = await app.handle(
    new Request('http://localhost/admin/dashboard', {
      headers: { 'x-user-id': 'normal-user' }
    })
  );
  console.log(`  Status: ${response.status}, Body:`, await response.json());

  console.log('\nTesting normal user READ access to /users...');
  response = await app.handle(
    new Request('http://localhost/users', {
      headers: { 'x-user-id': 'normal-user' }
    })
  );
  console.log(`  Status: ${response.status}, Body:`, await response.json());

  console.log('\nTesting normal user POST (CREATE) to /users...');
  response = await app.handle(
    new Request('http://localhost/users', {
      headers: { 'x-user-id': 'normal-user' },
      method: 'POST'
    })
  );
  console.log(`  Status: ${response.status}, Body:`, await response.json());

  console.log('\nTesting request without user header...');
  response = await app.handle(new Request('http://localhost/users'));
  console.log(`  Status: ${response.status}, Body:`, await response.json());
};

// =============================================================================
// Example 2: Standalone Rights (No Subjects)
// =============================================================================
const standaloneExample = async (): Promise<void> => {
  console.log('\n--- Standalone Rights (Route-Level Authorization) ---\n');

  // Define rights for routes directly
  const rights = new Rights();
  rights.allow('/public/**', Flags.READ);
  rights.allow('/api/**', Flags.READ);
  rights.deny('/api/internal/**', Flags.ALL);

  const app = new Elysia()
    .use(elysiaRightsStandalone({ rights }))
    .get('/public/info', () => ({ message: 'Public information' }))
    .get('/api/data', () => ({ data: 'API data' }))
    .get('/api/internal/secret', () => ({
      secret: 'Should not be accessible'
    }));

  console.log('Testing access to /public/info...');
  let response = await app.handle(new Request('http://localhost/public/info'));
  console.log(`  Status: ${response.status}, Body:`, await response.json());

  console.log('\nTesting access to /api/data...');
  response = await app.handle(new Request('http://localhost/api/data'));
  console.log(`  Status: ${response.status}, Body:`, await response.json());

  console.log('\nTesting access to /api/internal/secret (denied)...');
  response = await app.handle(
    new Request('http://localhost/api/internal/secret')
  );
  console.log(`  Status: ${response.status}, Body:`, await response.json());
};

// =============================================================================
// Example 3: Guard for Selective Route Protection
// =============================================================================
const guardExample = async (): Promise<void> => {
  console.log('\n--- Guard for Selective Route Protection ---\n');

  const subjectRegistry = new SubjectRegistry();
  const subject = new Subject();
  subject.rights.allow('/protected/**', Flags.READ);
  subjectRegistry.register('user1', subject);

  const guard = createRightsGuard({
    getSubject: ({ headers }) => headers.get('x-user-id'),
    registry: subjectRegistry
  });

  const app = new Elysia()
    .get('/public', () => ({ message: 'Anyone can see this!' }))
    .guard(guard, app =>
      app
        .get('/protected/resource', () => ({ secret: 'Protected data' }))
        .get('/protected/another', () => ({ data: 'More protected data' }))
    );

  console.log('Testing access to /public (unguarded)...');
  let response = await app.handle(new Request('http://localhost/public'));
  console.log(`  Status: ${response.status}, Body:`, await response.json());

  console.log('\nTesting access to /protected/resource without auth...');
  response = await app.handle(
    new Request('http://localhost/protected/resource')
  );
  console.log(`  Status: ${response.status}, Body:`, await response.json());

  console.log('\nTesting access to /protected/resource with auth...');
  response = await app.handle(
    new Request('http://localhost/protected/resource', {
      headers: { 'x-user-id': 'user1' }
    })
  );
  console.log(`  Status: ${response.status}, Body:`, await response.json());
};

// =============================================================================
// Example 4: ABAC (Attribute-Based Access Control)
// =============================================================================
const abacExample = async (): Promise<void> => {
  console.log('\n--- ABAC (Attribute-Based Access Control) ---\n');

  const subjectRegistry = new SubjectRegistry();
  const subject = new Subject();

  // Add a conditional right: can only delete posts you own
  subject.rights.add(
    new Right('/posts/*', {
      allow: [Flags.DELETE],
      condition: ctx => {
        const context = ctx as
          | { ownerId?: string; userId?: string }
          | undefined;
        return context?.userId === context?.ownerId;
      }
    })
  );

  subjectRegistry.register('user1', subject);

  const app = new Elysia()
    .use(
      elysiaRights({
        getSubject: ({ headers }) => headers.get('x-user-id'),
        registry: subjectRegistry,
        // Build context for ABAC condition evaluation
        getContext: ({ headers }) => ({
          ownerId: headers.get('x-owner-id'), // Simulating resource ownership
          userId: headers.get('x-user-id')
        })
      })
    )
    .delete('/posts/:id', ({ params }) => ({ deleted: params.id }));

  console.log('Testing DELETE /posts/123 where user is the owner...');
  let response = await app.handle(
    new Request('http://localhost/posts/123', {
      headers: {
        'x-owner-id': 'user1', // User owns this post
        'x-user-id': 'user1'
      },
      method: 'DELETE'
    })
  );
  console.log(`  Status: ${response.status}, Body:`, await response.json());

  console.log('\nTesting DELETE /posts/123 where user is NOT the owner...');
  response = await app.handle(
    new Request('http://localhost/posts/123', {
      headers: {
        'x-owner-id': 'other-user', // Different owner
        'x-user-id': 'user1'
      },
      method: 'DELETE'
    })
  );
  console.log(`  Status: ${response.status}, Body:`, await response.json());
};

// =============================================================================
// Example 5: Path Mapping (API Versioning)
// =============================================================================
const pathMappingExample = async (): Promise<void> => {
  console.log('\n--- Path Mapping (API Versioning) ---\n');

  const subjectRegistry = new SubjectRegistry();
  const subject = new Subject();
  // Rights are defined without version prefix
  subject.rights.allow('/users', Flags.READ);
  subject.rights.allow('/users/**', Flags.READ);
  subjectRegistry.register('user1', subject);

  const app = new Elysia()
    .use(
      elysiaRights({
        getSubject: ({ headers }) => headers.get('x-user-id'),
        registry: subjectRegistry,
        // Strip the /api/v1 prefix when checking permissions
        pathMapper: ({ path }) => path.replace('/api/v1', '')
      })
    )
    .get('/api/v1/users', () => ({ users: ['alice', 'bob'] }))
    .get('/api/v1/users/:id', ({ params }) => ({ user: params.id }));

  console.log(
    'Testing /api/v1/users (mapped to /users for permission check)...'
  );
  const response = await app.handle(
    new Request('http://localhost/api/v1/users', {
      headers: { 'x-user-id': 'user1' }
    })
  );
  console.log(`  Status: ${response.status}, Body:`, await response.json());
};

// =============================================================================
// Example 6: Custom Error Handlers
// =============================================================================
const customErrorsExample = async (): Promise<void> => {
  console.log('\n--- Custom Error Handlers ---\n');

  const subjectRegistry = new SubjectRegistry();
  const subject = new Subject();
  subject.rights.deny('/forbidden', Flags.ALL);
  subjectRegistry.register('user1', subject);

  const app = new Elysia()
    .use(
      elysiaRights({
        getSubject: ({ headers }) => headers.get('x-user-id'),
        onNoSubject: ({ path }) =>
          new Response(
            JSON.stringify({
              error: 'Authentication required',
              hint: 'Please provide x-user-id header',
              path
            }),
            {
              headers: { 'Content-Type': 'application/json' },
              status: 401
            }
          ),
        onUnauthorized: ({ path, requiredFlags }) =>
          new Response(
            JSON.stringify({
              error: 'Permission denied',
              message:
                'You do not have sufficient permissions for this resource',
              path,
              requiredFlags: requiredFlags.toString()
            }),
            {
              headers: { 'Content-Type': 'application/json' },
              status: 403
            }
          ),
        registry: subjectRegistry
      })
    )
    .get('/forbidden', () => 'Should not reach here');

  console.log('Testing request without authentication...');
  let response = await app.handle(new Request('http://localhost/forbidden'));
  console.log(`  Status: ${response.status}, Body:`, await response.json());

  console.log('\nTesting request with authentication but no permission...');
  response = await app.handle(
    new Request('http://localhost/forbidden', {
      headers: { 'x-user-id': 'user1' }
    })
  );
  console.log(`  Status: ${response.status}, Body:`, await response.json());
};

// =============================================================================
// Example 7: Custom Flag Mapping
// =============================================================================
const customFlagMappingExample = async (): Promise<void> => {
  console.log('\n--- Custom Flag Mapping ---\n');

  const subjectRegistry = new SubjectRegistry();
  const subject = new Subject();
  subject.rights.allow('/actions/**', Flags.EXECUTE);
  subjectRegistry.register('user1', subject);

  const app = new Elysia()
    .use(
      elysiaRights({
        getSubject: ({ headers }) => headers.get('x-user-id'),
        registry: subjectRegistry,
        // Custom flag mapping: POST to /actions/* requires EXECUTE instead of CREATE
        flagMapper: ({ method, path }) => {
          if (path.startsWith('/actions/')) {
            return Flags.EXECUTE;
          }
          // Default mapping for other routes
          const defaultMap: Record<string, Flags> = {
            DELETE: Flags.DELETE,
            GET: Flags.READ,
            PATCH: Flags.WRITE,
            POST: Flags.CREATE,
            PUT: Flags.WRITE
          };
          return defaultMap[method] ?? Flags.READ;
        }
      })
    )
    .post('/actions/deploy', () => ({ status: 'deployed' }))
    .post('/actions/restart', () => ({ status: 'restarted' }));

  console.log('Testing POST /actions/deploy (requires EXECUTE flag)...');
  const response = await app.handle(
    new Request('http://localhost/actions/deploy', {
      headers: { 'x-user-id': 'user1' },
      method: 'POST'
    })
  );
  console.log(`  Status: ${response.status}, Body:`, await response.json());
};

// =============================================================================
// Example 8: Direct Subject (Without Registry)
// =============================================================================
const directSubjectExample = async (): Promise<void> => {
  console.log('\n--- Direct Subject (Without Registry) ---\n');

  // Create a subject directly
  const userSubject = new Subject();
  userSubject.rights.allow('/api/**', Flags.READ);
  userSubject.rights.allow('/api/my-data', Flags.WRITE);

  const app = new Elysia()
    .derive(() => ({
      // In real app, this would come from JWT/session/etc
      currentUser: userSubject
    }))
    .use(
      elysiaRights({
        // @ts-expect-error - derive adds currentUser to context
        getSubject: ctx => ctx.currentUser
      })
    )
    .get('/api/data', () => ({ data: 'Public API data' }))
    .put('/api/my-data', () => ({ updated: true }))
    .delete('/api/data', () => ({ deleted: true }));

  console.log('Testing GET /api/data (has READ)...');
  let response = await app.handle(new Request('http://localhost/api/data'));
  console.log(`  Status: ${response.status}, Body:`, await response.json());

  console.log(
    '\nTesting PUT /api/my-data (has WRITE for this specific path)...'
  );
  response = await app.handle(
    new Request('http://localhost/api/my-data', { method: 'PUT' })
  );
  console.log(`  Status: ${response.status}, Body:`, await response.json());

  console.log('\nTesting DELETE /api/data (no DELETE permission)...');
  response = await app.handle(
    new Request('http://localhost/api/data', { method: 'DELETE' })
  );
  console.log(`  Status: ${response.status}, Body:`, await response.json());
};

// =============================================================================
// Main
// =============================================================================
const main = async (): Promise<void> => {
  try {
    await basicExample();
    await standaloneExample();
    await guardExample();
    await abacExample();
    await pathMappingExample();
    await customErrorsExample();
    await customFlagMappingExample();
    await directSubjectExample();

    console.log('\n--- All examples completed successfully! ---');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

main();
