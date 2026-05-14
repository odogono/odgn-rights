import type { ReactNode } from 'react';

export type PermissionReason = 'allowed' | 'denied' | 'subject_not_found';

export type PermissionCheck = {
  flags: string;
  path: string;
};

export type PermissionResult = PermissionCheck & {
  allowed: boolean;
  reason: PermissionReason;
};

export type PermissionQueryInput = {
  checks: PermissionCheck[];
};

export type PermissionQueryOutput = {
  results: PermissionResult[];
};

export type PermissionClient = {
  check(input: PermissionQueryInput): Promise<PermissionQueryOutput>;
};

export type PermissionProviderProps = {
  children: ReactNode;
  client: PermissionClient;
  enabled?: boolean;
  sessionKey?: string | null;
  staleTime?: number;
};

export type UsePermissionsOptions = {
  enabled?: boolean;
  staleTime?: number;
};

export type PermissionFetchClientOptions = {
  endpoint: string;
  fetch?: typeof globalThis.fetch;
  getAccessToken?: () =>
    | Promise<string | null | undefined>
    | string
    | null
    | undefined;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
};
