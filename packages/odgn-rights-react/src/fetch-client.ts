import type {
  PermissionClient,
  PermissionFetchClientOptions,
  PermissionQueryInput,
  PermissionQueryOutput
} from './types';

const resolveHeaders = async (
  headers: PermissionFetchClientOptions['headers']
): Promise<HeadersInit> =>
  typeof headers === 'function' ? await headers() : (headers ?? {});

export const createFetchPermissionClient = ({
  endpoint,
  fetch = globalThis.fetch,
  getAccessToken,
  headers
}: PermissionFetchClientOptions): PermissionClient => ({
  async check(input: PermissionQueryInput): Promise<PermissionQueryOutput> {
    const accessToken =
      typeof getAccessToken === 'function'
        ? await getAccessToken()
        : getAccessToken;
    const requestHeaders = new Headers(await resolveHeaders(headers));

    requestHeaders.set('Accept', 'application/json');
    requestHeaders.set('Content-Type', 'application/json');

    if (accessToken) {
      requestHeaders.set('Authorization', `Bearer ${accessToken}`);
    }

    const response = await fetch(endpoint, {
      body: JSON.stringify(input),
      headers: requestHeaders,
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error(`Permission query failed with status ${response.status}`);
    }

    return (await response.json()) as PermissionQueryOutput;
  }
});
