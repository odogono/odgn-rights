import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { PropsWithChildren } from 'react';

import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient
} from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import {
  PermissionProvider,
  createFetchPermissionClient,
  invalidatePermissions,
  usePermission,
  usePermissions
} from '../index';
import type { PermissionCheck, PermissionClient } from '../types';

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

const createWrapper = (client: PermissionClient, sessionKey = 'session-1') => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });

  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <PermissionProvider client={client} sessionKey={sessionKey}>
        {children}
      </PermissionProvider>
    </QueryClientProvider>
  );

  return { queryClient, wrapper };
};

describe('odgn-rights-react hooks', () => {
  test('returns allowed and denied results for a batch of checks', async () => {
    const checks: PermissionCheck[] = [
      { flags: 'r', path: '/demo/dashboard' },
      { flags: 'w', path: '/demo/dashboard' }
    ];
    const client: PermissionClient = {
      check: async input => ({
        results: input.checks.map(check => ({
          ...check,
          allowed: check.flags === 'r',
          reason: check.flags === 'r' ? 'allowed' : 'denied'
        }))
      })
    };
    const { wrapper } = createWrapper(client);
    const { result } = renderHook(() => usePermissions(checks), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.results).toEqual([
      {
        allowed: true,
        flags: 'r',
        path: '/demo/dashboard',
        reason: 'allowed'
      },
      {
        allowed: false,
        flags: 'w',
        path: '/demo/dashboard',
        reason: 'denied'
      }
    ]);
  });

  test('keeps permission results session-stable until invalidated', async () => {
    let calls = 0;
    const client: PermissionClient = {
      check: async input => {
        calls += 1;
        return {
          results: input.checks.map(check => ({
            ...check,
            allowed: calls > 1,
            reason: calls > 1 ? 'allowed' : 'denied'
          }))
        };
      }
    };
    const { wrapper } = createWrapper(client);

    const { rerender, result } = renderHook(
      () => usePermission({ flags: 'r', path: '/demo/admin' }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.allowed).toBe(false);
    rerender();
    expect(calls).toBe(1);

    const invalidator = renderHook(
      () => {
        const queryClient = useQueryClient();
        return () => invalidatePermissions(queryClient);
      },
      { wrapper }
    );

    await invalidator.result.current();
    await waitFor(() => expect(result.current.allowed).toBe(true));
    expect(calls).toBe(2);
  });
});

describe('createFetchPermissionClient', () => {
  test('posts checks with bearer auth and returns permission results', async () => {
    const requests: Array<{ body: unknown; headers: Headers; url: string }> =
      [];
    const client = createFetchPermissionClient({
      endpoint: '/permissions/authorize/self',
      fetch: async (input, init) => {
        requests.push({
          body: JSON.parse(String(init?.body)),
          headers: new Headers(init?.headers),
          url: String(input)
        });

        return new Response(
          JSON.stringify({
            results: [
              {
                allowed: true,
                flags: 'r',
                path: '/demo/dashboard',
                reason: 'allowed'
              }
            ]
          })
        );
      },
      getAccessToken: () => 'access-token'
    });

    const result = await client.check({
      checks: [{ flags: 'r', path: '/demo/dashboard' }]
    });

    expect(requests[0]).toEqual({
      body: { checks: [{ flags: 'r', path: '/demo/dashboard' }] },
      headers: expect.any(Headers),
      url: '/permissions/authorize/self'
    });
    expect(requests[0]?.headers.get('Authorization')).toBe(
      'Bearer access-token'
    );
    expect(result.results[0]?.allowed).toBe(true);
  });
});
