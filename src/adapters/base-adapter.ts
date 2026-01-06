import { Flags, hasBit } from '../constants';
import { Right, type RightInit } from '../right';
import { Rights } from '../rights';
import { Role } from '../role';
import { RoleRegistry } from '../role-registry';
import { Subject } from '../subject';
import { DEFAULT_TABLE_PREFIX, createTableNames } from './schema';
import type {
  BaseAdapterOptions,
  DatabaseAdapter,
  RightsRow,
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

    return new Right(row.path, init);
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
  abstract loadRole(name: string): Promise<Role | null>;
  abstract loadRoles(): Promise<Role[]>;
  abstract deleteRole(name: string): Promise<boolean>;

  abstract saveRegistry(registry: RoleRegistry): Promise<void>;
  abstract loadRegistry(): Promise<RoleRegistry>;

  abstract saveSubject(identifier: string, subject: Subject): Promise<number>;
  abstract loadSubject(identifier: string): Promise<Subject | null>;
  abstract deleteSubject(identifier: string): Promise<boolean>;

  /**
   * Get all subject identifiers from the database.
   * Used by findSubjectsWithAccess and can be overridden for optimization.
   */
  protected abstract getAllSubjectIdentifiers(): Promise<string[]>;

  /**
   * Find all subject identifiers that have access to a specific path with given flags.
   * Default implementation uses getAllSubjectIdentifiers + loadSubject.
   * Subclasses can override with optimized batch loading implementations.
   * @param pathPattern The path pattern to check (supports wildcards)
   * @param flags The flags to check for
   * @returns Array of subject identifiers that have access
   */
  async findSubjectsWithAccess(
    pathPattern: string,
    flags: Flags
  ): Promise<string[]> {
    const allIdentifiers = await this.getAllSubjectIdentifiers();
    const matchingSubjects: string[] = [];

    for (const identifier of allIdentifiers) {
      const subject = await this.loadSubject(identifier);
      if (subject?.has(pathPattern, flags)) {
        matchingSubjects.push(identifier);
      }
    }

    return matchingSubjects;
  }

  abstract clear(): Promise<void>;
  abstract transaction<T>(
    fn: (adapter: DatabaseAdapter) => Promise<T>
  ): Promise<T>;
}
