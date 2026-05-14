import { createContext, useContext } from 'react';

import type { PermissionClient, PermissionProviderProps } from './types';

export const SESSION_STABLE_STALE_TIME = Infinity;

type PermissionContextValue = {
  client: PermissionClient;
  enabled: boolean;
  sessionKey: string;
  staleTime: number;
};

const PermissionContext = createContext<PermissionContextValue | null>(null);

export const PermissionProvider = ({
  children,
  client,
  enabled = true,
  sessionKey,
  staleTime = SESSION_STABLE_STALE_TIME
}: PermissionProviderProps) => (
  <PermissionContext.Provider
    value={{
      client,
      enabled,
      sessionKey: sessionKey ?? 'anonymous',
      staleTime
    }}
  >
    {children}
  </PermissionContext.Provider>
);

export const usePermissionContext = (): PermissionContextValue => {
  const value = useContext(PermissionContext);

  if (!value) {
    throw new Error('Permission hooks must be used within a PermissionProvider');
  }

  return value;
};
