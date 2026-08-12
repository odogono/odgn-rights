import { Flags, hasBit } from '../constants';
import { Right, type RightInit } from '../right';
import { Rights } from '../rights';
import { Role } from '../role';
import { RoleRegistry } from '../role-registry';
import { Subject } from '../subject';
import { RoleRegistryRevisionError } from './errors';
import { DEFAULT_TABLE_PREFIX, createTableNames } from './schema';
import type {
  BaseAdapterOptions,
  DatabaseAdapter,
  PaginatedResult,
  PaginationOptions,
  RegistryCommitResult,
  RevisionedRoleSummaries,
  RightsRow,
  RoleRegistrySnapshot,
  RoleSummaryQuery,
  SubjectWithIdentifier,
  TableNames
} from './types';

/**
 * Abstract base class for database adapters.
 * Provides common utility methods for serialization/deserialization
 * and table name management.
 */
export abstract class BaseAdapter implements DatabaseAdapter {
  protected readonly tablePrefix: string;
  protected readonly _tables: TableNames;

  constructor(options: BaseAdapterOptions = {}) {
    this.tablePrefix = options.tablePrefix ?? DEFAULT_TABLE_PREFIX;
    this._tables = createTableNames(this.tablePrefix);
  }

  /**
   * Get the table names with the configured prefix
   */
  protected get tables(): TableNames {
    return this._tables;
  }

  // ===========================================================================
  // Serialization Utilities
  // ===========================================================================

  /**
   * Serialize tags array to JSON string
   */
  protected serializeTags = (tags: string[]): string | null => {
    if (tags.length === 0) {
      return null;
    }
    return JSON.stringify(tags.sort());
  };

  /**
   * Deserialize JSON string to tags array
   */
  protected deserializeTags = (json: string | null): string[] => {
    if (!json) {
      return [];
    }
    try {
      return JSON.parse(json) as string[];
    } catch {
      return [];
    }
  };

  /**
   * Convert a Right instance to a database row (partial, without id and timestamps)
   */
  protected rightToRow = (
    right: Right
  ): Omit<RightsRow, 'id' | 'created_at' | 'updated_at'> => ({
    allow_mask: right.allowMaskValue,
    deny_mask: right.denyMaskValue,
    description: right.description ?? null,
    path: right.path,
    priority: right.priority,
    tags: this.serializeTags(right.tags),
    valid_from: right.validFrom?.toISOString() ?? null,
    valid_until: right.validUntil?.toISOString() ?? null
  });

  /**
   * Convert a database row to a Right instance
   */
  protected rowToRight = (row: RightsRow): Right => {
    const init: RightInit = {
      allow: this.maskToFlags(row.allow_mask),
      deny: this.maskToFlags(row.deny_mask),
      description: row.description ?? undefined,
      priority: row.priority,
      tags: this.deserializeTags(row.tags),
      validFrom: row.valid_from ? new Date(row.valid_from) : undefined,
      validUntil: row.valid_until ? new Date(row.valid_until) : undefined
    };

    const right = new Right(row.path, init);
    right._setDbId(row.id);
    return right;
  };

  /**
   * Convert a bitmask to an array of Flag values
   */
  protected maskToFlags = (mask: number): Flags[] => {
    const flags: Flags[] = [];
    if (hasBit(mask, Flags.READ)) {
      flags.push(Flags.READ);
    }
    if (hasBit(mask, Flags.WRITE)) {
      flags.push(Flags.WRITE);
    }
    if (hasBit(mask, Flags.CREATE)) {
      flags.push(Flags.CREATE);
    }
    if (hasBit(mask, Flags.DELETE)) {
      flags.push(Flags.DELETE);
    }
    if (hasBit(mask, Flags.EXECUTE)) {
      flags.push(Flags.EXECUTE);
    }
    return flags;
  };

  /**
   * Convert an array of Flag values to a bitmask
   */
  protected flagsToMask = (flags: Flags[]): number => {
    let mask = 0;
    for (const f of flags) {
      mask |= f;
    }
    return mask;
  };

  /**
   * Parse an ISO 8601 timestamp string to a Date, or undefined if null/invalid
   */
  protected parseTimestamp = (value: string | null): Date | undefined => {
    if (!value) {
      return undefined;
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      return undefined;
    }
    return d;
  };

  // ===========================================================================
  // Abstract Methods - Must be implemented by subclasses
  // ===========================================================================

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract migrate(): Promise<void>;

  abstract saveRight(right: Right): Promise<number>;
  abstract saveRights(rights: Rights): Promise<number[]>;
  abstract loadRight(id: number): Promise<Right | null>;
  abstract loadRights(): Promise<Rights>;
  abstract loadRightsByPath(pathPattern: string): Promise<Rights>;
  abstract deleteRight(id: number): Promise<boolean>;

  abstract saveRole(role: Role): Promise<number>;
  abstract loadRoles(): Promise<Role[]>;
  abstract loadRoleSummaries(
    query?: RoleSummaryQuery
  ): Promise<RevisionedRoleSummaries>;
  abstract deleteRole(name: string): Promise<boolean>;

  abstract saveRegistry(registry: RoleRegistry): Promise<void>;
  abstract loadRegistry(): Promise<RoleRegistry>;
  abstract loadRegistrySnapshot(): Promise<RoleRegistrySnapshot>;
  abstract saveRegistryIfRevision(
    registry: RoleRegistry,
    expectedRevision: number
  ): Promise<RegistryCommitResult>;

  /**
   * Every role a whole-registry save persists: the registry's own roles plus
   * the transitive closure of their parents, which may include roles that were
   * attached with inheritsFrom() but never define()d on the registry.
   *
   * Both saveRegistry() and saveRegistryIfRevision() must agree on this set —
   * if the conditional commit derived its keep-list from registry.getAll()
   * alone, it would delete an unregistered parent that the save then re-creates
   * with a fresh created_at, silently reordering summary results.
   */
  protected collectPersistedRoles(registry: RoleRegistry): Map<string, Role> {
    const collected = new Map<string, Role>();

    const collect = (role: Role) => {
      if (collected.has(role.name)) {
        return;
      }
      collected.set(role.name, role);
      for (const parent of role.parents) {
        collect(parent);
      }
    };

    for (const role of registry.getAll()) {
      collect(role);
    }

    return collected;
  }

  /**
   * Hydrate the named roles, with direct rights and inheritance resolved,
   * returning them in the order requested. Names absent from the registry are
   * skipped rather than erroring.
   *
   * Routes through loadRegistrySnapshot() so every returned role comes from a
   * single revision. Pass `revision` to assert that revision is still current;
   * a mismatch throws RoleRegistryRevisionError instead of returning roles the
   * caller would wrongly believe were consistent with an earlier read.
   */
  async loadRolesByName(names: string[], revision?: number): Promise<Role[]> {
    const snapshot = await this.loadRegistrySnapshot();
    if (revision !== undefined && snapshot.revision !== revision) {
      throw new RoleRegistryRevisionError(revision, snapshot.revision);
    }
    return names.flatMap(name => {
      const role = snapshot.registry.get(name);
      return role ? [role] : [];
    });
  }

  /**
   * Load a single role with its full inheritance chain resolved.
   * Routes through loadRegistry() so inherited rights are included.
   * Pass a pre-built registry to avoid reloading it on repeated calls.
   */
  async loadRole(name: string, registry?: RoleRegistry): Promise<Role | null> {
    const reg = registry ?? (await this.loadRegistry());
    return reg.get(name) ?? null;
  }

  /**
   * Attach the named roles to a subject, resolving each through the registry so
   * inherited rights are included. Roles missing from the registry are skipped.
   * Shared by every subject-hydration path so the inheritance-aware lookup lives
   * in one place.
   */
  protected applyRolesToSubject(
    subject: Subject,
    roleNames: Iterable<string>,
    registry: RoleRegistry
  ): void {
    for (const roleName of roleNames) {
      const role = registry.get(roleName);
      if (role) {
        subject.memberOf(role);
      }
    }
  }

  abstract saveSubject(identifier: string, subject: Subject): Promise<number>;
  abstract loadSubject(
    identifier: string,
    registry?: RoleRegistry
  ): Promise<Subject | null>;
  abstract deleteSubject(identifier: string): Promise<boolean>;

  /**
   * Load all subjects with their identifiers using optimized batch loading.
   * Subclasses should implement this with batch JOINs to avoid N+1 queries.
   */
  abstract loadSubjects(): Promise<SubjectWithIdentifier[]>;

  /**
   * Load subjects with pagination using optimized batch loading.
   * Subclasses should implement this with batch JOINs to avoid N+1 queries.
   * @param options Pagination options (page number and page size)
   * @returns Paginated result with subjects and total count
   */
  abstract loadSubjectsPaginated(
    options: PaginationOptions
  ): Promise<PaginatedResult<SubjectWithIdentifier>>;

  /**
   * Find all subject identifiers that have access to a specific path with given flags.
   * Uses the batch-loading loadSubjects() path so subjects are fully hydrated
   * (including inherited role rights) before the access check.
   * @param pathPattern The path pattern to check (supports wildcards)
   * @param flags The flags to check for
   * @returns Array of subject identifiers that have access
   */
  async findSubjectsWithAccess(
    pathPattern: string,
    flags: Flags
  ): Promise<string[]> {
    const subjects = await this.loadSubjects();
    return subjects
      .filter(({ subject }) => subject.has(pathPattern, flags))
      .map(({ identifier }) => identifier);
  }

  abstract clear(): Promise<void>;
  abstract transaction<T>(
    fn: (adapter: DatabaseAdapter) => Promise<T>
  ): Promise<T>;
}
