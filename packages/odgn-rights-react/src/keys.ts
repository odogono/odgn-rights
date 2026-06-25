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

const permissionChecksFingerprint = (
  checks: readonly PermissionCheck[]
): string => {
  const serializedChecks = checks
    .map(
      check =>
        `${check.flags.length}:${check.flags}${check.path.length}:${check.path}`
    )
    .join('|');
  let hash = 0x811c9dc5;

  for (let index = 0; index < serializedChecks.length; index += 1) {
    hash ^= serializedChecks.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
};

export const permissionQueryKey = (
  sessionKey: string,
  checks: readonly PermissionCheck[]
): QueryKey => [
  ...PERMISSIONS_QUERY_KEY,
  sessionKey,
  {
    count: checks.length,
    hash: permissionChecksFingerprint(normalizePermissionChecks(checks))
  }
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
