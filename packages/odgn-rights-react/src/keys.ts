import type { QueryClient, QueryKey } from '@tanstack/react-query';

import type { PermissionCheck } from './types';

export const PERMISSIONS_QUERY_KEY = ['odgn-rights', 'permissions'] as const;

export const normalizePermissionCheck = (
  check: PermissionCheck
): PermissionCheck => ({
  flags: check.flags.trim().toLowerCase(),
  path: check.path.trim()
});

export const normalizePermissionChecks = (
  checks: readonly PermissionCheck[]
): PermissionCheck[] => checks.map(normalizePermissionCheck);

export const permissionQueryKey = (
  sessionKey: string,
  checks: readonly PermissionCheck[]
): QueryKey => [
  ...PERMISSIONS_QUERY_KEY,
  sessionKey,
  normalizePermissionChecks(checks)
];

export const invalidatePermissions = async (
  queryClient: QueryClient,
  options: { sessionKey?: string | null } = {}
) => {
  const queryKey =
    options.sessionKey === undefined
      ? PERMISSIONS_QUERY_KEY
      : [...PERMISSIONS_QUERY_KEY, options.sessionKey ?? 'anonymous'];

  await queryClient.invalidateQueries({ queryKey });
};
