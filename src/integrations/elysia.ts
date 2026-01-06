/**
 * ElysiaJS integration for odgn-rights
 *
 * @module odgn-rights/integrations/elysia
 *
 * This module provides middleware and utilities for integrating
 * odgn-rights with ElysiaJS applications.
 *
 * @example
 * ```typescript
 * import { Elysia } from 'elysia';
 * import { elysiaRights } from 'odgn-rights/integrations/elysia';
 *
 * const app = new Elysia()
 *   .use(elysiaRights({
 *     registry: subjectRegistry,
 *     getSubject: ({ headers }) => headers.get('x-user-id')
 *   }))
 *   .get('/users', () => 'list users')
 *   .listen(3000);
 * ```
 */

import type { Flags } from '../constants';
import type { ConditionContext } from '../right';
import type { Rights } from '../rights';
import type { Subject } from '../subject';
import type { SubjectRegistry } from '../subject-registry';

/**
 * Configuration options for the Elysia rights middleware
 */
export type ElysiaRightsOptions<Store = unknown, Derive = unknown> = {
  /**
   * Function to determine the required flags based on the request.
   * Defaults to mapping HTTP methods to flags:
   * - GET, HEAD, OPTIONS -> READ
   * - POST -> CREATE
   * - PUT, PATCH -> WRITE
   * - DELETE -> DELETE
   */
  flagMapper?: (ctx: {
    method: string;
    path: string;
    request: Request;
  }) => Flags;

  /**
   * Function to build the condition context for ABAC-style checks.
   * The returned context is passed to the permission check.
   */
  getContext?: (
    ctx: {
      headers: Headers;
      path: string;
      request: Request;
      store: Store;
      subject: Subject;
    } & Derive
  ) => ConditionContext | Promise<ConditionContext>;

  /**
   * Function to extract the subject or subject identifier from the request context.
   * If registry is provided, this should return a string identifier.
   * Otherwise, it should return a Subject instance directly.
   */
  getSubject: (
    ctx: {
      headers: Headers;
      path: string;
      request: Request;
      store: Store;
    } & Derive
  ) =>
    | string
    | Subject
    | undefined
    | null
    | Promise<string | Subject | undefined | null>;

  /**
   * Custom handler when no subject is found.
   * Defaults to returning 401 status.
   */
  onNoSubject?: (ctx: {
    path: string;
    request: Request;
  }) => Response | Promise<Response>;

  /**
   * Custom handler for unauthorized responses.
   * Defaults to returning 403 status.
   */
  onUnauthorized?: (ctx: {
    path: string;
    request: Request;
    requiredFlags: Flags;
    subject?: Subject;
  }) => Response | Promise<Response>;

  /**
   * Function to map the request path to a rights path.
   * Useful for stripping prefixes or transforming paths.
   * Defaults to using the request path as-is.
   */
  pathMapper?: (ctx: {
    method: string;
    path: string;
    request: Request;
  }) => string;

  /**
   * The SubjectRegistry to look up subjects from.
   * If provided, getSubject should return the subject identifier.
   */
  registry?: SubjectRegistry;
};

/**
 * Options for standalone rights-based checks (without subjects)
 */
export type ElysiaRightsStandaloneOptions<
  Store = unknown,
  Derive = unknown
> = Omit<ElysiaRightsOptions<Store, Derive>, 'registry' | 'getSubject'> & {
  /**
   * A Rights instance to check against directly.
   * Use this when you don't need subject/role-based access control.
   */
  rights: Rights;
};

/**
 * HTTP method to Flags mapping
 */
const DEFAULT_METHOD_FLAG_MAP: Record<string, Flags> = {
  DELETE: 4 as Flags, // DELETE
  GET: 1 as Flags, // READ
  HEAD: 1 as Flags,
  OPTIONS: 1 as Flags,
  PATCH: 2 as Flags,
  POST: 8 as Flags, // CREATE
  PUT: 2 as Flags // WRITE
};

type ElysiaContext = {
  [key: string]: unknown;
  path: string;
  request: Request;
  set: { status?: number | string };
};

/**
 * Create an Elysia plugin for rights-based authorization.
 *
 * @example Using with SubjectRegistry
 * ```typescript
 * import { Elysia } from 'elysia';
 * import { elysiaRights } from 'odgn-rights/integrations/elysia';
 *
 * const app = new Elysia()
 *   .use(elysiaRights({
 *     registry: subjectRegistry,
 *     getSubject: ({ headers }) => headers.get('x-user-id')
 *   }))
 *   .get('/users', () => 'list users')
 *   .listen(3000);
 * ```
 *
 * @example Using with direct Subject
 * ```typescript
 * const app = new Elysia()
 *   .derive(({ headers }) => ({
 *     user: getUserFromToken(headers.get('authorization'))
 *   }))
 *   .use(elysiaRights({
 *     getSubject: ({ user }) => user?.subject
 *   }))
 *   .get('/users', () => 'list users')
 *   .listen(3000);
 * ```
 */
export const elysiaRights = <Store = unknown, Derive = unknown>(
  options: ElysiaRightsOptions<Store, Derive>
) => {
  // Dynamic import to avoid requiring elysia as a hard dependency
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Elysia } = require('elysia');

  const {
    flagMapper,
    getContext,
    getSubject,
    onNoSubject,
    onUnauthorized,
    pathMapper,
    registry
  } = options;

  return new Elysia({ name: 'odgn-rights' }).onBeforeHandle(
    { as: 'scoped' },
    async ({ path, request, set, ...rest }: ElysiaContext) => {
      const method = request.method;

      // Get the subject
      const subjectOrId = await getSubject({
        headers: request.headers,
        path,
        request,
        ...rest
      } as Parameters<typeof getSubject>[0]);

      let subject: Subject | undefined;

      if (subjectOrId === null || subjectOrId === undefined) {
        if (onNoSubject) {
          return onNoSubject({ path, request });
        }
        set.status = 401;
        return { error: 'Unauthorized', message: 'No subject found' };
      }

      if (typeof subjectOrId === 'string') {
        if (!registry) {
          throw new Error(
            'elysiaRights: registry is required when getSubject returns a string identifier'
          );
        }
        subject = registry.get(subjectOrId);
        if (!subject) {
          if (onNoSubject) {
            return onNoSubject({ path, request });
          }
          set.status = 401;
          return { error: 'Unauthorized', message: 'Subject not found' };
        }
      } else {
        subject = subjectOrId;
      }

      // Map the path
      const rightsPath = pathMapper
        ? pathMapper({ method, path, request })
        : path;

      // Get the required flags
      const requiredFlags = flagMapper
        ? flagMapper({ method, path, request })
        : (DEFAULT_METHOD_FLAG_MAP[method] ?? (1 as Flags)); // Default to READ

      // Get condition context if provided
      const context = getContext
        ? await getContext({
            headers: request.headers,
            path,
            request,
            subject,
            ...rest
          } as Parameters<NonNullable<typeof getContext>>[0])
        : undefined;

      // Check permission
      const allowed = subject.has(rightsPath, requiredFlags, context);

      if (!allowed) {
        if (onUnauthorized) {
          return onUnauthorized({
            path: rightsPath,
            request,
            requiredFlags,
            subject
          });
        }
        set.status = 403;
        return { error: 'Forbidden', message: 'Access denied' };
      }

      // Permission granted, continue to handler
    }
  );
};

/**
 * Create an Elysia plugin for rights-based authorization using a Rights instance directly.
 * Use this when you don't need subject/role-based access control.
 *
 * @example
 * ```typescript
 * import { Elysia } from 'elysia';
 * import { elysiaRightsStandalone } from 'odgn-rights/integrations/elysia';
 * import { Rights, Flags } from 'odgn-rights';
 *
 * const rights = new Rights();
 * rights.allow('/api/**', Flags.READ);
 * rights.allow('/api/admin/**', Flags.ALL);
 *
 * const app = new Elysia()
 *   .use(elysiaRightsStandalone({ rights }))
 *   .get('/api/users', () => 'list users')
 *   .listen(3000);
 * ```
 */
export const elysiaRightsStandalone = <Store = unknown, Derive = unknown>(
  options: ElysiaRightsStandaloneOptions<Store, Derive>
) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Elysia } = require('elysia');

  const { flagMapper, getContext, onUnauthorized, pathMapper, rights } =
    options;

  return new Elysia({ name: 'odgn-rights-standalone' }).onBeforeHandle(
    { as: 'scoped' },
    async ({ path, request, set, ...rest }: ElysiaContext) => {
      const method = request.method;

      // Map the path
      const rightsPath = pathMapper
        ? pathMapper({ method, path, request })
        : path;

      // Get the required flags
      const requiredFlags = flagMapper
        ? flagMapper({ method, path, request })
        : (DEFAULT_METHOD_FLAG_MAP[method] ?? (1 as Flags));

      // Get condition context if provided
      const context = getContext
        ? await getContext({
            headers: request.headers,
            path,
            request,
            subject: undefined as never,
            ...rest
          } as Parameters<NonNullable<typeof getContext>>[0])
        : undefined;

      // Check permission
      const allowed = rights.has(rightsPath, requiredFlags, context);

      if (!allowed) {
        if (onUnauthorized) {
          return onUnauthorized({
            path: rightsPath,
            request,
            requiredFlags,
            subject: undefined
          });
        }
        set.status = 403;
        return { error: 'Forbidden', message: 'Access denied' };
      }
    }
  );
};

/**
 * Type for beforeHandle guard configuration
 */
export type RightsGuardConfig = {
  beforeHandle: (ctx: ElysiaContext) => Promise<Response | object | void>;
};

/**
 * Create a guard configuration for use with Elysia's .guard() method.
 * This allows more fine-grained control over which routes are protected.
 *
 * @example
 * ```typescript
 * import { Elysia } from 'elysia';
 * import { createRightsGuard } from 'odgn-rights/integrations/elysia';
 *
 * const guard = createRightsGuard({
 *   registry: subjectRegistry,
 *   getSubject: ({ headers }) => headers.get('x-user-id')
 * });
 *
 * const app = new Elysia()
 *   .get('/public', () => 'anyone can see this')
 *   .guard(guard, (app) =>
 *     app
 *       .get('/protected', () => 'only authorized users')
 *       .post('/protected', () => 'create something')
 *   )
 *   .listen(3000);
 * ```
 */
export const createRightsGuard = <Store = unknown, Derive = unknown>(
  options: ElysiaRightsOptions<Store, Derive>
) => {
  const {
    flagMapper,
    getContext,
    getSubject,
    onNoSubject,
    onUnauthorized,
    pathMapper,
    registry
  } = options;

  return {
    async beforeHandle({ path, request, set, ...rest }: ElysiaContext) {
      const method = request.method;

      const subjectOrId = await getSubject({
        headers: request.headers,
        path,
        request,
        ...rest
      } as Parameters<typeof getSubject>[0]);

      let subject: Subject | undefined;

      if (subjectOrId === null || subjectOrId === undefined) {
        if (onNoSubject) {
          return onNoSubject({ path, request });
        }
        set.status = 401;
        return { error: 'Unauthorized', message: 'No subject found' };
      }

      if (typeof subjectOrId === 'string') {
        if (!registry) {
          throw new Error(
            'createRightsGuard: registry is required when getSubject returns a string identifier'
          );
        }
        subject = registry.get(subjectOrId);
        if (!subject) {
          if (onNoSubject) {
            return onNoSubject({ path, request });
          }
          set.status = 401;
          return { error: 'Unauthorized', message: 'Subject not found' };
        }
      } else {
        subject = subjectOrId;
      }

      const rightsPath = pathMapper
        ? pathMapper({ method, path, request })
        : path;

      const requiredFlags = flagMapper
        ? flagMapper({ method, path, request })
        : (DEFAULT_METHOD_FLAG_MAP[method] ?? (1 as Flags));

      const context = getContext
        ? await getContext({
            headers: request.headers,
            path,
            request,
            subject,
            ...rest
          } as Parameters<NonNullable<typeof getContext>>[0])
        : undefined;

      const allowed = subject.has(rightsPath, requiredFlags, context);

      if (!allowed) {
        if (onUnauthorized) {
          return onUnauthorized({
            path: rightsPath,
            request,
            requiredFlags,
            subject
          });
        }
        set.status = 403;
        return { error: 'Forbidden', message: 'Access denied' };
      }
    }
  };
};

/**
 * Create a macro for declarative per-route authorization.
 * This allows you to specify rights requirements directly on route definitions.
 *
 * @example
 * ```typescript
 * import { Elysia } from 'elysia';
 * import { createRightsMacro } from 'odgn-rights/integrations/elysia';
 * import { Flags } from 'odgn-rights';
 *
 * const rightsMacro = createRightsMacro({
 *   registry: subjectRegistry,
 *   getSubject: ({ headers }) => headers.get('x-user-id')
 * });
 *
 * const app = new Elysia()
 *   .use(rightsMacro)
 *   .get('/public', () => 'anyone')
 *   .get('/users', () => 'list users', {
 *     rights: { path: '/users', flags: Flags.READ }
 *   })
 *   .delete('/users/:id', () => 'delete user', {
 *     rights: { path: '/users/*', flags: Flags.DELETE }
 *   })
 *   .listen(3000);
 * ```
 */
export const createRightsMacro = <Store = unknown, Derive = unknown>(
  options: ElysiaRightsOptions<Store, Derive>
) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Elysia } = require('elysia');

  const { getContext, getSubject, onNoSubject, onUnauthorized, registry } =
    options;

  return new Elysia({ name: 'odgn-rights-macro' }).macro({
    rights: (rightsConfig: { flags: Flags; path: string }) => ({
      async resolve({
        path,
        request,
        set,
        status,
        ...rest
      }: ElysiaContext & { status: (code: number) => void }) {
        const subjectOrId = await getSubject({
          headers: request.headers,
          path,
          request,
          ...rest
        } as Parameters<typeof getSubject>[0]);

        let subject: Subject | undefined;

        if (subjectOrId === null || subjectOrId === undefined) {
          if (onNoSubject) {
            return onNoSubject({ path, request });
          }
          return status(401);
        }

        if (typeof subjectOrId === 'string') {
          if (!registry) {
            throw new Error(
              'createRightsMacro: registry is required when getSubject returns a string identifier'
            );
          }
          subject = registry.get(subjectOrId);
          if (!subject) {
            if (onNoSubject) {
              return onNoSubject({ path, request });
            }
            return status(401);
          }
        } else {
          subject = subjectOrId;
        }

        const context = getContext
          ? await getContext({
              headers: request.headers,
              path,
              request,
              subject,
              ...rest
            } as Parameters<NonNullable<typeof getContext>>[0])
          : undefined;

        const allowed = subject.has(
          rightsConfig.path,
          rightsConfig.flags,
          context
        );

        if (!allowed) {
          if (onUnauthorized) {
            return onUnauthorized({
              path: rightsConfig.path,
              request,
              requiredFlags: rightsConfig.flags,
              subject
            });
          }
          return status(403);
        }

        return { subject };
      }
    })
  });
};
