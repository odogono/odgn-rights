import { useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';

import {
  normalizePermissionCheck,
  normalizePermissionChecks,
  PERMISSIONS_QUERY_KEY
} from './keys';
import { usePermissionContext } from './provider';
import type {
  PermissionCheck,
  PermissionResult,
  UsePermissionsOptions
} from './types';

export const usePermissions = (
  checks: readonly PermissionCheck[],
  options: UsePermissionsOptions = {}
) => {
  const context = usePermissionContext();
  const normalizedChecks = useMemo(
    () => normalizePermissionChecks(checks),
    [checks]
  );
  const enabled =
    context.enabled && (options.enabled ?? true) && normalizedChecks.length > 0;

  return useQuery({
    enabled,
    queryFn: () => context.client.check({ checks: normalizedChecks }),
    queryKey: [...PERMISSIONS_QUERY_KEY, context.sessionKey, normalizedChecks],
    staleTime: options.staleTime ?? context.staleTime
  });
};

export const usePermission = (
  check: PermissionCheck,
  options: UsePermissionsOptions = {}
) => {
  const normalizedCheck = useMemo(
    () => normalizePermissionCheck(check),
    [check]
  );
  const normalizedChecks = useMemo(() => [normalizedCheck], [normalizedCheck]);
  const query = usePermissions(normalizedChecks, options);
  const result = query.data?.results[0] as PermissionResult | undefined;

  return {
    ...query,
    allowed: result?.allowed ?? false,
    result
  };
};
