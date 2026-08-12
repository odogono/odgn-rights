export class RoleRegistryRevisionError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number
  ) {
    super(
      `Role registry revision changed from ${expectedRevision} to ${actualRevision}`
    );
    this.name = 'RoleRegistryRevisionError';
  }
}
