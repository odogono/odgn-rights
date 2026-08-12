import Redis from 'ioredis';

import { Right } from '../right';
import { Rights } from '../rights';
import { Role } from '../role';
import { RoleRegistry } from '../role-registry';
import { Subject } from '../subject';
import { BaseAdapter } from './base-adapter';
import type {
  BaseAdapterOptions,
  DatabaseAdapter,
  PaginatedResult,
  PaginationOptions,
  RegistryCommitResult,
  RevisionedRoleSummaries,
  RightsRow,
  RoleRegistrySnapshot,
  RoleSummary,
  RoleSummaryQuery,
  SubjectWithIdentifier
} from './types';

export type RedisAdapterOptions = BaseAdapterOptions & {
  db?: number;
  host?: string;
  keyPrefix?: string;
  lazyConnect?: boolean;
  password?: string;
  port?: number;
  tls?: object;
  url?: string;
};

/**
 * Redis key structure:
 *
 * Rights:
 *   {prefix}rights:{id}           → Hash { path, allow_mask, deny_mask, description, tags, valid_from, valid_until, created_at, updated_at }
 *   {prefix}rights:_seq           → String (auto-increment counter)
 *   {prefix}rights:_all           → Set of all right IDs
 *   {prefix}rights:_unique:{hash} → String (right ID for unique constraint lookup)
 *
 * Roles:
 *   {prefix}roles:{name}          → Hash { name, created_at, updated_at }
 *   {prefix}roles:_all            → Set of all role names
 *   {prefix}roles:{name}:rights   → Set of right IDs
 *   {prefix}roles:{name}:parents  → Set of parent role names
 *
 * Subjects:
 *   {prefix}subjects:{identifier}         → Hash { identifier, id, created_at, updated_at }
 *   {prefix}subjects:_all                 → Set of all subject identifiers
 *   {prefix}subjects:_seq                 → String (auto-increment counter for subject IDs)
 *   {prefix}subjects:{identifier}:roles   → Set of role names
 *   {prefix}subjects:{identifier}:rights  → Set of right IDs
 */
export class RedisAdapter extends BaseAdapter {
  private redis: Redis | null = null;
  private readonly options: RedisAdapterOptions;
  private transactionDepth = 0;

  constructor(options: RedisAdapterOptions = {}) {
    super(options);
    this.options = options;
  }

  // ===========================================================================
  // Key Helpers
  // ===========================================================================

  /**
   * Generate a Redis key with the configured prefix
   */
  private key(...parts: string[]): string {
    const prefix = this.options.keyPrefix ?? this.tablePrefix;
    return `${prefix}${parts.join(':')}`;
  }

  /**
   * Generate a unique hash for a right's unique constraint fields
   */
  private rightUniqueHash(right: Right): string {
    const parts = [
      right.path,
      right.allowMaskValue.toString(),
      right.denyMaskValue.toString(),
      right.priority.toString(),
      right.validFrom?.toISOString() ?? 'null',
      right.validUntil?.toISOString() ?? 'null'
    ];
    return parts.join('|');
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async connect(): Promise<void> {
    this.redis = this.options.url
      ? new Redis(this.options.url, {
          lazyConnect: this.options.lazyConnect ?? true
        })
      : new Redis({
          db: this.options.db ?? 0,
          host: this.options.host ?? 'localhost',
          lazyConnect: this.options.lazyConnect ?? true,
          password: this.options.password,
          port: this.options.port ?? 6379,
          tls: this.options.tls
        });

    await this.redis.connect();
  }

  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }

  async migrate(): Promise<void> {
    // Redis is schemaless, so migration is a no-op
    // Just verify we're connected
    if (!this.redis) {
      throw new Error('Not connected');
    }
    await this.redis.ping();
    await this.redis.setnx(this.key('roles', '_revision'), '0');
  }

  // ===========================================================================
  // Rights Operations
  // ===========================================================================

  async saveRight(right: Right): Promise<number> {
    if (!this.redis) {
      throw new Error('Not connected');
    }

    const uniqueHash = this.rightUniqueHash(right);
    const uniqueKey = this.key('rights', '_unique', uniqueHash);

    // Check for existing right with same unique constraint
    const existingId = await this.redis.get(uniqueKey);
    if (existingId) {
      const id = Number.parseInt(existingId, 10);
      // Update the updated_at timestamp
      await this.redis.hset(
        this.key('rights', existingId),
        'updated_at',
        new Date().toISOString()
      );
      right._setDbId(id);
      return id;
    }

    // Generate new ID
    const id = await this.redis.incr(this.key('rights', '_seq'));
    const now = new Date().toISOString();

    const row = this.rightToRow(right);
    const hashData: Record<string, string> = {
      allow_mask: row.allow_mask.toString(),
      created_at: now,
      deny_mask: row.deny_mask.toString(),
      description: row.description ?? '',
      id: id.toString(),
      path: row.path,
      priority: row.priority.toString(),
      tags: row.tags ?? '',
      updated_at: now,
      valid_from: row.valid_from ?? '',
      valid_until: row.valid_until ?? ''
    };

    const rightKey = this.key('rights', id.toString());

    // Use pipeline for atomic operation
    const pipeline = this.redis.multi();
    pipeline.hset(rightKey, hashData);
    pipeline.sadd(this.key('rights', '_all'), id.toString());
    pipeline.set(uniqueKey, id.toString());
    await pipeline.exec();

    right._setDbId(id);
    return id;
  }

  async saveRights(rights: Rights): Promise<number[]> {
    const ids: number[] = [];

    await this.transaction(async () => {
      for (const right of rights.allRights()) {
        const id = await this.saveRight(right);
        ids.push(id);
      }
    });

    return ids;
  }

  async loadRight(id: number): Promise<Right | null> {
    if (!this.redis) {
      throw new Error('Not connected');
    }

    const rightKey = this.key('rights', id.toString());
    const data = await this.redis.hgetall(rightKey);

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    const row = this.hashToRightsRow(data);
    return this.rowToRight(row);
  }

  async loadRights(): Promise<Rights> {
    if (!this.redis) {
      throw new Error('Not connected');
    }

    const allIds = await this.redis.smembers(this.key('rights', '_all'));
    const loadedRights = new Rights();

    for (const idStr of allIds) {
      const right = await this.loadRight(Number.parseInt(idStr, 10));
      if (right) {
        loadedRights.add(right);
      }
    }

    return loadedRights;
  }

  async loadRightsByPath(pathPattern: string): Promise<Rights> {
    if (!this.redis) {
      throw new Error('Not connected');
    }

    // Convert glob pattern to regex for filtering
    // * → .* and ? → .
    const regexPattern = pathPattern
      .replaceAll(/[$()+.[\\\]^{|}]/g, String.raw`\$&`) // Escape regex special chars except * and ?
      .replaceAll('*', '.*')
      .replaceAll('?', '.');

    const regex = new RegExp(`^${regexPattern}$`);

    const allRights = await this.loadRights();
    const matchedRights = new Rights();

    for (const right of allRights.allRights()) {
      if (regex.test(right.path)) {
        matchedRights.add(right);
      }
    }

    return matchedRights;
  }

  async deleteRight(id: number): Promise<boolean> {
    if (!this.redis) {
      throw new Error('Not connected');
    }

    const rightKey = this.key('rights', id.toString());
    const data = await this.redis.hgetall(rightKey);

    if (!data || Object.keys(data).length === 0) {
      return false;
    }

    // Reconstruct the unique hash to delete the unique constraint key
    const row = this.hashToRightsRow(data);
    const right = this.rowToRight(row);
    const uniqueHash = this.rightUniqueHash(right);
    const uniqueKey = this.key('rights', '_unique', uniqueHash);

    const pipeline = this.redis.multi();
    pipeline.del(rightKey);
    pipeline.srem(this.key('rights', '_all'), id.toString());
    pipeline.del(uniqueKey);
    await pipeline.exec();

    return true;
  }

  // ===========================================================================
  // Role Operations
  // ===========================================================================

  async saveRole(role: Role): Promise<number> {
    if (!this.redis) {
      throw new Error('Not connected');
    }

    return this.transaction(async () => {
      const roleKey = this.key('roles', role.name);
      const existingData = await this.redis!.hgetall(roleKey);

      const now = new Date().toISOString();
      const createdAt =
        existingData && existingData.created_at ? existingData.created_at : now;

      // Save/update role hash
      await this.redis!.hset(roleKey, {
        created_at: createdAt,
        name: role.name,
        updated_at: now
      });

      // Add to roles set
      await this.redis!.sadd(this.key('roles', '_all'), role.name);

      // Clear and rebuild role rights
      const roleRightsKey = this.key('roles', role.name, 'rights');
      await this.redis!.del(roleRightsKey);

      for (const right of role.rights.allRights()) {
        const rightId = await this.saveRight(right);
        await this.redis!.sadd(roleRightsKey, rightId.toString());
      }

      // Clear and rebuild parent roles
      const roleParentsKey = this.key('roles', role.name, 'parents');
      await this.redis!.del(roleParentsKey);

      for (const parent of role.parents) {
        await this.saveRole(parent);
        await this.redis!.sadd(roleParentsKey, parent.name);
      }

      // Return a synthetic ID (use hash of role name since Redis doesn't have auto-increment for this)
      // For consistency, we'll return a positive integer based on the role's position or hash
      const allRoles = await this.redis!.smembers(this.key('roles', '_all'));
      return allRoles.indexOf(role.name) + 1;
    });
  }

  private async loadRoleDirect(name: string): Promise<Role | null> {
    if (!this.redis) {
      throw new Error('Not connected');
    }

    const roleKey = this.key('roles', name);
    const data = await this.redis.hgetall(roleKey);

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    // Load role's rights
    const rights = new Rights();
    const roleRightsKey = this.key('roles', name, 'rights');
    const rightIds = await this.redis.smembers(roleRightsKey);

    for (const rightIdStr of rightIds) {
      const right = await this.loadRight(Number.parseInt(rightIdStr, 10));
      if (right) {
        rights.add(right);
      }
    }

    return new Role(name, rights);
  }

  async loadRoles(): Promise<Role[]> {
    const registry = await this.loadRegistry();
    return registry.getAll();
  }

  async loadRoleSummaries(
    query: RoleSummaryQuery = {}
  ): Promise<RevisionedRoleSummaries> {
    return this.withRegistryLock(async () => {
      const names = await this.redis!.smembers(this.key('roles', '_all'));
      const needle = query.name?.trim().toLocaleLowerCase() ?? '';
      const items: RoleSummary[] = [];
      for (const name of names) {
        if (needle && !name.toLocaleLowerCase().includes(needle)) {
          continue;
        }
        const role = await this.redis!.hgetall(this.key('roles', name));
        if (role.created_at && role.updated_at) {
          items.push({
            createdAt: new Date(role.created_at).toISOString(),
            name,
            updatedAt: new Date(role.updated_at).toISOString()
          });
        }
      }
      items.sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.name.localeCompare(right.name, undefined, {
            sensitivity: 'base'
          }) ||
          left.name.localeCompare(right.name)
      );
      return {
        items,
        revision: Number(
          (await this.redis!.get(this.key('roles', '_revision'))) ?? 0
        )
      };
    });
  }

  async deleteRole(name: string): Promise<boolean> {
    if (!this.redis) {
      throw new Error('Not connected');
    }

    const roleKey = this.key('roles', name);
    const exists = await this.redis.exists(roleKey);

    if (!exists) {
      return false;
    }

    const pipeline = this.redis.multi();
    pipeline.del(roleKey);
    pipeline.del(this.key('roles', name, 'rights'));
    pipeline.del(this.key('roles', name, 'parents'));
    pipeline.srem(this.key('roles', '_all'), name);
    await pipeline.exec();

    return true;
  }

  // ===========================================================================
  // RoleRegistry Operations
  // ===========================================================================

  async saveRegistry(registry: RoleRegistry): Promise<void> {
    if (!this.redis) {
      throw new Error('Not connected');
    }

    await this.withRegistryLock(async () => {
      await this.saveRegistryContents(registry);
      await this.redis!.incr(this.key('roles', '_revision'));
    });
  }

  private async saveRegistryContents(registry: RoleRegistry): Promise<void> {
    const rolesToSave = new Map<string, Role>();

    const collectRoles = (role: Role) => {
      if (!rolesToSave.has(role.name)) {
        rolesToSave.set(role.name, role);
        for (const parent of role.parents) {
          collectRoles(parent);
        }
      }
    };

    registry.toJSON().forEach(roleJson => {
      const role = registry.get(roleJson.name);
      if (role) {
        collectRoles(role);
      }
    });

    for (const role of rolesToSave.values()) {
      await this.saveRole(role);
    }
  }

  async loadRegistrySnapshot(): Promise<RoleRegistrySnapshot> {
    return this.withRegistryLock(async () => ({
      registry: await this.loadRegistry(),
      revision: Number(
        (await this.redis!.get(this.key('roles', '_revision'))) ?? 0
      )
    }));
  }

  async saveRegistryIfRevision(
    registry: RoleRegistry,
    expectedRevision: number
  ): Promise<RegistryCommitResult> {
    return this.withRegistryLock(async () => {
      const revision = Number(
        (await this.redis!.get(this.key('roles', '_revision'))) ?? 0
      );
      if (revision !== expectedRevision) {
        return { committed: false, revision };
      }
      const nextNames = new Set(registry.getAll().map(role => role.name));
      const currentNames = await this.redis!.smembers(
        this.key('roles', '_all')
      );
      for (const currentName of currentNames) {
        if (!nextNames.has(currentName)) {
          await this.deleteRole(currentName);
        }
      }
      await this.saveRegistryContents(registry);
      const nextRevision = await this.redis!.incr(
        this.key('roles', '_revision')
      );
      return { committed: true, revision: nextRevision };
    });
  }

  async loadRegistry(): Promise<RoleRegistry> {
    if (!this.redis) {
      throw new Error('Not connected');
    }

    const registry = new RoleRegistry();
    const roleNames = await this.redis.smembers(this.key('roles', '_all'));

    // First pass: define all roles with their rights
    for (const roleName of roleNames) {
      const role = await this.loadRoleDirect(roleName);
      if (!role) {
        continue;
      }
      registry.define(role.name, role.rights);
    }

    // Second pass: set up inheritance
    for (const roleName of roleNames) {
      const roleParentsKey = this.key('roles', roleName, 'parents');
      const parentNames = await this.redis.smembers(roleParentsKey);

      const registryRole = registry.get(roleName);
      if (registryRole) {
        for (const parentName of parentNames) {
          const parentRole = registry.get(parentName);
          if (parentRole) {
            registryRole.inheritsFrom(parentRole);
          }
        }
      }
    }

    return registry;
  }

  // ===========================================================================
  // Subject Operations
  // ===========================================================================

  async saveSubject(identifier: string, subject: Subject): Promise<number> {
    if (!this.redis) {
      throw new Error('Not connected');
    }

    return this.transaction(async () => {
      const subjectKey = this.key('subjects', identifier);
      const existingData = await this.redis!.hgetall(subjectKey);

      const now = new Date().toISOString();
      let id: number;

      if (existingData && existingData.id) {
        id = Number.parseInt(existingData.id, 10);
        // Update existing subject
        await this.redis!.hset(subjectKey, {
          identifier,
          updated_at: now
        });
      } else {
        // Create new subject with auto-increment ID
        id = await this.redis!.incr(this.key('subjects', '_seq'));
        await this.redis!.hset(subjectKey, {
          created_at: now,
          id: id.toString(),
          identifier,
          updated_at: now
        });
        await this.redis!.sadd(this.key('subjects', '_all'), identifier);
      }

      // Clear and rebuild subject roles
      const subjectRolesKey = this.key('subjects', identifier, 'roles');
      await this.redis!.del(subjectRolesKey);

      for (const role of subject.roles) {
        await this.saveRole(role);
        await this.redis!.sadd(subjectRolesKey, role.name);
      }

      // Clear and rebuild subject direct rights
      const subjectRightsKey = this.key('subjects', identifier, 'rights');
      await this.redis!.del(subjectRightsKey);

      for (const right of subject.rights.allRights()) {
        const rightId = await this.saveRight(right);
        await this.redis!.sadd(subjectRightsKey, rightId.toString());
      }

      return id;
    });
  }

  async loadSubject(
    identifier: string,
    registry?: RoleRegistry
  ): Promise<Subject | null> {
    if (!this.redis) {
      throw new Error('Not connected');
    }

    const subjectKey = this.key('subjects', identifier);
    const data = await this.redis.hgetall(subjectKey);

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    const subject = new Subject();
    const reg = registry ?? (await this.loadRegistry());

    // Load subject's roles
    const subjectRolesKey = this.key('subjects', identifier, 'roles');
    const roleNames = await this.redis.smembers(subjectRolesKey);
    this.applyRolesToSubject(subject, roleNames, reg);

    // Load subject's direct rights
    const subjectRightsKey = this.key('subjects', identifier, 'rights');
    const rightIds = await this.redis.smembers(subjectRightsKey);

    for (const rightIdStr of rightIds) {
      const right = await this.loadRight(Number.parseInt(rightIdStr, 10));
      if (right) {
        subject.rights.add(right);
      }
    }

    return subject;
  }

  async deleteSubject(identifier: string): Promise<boolean> {
    if (!this.redis) {
      throw new Error('Not connected');
    }

    const subjectKey = this.key('subjects', identifier);
    const exists = await this.redis.exists(subjectKey);

    if (!exists) {
      return false;
    }

    const pipeline = this.redis.multi();
    pipeline.del(subjectKey);
    pipeline.del(this.key('subjects', identifier, 'roles'));
    pipeline.del(this.key('subjects', identifier, 'rights'));
    pipeline.srem(this.key('subjects', '_all'), identifier);
    await pipeline.exec();

    return true;
  }

  /**
   * Load all subjects with their identifiers, direct rights, and hydrated roles.
   */
  async loadSubjects(): Promise<SubjectWithIdentifier[]> {
    if (!this.redis) {
      throw new Error('Not connected');
    }

    const allSubjectsKey = this.key('subjects', '_all');
    const subjectIdentifiers = await this.redis.smembers(allSubjectsKey);

    if (subjectIdentifiers.length === 0) {
      return [];
    }

    const registry = await this.loadRegistry();
    const rolesPipeline = this.redis.pipeline();
    const directRightsPipeline = this.redis.pipeline();

    for (const identifier of subjectIdentifiers) {
      rolesPipeline.smembers(this.key('subjects', identifier, 'roles'));
      directRightsPipeline.smembers(this.key('subjects', identifier, 'rights'));
    }

    const rolesResults = await rolesPipeline.exec();
    const directRightsResults = await directRightsPipeline.exec();

    const subjectRolesMap = new Map<string, string[]>();
    const subjectDirectRightIdsMap = new Map<string, string[]>();

    for (let i = 0; i < subjectIdentifiers.length; i++) {
      const identifier = subjectIdentifiers[i]!;
      const rolesResult = rolesResults?.[i];
      const directRightsResult = directRightsResults?.[i];

      if (rolesResult && !rolesResult[0]) {
        subjectRolesMap.set(identifier, rolesResult[1] as string[]);
      } else {
        subjectRolesMap.set(identifier, []);
      }

      if (directRightsResult && !directRightsResult[0]) {
        subjectDirectRightIdsMap.set(
          identifier,
          directRightsResult[1] as string[]
        );
      } else {
        subjectDirectRightIdsMap.set(identifier, []);
      }
    }

    const allRightIds = new Set<string>();
    for (const rightIds of subjectDirectRightIdsMap.values()) {
      for (const id of rightIds) {
        allRightIds.add(id);
      }
    }

    // Batch load all rights using pipeline
    const rightsPipeline = this.redis.pipeline();
    const rightIdsArray = Array.from(allRightIds);
    for (const rightId of rightIdsArray) {
      rightsPipeline.hgetall(this.key('rights', rightId));
    }
    const rightsResults = await rightsPipeline.exec();

    // Build right ID -> Right mapping
    const rightsMap = new Map<string, Right>();
    for (let i = 0; i < rightIdsArray.length; i++) {
      const rightId = rightIdsArray[i]!;
      const result = rightsResults?.[i];
      if (result && !result[0] && result[1]) {
        const data = result[1] as Record<string, string>;
        if (Object.keys(data).length > 0) {
          const row = this.hashToRightsRow(data);
          rightsMap.set(rightId, this.rowToRight(row));
        }
      }
    }

    const result: SubjectWithIdentifier[] = [];

    for (const identifier of subjectIdentifiers) {
      const subject = new Subject();

      this.applyRolesToSubject(
        subject,
        subjectRolesMap.get(identifier) ?? [],
        registry
      );

      const directRightIds = subjectDirectRightIdsMap.get(identifier) ?? [];
      for (const rightId of directRightIds) {
        const right = rightsMap.get(rightId);
        if (right) {
          subject.rights.add(right);
        }
      }

      result.push({ identifier, subject });
    }

    return result;
  }

  /**
   * Load subjects with pagination, direct rights, and hydrated roles.
   */
  async loadSubjectsPaginated(
    options: PaginationOptions
  ): Promise<PaginatedResult<SubjectWithIdentifier>> {
    if (!this.redis) {
      throw new Error('Not connected');
    }

    const { page, pageSize } = options;

    // Get all subject identifiers (Redis sets don't support efficient pagination)
    const allSubjectsKey = this.key('subjects', '_all');
    const allIdentifiers = await this.redis.smembers(allSubjectsKey);
    const total = allIdentifiers.length;

    if (total === 0) {
      return { items: [], total: 0 };
    }

    // Sort for consistent ordering and apply pagination
    allIdentifiers.sort();
    const offset = (page - 1) * pageSize;
    const subjectIdentifiers = allIdentifiers.slice(offset, offset + pageSize);

    if (subjectIdentifiers.length === 0) {
      return { items: [], total };
    }

    const registry = await this.loadRegistry();
    const rolesPipeline = this.redis.pipeline();
    const directRightsPipeline = this.redis.pipeline();

    for (const identifier of subjectIdentifiers) {
      rolesPipeline.smembers(this.key('subjects', identifier, 'roles'));
      directRightsPipeline.smembers(this.key('subjects', identifier, 'rights'));
    }

    const rolesResults = await rolesPipeline.exec();
    const directRightsResults = await directRightsPipeline.exec();

    const subjectRolesMap = new Map<string, string[]>();
    const subjectDirectRightIdsMap = new Map<string, string[]>();

    for (let i = 0; i < subjectIdentifiers.length; i++) {
      const identifier = subjectIdentifiers[i]!;
      const rolesResult = rolesResults?.[i];
      const directRightsResult = directRightsResults?.[i];

      if (rolesResult && !rolesResult[0]) {
        subjectRolesMap.set(identifier, rolesResult[1] as string[]);
      } else {
        subjectRolesMap.set(identifier, []);
      }

      if (directRightsResult && !directRightsResult[0]) {
        subjectDirectRightIdsMap.set(
          identifier,
          directRightsResult[1] as string[]
        );
      } else {
        subjectDirectRightIdsMap.set(identifier, []);
      }
    }

    const allRightIds = new Set<string>();
    for (const rightIds of subjectDirectRightIdsMap.values()) {
      for (const id of rightIds) {
        allRightIds.add(id);
      }
    }

    // Batch load all rights using pipeline
    const rightsPipeline = this.redis.pipeline();
    const rightIdsArray = Array.from(allRightIds);
    for (const rightId of rightIdsArray) {
      rightsPipeline.hgetall(this.key('rights', rightId));
    }
    const rightsResults = await rightsPipeline.exec();

    // Build right ID -> Right mapping
    const rightsMap = new Map<string, Right>();
    for (let i = 0; i < rightIdsArray.length; i++) {
      const rightId = rightIdsArray[i]!;
      const result = rightsResults?.[i];
      if (result && !result[0] && result[1]) {
        const data = result[1] as Record<string, string>;
        if (Object.keys(data).length > 0) {
          const row = this.hashToRightsRow(data);
          rightsMap.set(rightId, this.rowToRight(row));
        }
      }
    }

    const items: SubjectWithIdentifier[] = [];

    for (const identifier of subjectIdentifiers) {
      const subject = new Subject();

      this.applyRolesToSubject(
        subject,
        subjectRolesMap.get(identifier) ?? [],
        registry
      );

      const directRightIds = subjectDirectRightIdsMap.get(identifier) ?? [];
      for (const rightId of directRightIds) {
        const right = rightsMap.get(rightId);
        if (right) {
          subject.rights.add(right);
        }
      }

      items.push({ identifier, subject });
    }

    return { items, total };
  }

  // ===========================================================================
  // Utility
  // ===========================================================================

  /**
   * Serialize registry-wide reads and commits behind a single-holder lock, so
   * summaries and snapshots cannot pair role data with the wrong revision.
   * Release is token-guarded, so a holder never deletes someone else's lock.
   *
   * Two limits worth knowing: the lock has a 30s TTL and no fencing token, so a
   * body that overruns it can proceed alongside the next holder; and the
   * revision-blind saveRole()/deleteRole() paths do not take it at all.
   */
  private async withRegistryLock<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.redis) {
      throw new Error('Not connected');
    }
    const lockKey = this.key('roles', '_write_lock');
    const token = `${Date.now()}-${Math.random()}`;
    let acquired = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      acquired =
        (await this.redis.set(lockKey, token, 'PX', 30_000, 'NX')) === 'OK';
      if (acquired) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (!acquired) {
      throw new Error('Timed out acquiring the role registry write lock');
    }
    try {
      return await fn();
    } finally {
      await this.redis.eval(
        `if redis.call('get', KEYS[1]) == ARGV[1] then
           return redis.call('del', KEYS[1])
         end
         return 0`,
        1,
        lockKey,
        token
      );
    }
  }

  async clear(): Promise<void> {
    if (!this.redis) {
      throw new Error('Not connected');
    }

    const prefix = this.options.keyPrefix ?? this.tablePrefix;
    const pattern = `${prefix}*`;

    // Use SCAN to find all keys matching our prefix (safer than KEYS for production)
    let cursor = '0';
    const keysToDelete: string[] = [];

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100
      );
      cursor = nextCursor;
      keysToDelete.push(...keys);
    } while (cursor !== '0');

    // Delete keys in batches
    if (keysToDelete.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < keysToDelete.length; i += batchSize) {
        const batch = keysToDelete.slice(i, i + batchSize);
        await this.redis.del(...batch);
      }
    }
  }

  async transaction<T>(
    fn: (adapter: DatabaseAdapter) => Promise<T>
  ): Promise<T> {
    if (!this.redis) {
      throw new Error('Not connected');
    }

    // Note: Redis MULTI/EXEC doesn't support true rollback like SQL databases.
    // If an error occurs, we can't undo operations that were already executed.
    // For nested transactions, we just track depth and only wrap at the outermost level.

    const isNested = this.transactionDepth > 0;
    this.transactionDepth++;

    try {
      const result = await fn(this);
      this.transactionDepth--;
      return result;
    } catch (error) {
      this.transactionDepth--;
      throw error;
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Convert Redis hash data to a RightsRow
   */
  private hashToRightsRow(data: Record<string, string>): RightsRow {
    return {
      allow_mask: Number.parseInt(data.allow_mask || '0', 10),
      created_at: data.created_at || new Date().toISOString(),
      deny_mask: Number.parseInt(data.deny_mask || '0', 10),
      description: data.description || null,
      id: Number.parseInt(data.id || '0', 10),
      path: data.path || '',
      priority: Number.parseInt(data.priority || '0', 10),
      tags: data.tags || null,
      updated_at: data.updated_at || new Date().toISOString(),
      valid_from: data.valid_from || null,
      valid_until: data.valid_until || null
    };
  }
}
