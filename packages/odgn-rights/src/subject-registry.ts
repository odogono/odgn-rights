import type { DatabaseAdapter } from './adapters/types';
import { Flags } from './constants';
import type { ConditionContext } from './right';
import type { RoleRegistry } from './role-registry';
import { Subject, type SubjectJSON } from './subject';

export type SubjectRegistryJSON = {
  [identifier: string]: SubjectJSON;
};

/**
 * In-memory registry for managing Subject instances.
 * Provides an API similar to RoleRegistry for consistency.
 */
export class SubjectRegistry {
  private subjects: Map<string, Subject> = new Map();

  /**
   * Register a subject with an identifier.
   * If a subject with this identifier already exists, it will be replaced.
   */
  register(identifier: string, subject: Subject): void {
    this.subjects.set(identifier, subject);
  }

  /**
   * Get a subject by its identifier.
   */
  get(identifier: string): Subject | undefined {
    return this.subjects.get(identifier);
  }

  /**
   * Check if a subject with the given identifier exists.
   */
  has(identifier: string): boolean {
    return this.subjects.has(identifier);
  }

  /**
   * Delete a subject by its identifier.
   * @returns true if the subject was deleted, false if not found
   */
  delete(identifier: string): boolean {
    return this.subjects.delete(identifier);
  }

  /**
   * Get all registered identifiers.
   */
  identifiers(): string[] {
    return Array.from(this.subjects.keys());
  }

  /**
   * Get the number of registered subjects.
   */
  get size(): number {
    return this.subjects.size;
  }

  /**
   * Clear all registered subjects.
   */
  clear(): void {
    this.subjects.clear();
  }

  /**
   * Iterate over all subjects.
   */
  entries(): IterableIterator<[string, Subject]> {
    return this.subjects.entries();
  }

  /**
   * Find all subject identifiers that have access to a specific path with given flags.
   * @param pathPattern The path pattern to check (supports wildcards)
   * @param flags The flags to check for
   * @param context Optional condition context for ABAC-style checks
   * @returns Array of subject identifiers that have access
   */
  findSubjectsWithAccess(
    pathPattern: string,
    flags: Flags,
    context?: ConditionContext
  ): string[] {
    const matching: string[] = [];
    for (const [identifier, subject] of this.subjects) {
      if (subject.has(pathPattern, flags, context)) {
        matching.push(identifier);
      }
    }
    return matching;
  }

  /**
   * Serialize the registry to JSON.
   */
  toJSON(): SubjectRegistryJSON {
    const result: SubjectRegistryJSON = {};
    for (const [identifier, subject] of this.subjects) {
      result[identifier] = subject.toJSON();
    }
    return result;
  }

  /**
   * Create a SubjectRegistry from JSON data.
   * @param data The serialized registry data
   * @param roleRegistry Optional RoleRegistry for resolving role references
   */
  static fromJSON(
    data: SubjectRegistryJSON,
    roleRegistry?: RoleRegistry
  ): SubjectRegistry {
    const registry = new SubjectRegistry();
    for (const [identifier, subjectData] of Object.entries(data)) {
      const subject = Subject.fromJSON(subjectData, roleRegistry);
      registry.register(identifier, subject);
    }
    return registry;
  }

  /**
   * Save all subjects to a database adapter.
   */
  async saveTo(adapter: DatabaseAdapter): Promise<void> {
    for (const [identifier, subject] of this.subjects) {
      await adapter.saveSubject(identifier, subject);
    }
  }

  /**
   * Load the given subjects from a database adapter.
   * The role registry is loaded once and reused across every subject so that
   * loading N subjects does not re-hydrate the registry N times.
   */
  static async loadFrom(
    adapter: DatabaseAdapter,
    identifiers: string[]
  ): Promise<SubjectRegistry> {
    const registry = new SubjectRegistry();
    const roleRegistry = await adapter.loadRegistry();
    for (const id of identifiers) {
      const subject = await adapter.loadSubject(id, roleRegistry);
      if (subject) {
        registry.register(id, subject);
      }
    }
    return registry;
  }
}
