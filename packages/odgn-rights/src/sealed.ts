/**
 * Thrown when code changes a sealed registry, role, rights collection or
 * right. A registry is sealed when it is shared, for example by a cache, so a
 * change there would silently reach every reader of it.
 */
export class SealedError extends Error {
  constructor(target: string) {
    super(`${target} is sealed and cannot be changed`);
    this.name = 'SealedError';
  }
}
