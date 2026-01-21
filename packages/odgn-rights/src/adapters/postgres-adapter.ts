import { SQL } from 'bun';

import { Flags } from '../constants';
import { Right } from '../right';
import { Rights } from '../rights';
import { Role } from '../role';
import { RoleRegistry } from '../role-registry';
import { Subject } from '../subject';
import { BaseAdapter } from './base-adapter';
import { generatePostgresSchema } from './schema';
import type {
  BaseAdapterOptions,
  DatabaseAdapter,
  PaginatedResult,
  PaginationOptions,
  RightsRow,
  RoleInheritanceRow,
  RoleRow,
  SubjectWithIdentifier
} from './types';

export type PostgresAdapterOptions = BaseAdapterOptions & {
  database?: string;
  hostname?: string;
  idleTimeout?: number;
  max?: number;
  password?: string;
  port?: number;
  ssl?: boolean | object;
  url?: string;
  username?: string;
};

export class PostgresAdapter extends BaseAdapter {
  private sql: SQL | null = null;
  private readonly options: PostgresAdapterOptions;
  private transactionDepth = 0;

  constructor(options: PostgresAdapterOptions = {}) {
    super(options);
    this.options = options;
  }

  async connect(): Promise<void> {
    this.sql = this.options.url
      ? new SQL({
          idleTimeout: this.options.idleTimeout ?? 30,
          max: this.options.max ?? 1,
          ssl: this.options.ssl,
          url: this.options.url
        })
      : new SQL({
          database: this.options.database,
          hostname: this.options.hostname ?? 'localhost',
          idleTimeout: this.options.idleTimeout ?? 30,
          max: this.options.max ?? 1,
          password: this.options.password,
          port: this.options.port ?? 5432,
          ssl: this.options.ssl,
          username: this.options.username
        });
  }

  async disconnect(): Promise<void> {
    if (this.sql) {
      await this.sql.end();
      this.sql = null;
    }
  }

  async migrate(): Promise<void> {
    if (!this.sql) {
      throw new Error('Not connected');
    }
    await this.sql.unsafe(generatePostgresSchema(this.tables));
  }

  // ===========================================================================
  // Rights Operations
  // ===========================================================================

  async saveRight(right: Right): Promise<number> {
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const row = this.rightToRow(right);
    const { rights: rightsTable } = this.tables;

    const [result] = await this.sql.unsafe(
      `
      INSERT INTO ${rightsTable} (path, allow_mask, deny_mask, priority, description, tags, valid_from, valid_until)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (path, allow_mask, deny_mask, priority, valid_from, valid_until)
      DO UPDATE SET updated_at = NOW()
      RETURNING id
    `,
      [
        row.path,
        row.allow_mask,
        row.deny_mask,
        row.priority,
        row.description,
        row.tags,
        row.valid_from,
        row.valid_until
      ]
    );

    right._setDbId(result.id);
    return result.id;
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
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const { rights: rightsTable } = this.tables;

    const [row] = await this.sql.unsafe(
      `SELECT * FROM ${rightsTable} WHERE id = $1`,
      [id]
    );

    if (!row) {
      return null;
    }

    return this.rowToRight(row as RightsRow);
  }

  async loadRights(): Promise<Rights> {
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const { rights: rightsTable } = this.tables;

    const rows = await this.sql.unsafe(
      `SELECT * FROM ${rightsTable} ORDER BY id`
    );

    const loadedRights = new Rights();

    for (const row of rows) {
      loadedRights.add(this.rowToRight(row as RightsRow));
    }

    return loadedRights;
  }

  async loadRightsByPath(pathPattern: string): Promise<Rights> {
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const { rights: rightsTable } = this.tables;

    const pattern = pathPattern.replaceAll('*', '%').replaceAll('?', '_');

    const rows = await this.sql.unsafe(
      `SELECT * FROM ${rightsTable} WHERE path LIKE $1 ORDER BY id`,
      [pattern]
    );

    const loadedRights = new Rights();

    for (const row of rows) {
      loadedRights.add(this.rowToRight(row as RightsRow));
    }

    return loadedRights;
  }

  async deleteRight(id: number): Promise<boolean> {
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const { rights: rightsTable } = this.tables;

    const result = await this.sql.unsafe(
      `DELETE FROM ${rightsTable} WHERE id = $1`,
      [id]
    );

    return (result as unknown as { count: number }).count > 0;
  }

  // ===========================================================================
  // Role Operations
  // ===========================================================================

  async saveRole(role: Role): Promise<number> {
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const { roleInheritance, roleRights, roles } = this.tables;

    return this.transaction(async () => {
      const [roleResult] = await this.sql!.unsafe(
        `
        INSERT INTO ${roles} (name)
        VALUES ($1)
        ON CONFLICT (name) DO UPDATE SET updated_at = NOW()
        RETURNING id
      `,
        [role.name]
      );

      const roleId = roleResult.id;

      await this.sql!.unsafe(`DELETE FROM ${roleRights} WHERE role_id = $1`, [
        roleId
      ]);

      await this.sql!.unsafe(
        `DELETE FROM ${roleInheritance} WHERE child_role_id = $1`,
        [roleId]
      );

      for (const right of role.rights.allRights()) {
        const rightId = await this.saveRight(right);
        await this.sql!.unsafe(
          `INSERT INTO ${roleRights} (role_id, right_id) VALUES ($1, $2)`,
          [roleId, rightId]
        );
      }

      for (const parent of role.parents) {
        const parentId = await this.saveRole(parent);
        await this.sql!.unsafe(
          `INSERT INTO ${roleInheritance} (child_role_id, parent_role_id) VALUES ($1, $2)`,
          [roleId, parentId]
        );
      }

      return roleId;
    });
  }

  async loadRole(name: string): Promise<Role | null> {
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const { roleRights, roles } = this.tables;

    const [roleRow] = await this.sql.unsafe(
      `SELECT * FROM ${roles} WHERE name = $1`,
      [name]
    );

    if (!roleRow) {
      return null;
    }

    const rights = new Rights();

    const roleRightRows = await this.sql.unsafe(
      `SELECT right_id FROM ${roleRights} WHERE role_id = $1`,
      [roleRow.id]
    );

    for (const rr of roleRightRows) {
      const right = await this.loadRight((rr as { right_id: number }).right_id);
      if (right) {
        rights.add(right);
      }
    }

    return new Role(name, rights);
  }

  async loadRoles(): Promise<Role[]> {
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const { roles: rolesTable } = this.tables;

    const roleRows = await this.sql.unsafe(
      `SELECT * FROM ${rolesTable} ORDER BY id`
    );

    const loadedRoles: Role[] = [];

    for (const row of roleRows) {
      const role = await this.loadRole((row as RoleRow).name);
      if (role) {
        loadedRoles.push(role);
      }
    }

    return loadedRoles;
  }

  async deleteRole(name: string): Promise<boolean> {
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const { roles } = this.tables;

    const result = await this.sql.unsafe(
      `DELETE FROM ${roles} WHERE name = $1`,
      [name]
    );

    return (result as unknown as { count: number }).count > 0;
  }

  // ===========================================================================
  // RoleRegistry Operations
  // ===========================================================================

  async saveRegistry(registry: RoleRegistry): Promise<void> {
    if (!this.sql) {
      throw new Error('Not connected');
    }

    await this.transaction(async () => {
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
    });
  }

  async loadRegistry(): Promise<RoleRegistry> {
    const registry = new RoleRegistry();
    const roles = await this.loadRoles();

    const roleMap = new Map<string, { id: number; role: Role }>();

    for (const role of roles) {
      // Define the role in the registry and get the registered role back
      const registeredRole = registry.define(role.name, role.rights);

      const { roles: rolesTable } = this.tables;

      const [roleRow] = await this.sql!.unsafe(
        `SELECT id FROM ${rolesTable} WHERE name = $1`,
        [role.name]
      );

      if (roleRow) {
        // Store the registered role, not the original loaded role
        roleMap.set(role.name, { id: roleRow.id, role: registeredRole });
      }
    }

    const { roleInheritance } = this.tables;

    const inheritRows = await this.sql!.unsafe(
      `SELECT child_role_id, parent_role_id FROM ${roleInheritance}`
    );

    for (const ir of inheritRows) {
      const inheritanceRow = ir as RoleInheritanceRow;

      let childRole: Role | undefined;
      let parentRole: Role | undefined;

      for (const [, data] of roleMap.entries()) {
        if (data.id === inheritanceRow.child_role_id) {
          childRole = data.role;
        }
        if (data.id === inheritanceRow.parent_role_id) {
          parentRole = data.role;
        }
      }

      if (childRole && parentRole) {
        childRole.inheritsFrom(parentRole);
      }
    }

    return registry;
  }

  // ===========================================================================
  // Subject Operations
  // ===========================================================================

  async saveSubject(identifier: string, subject: Subject): Promise<number> {
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const { subjectRights, subjectRoles, subjects } = this.tables;

    return this.transaction(async () => {
      const [subjectResult] = await this.sql!.unsafe(
        `
        INSERT INTO ${subjects} (identifier)
        VALUES ($1)
        ON CONFLICT (identifier) DO UPDATE SET updated_at = NOW()
        RETURNING id
      `,
        [identifier]
      );

      const subjectId = subjectResult.id;

      await this.sql!.unsafe(
        `DELETE FROM ${subjectRoles} WHERE subject_id = $1`,
        [subjectId]
      );

      await this.sql!.unsafe(
        `DELETE FROM ${subjectRights} WHERE subject_id = $1`,
        [subjectId]
      );

      for (const role of subject.roles) {
        const roleId = await this.saveRole(role);
        await this.sql!.unsafe(
          `INSERT INTO ${subjectRoles} (subject_id, role_id) VALUES ($1, $2)`,
          [subjectId, roleId]
        );
      }

      for (const right of subject.rights.allRights()) {
        const rightId = await this.saveRight(right);
        await this.sql!.unsafe(
          `INSERT INTO ${subjectRights} (subject_id, right_id) VALUES ($1, $2)`,
          [subjectId, rightId]
        );
      }

      return subjectId;
    });
  }

  async loadSubject(identifier: string): Promise<Subject | null> {
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const { roles, subjectRights, subjectRoles, subjects } = this.tables;

    const [subjectRow] = await this.sql.unsafe(
      `SELECT * FROM ${subjects} WHERE identifier = $1`,
      [identifier]
    );

    if (!subjectRow) {
      return null;
    }

    const subject = new Subject();

    const subjectRoleRows = await this.sql.unsafe(
      `SELECT role_id FROM ${subjectRoles} WHERE subject_id = $1`,
      [subjectRow.id]
    );

    for (const sr of subjectRoleRows) {
      const subjectRoleRow = sr as { role_id: number };

      const [roleName] = await this.sql.unsafe(
        `SELECT name FROM ${roles} WHERE id = $1`,
        [subjectRoleRow.role_id]
      );

      if (roleName) {
        const role = await this.loadRole((roleName as { name: string }).name);
        if (role) {
          subject.memberOf(role);
        }
      }
    }

    const subjectRightRows = await this.sql.unsafe(
      `SELECT right_id FROM ${subjectRights} WHERE subject_id = $1`,
      [subjectRow.id]
    );

    for (const sr of subjectRightRows) {
      const subjectRightRow = sr as { right_id: number };

      const right = await this.loadRight(subjectRightRow.right_id);
      if (right) {
        subject.rights.add(right);
      }
    }

    return subject;
  }

  async deleteSubject(identifier: string): Promise<boolean> {
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const { subjects } = this.tables;

    const result = await this.sql.unsafe(
      `DELETE FROM ${subjects} WHERE identifier = $1`,
      [identifier]
    );

    return (result as unknown as { count: number }).count > 0;
  }

  /**
   * Load all subjects with their identifiers using optimized batch loading.
   * Uses JOINs to load all data in a constant number of queries (4 queries total),
   * avoiding N+1 query problems.
   */
  async loadSubjects(): Promise<SubjectWithIdentifier[]> {
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const { rights, roleRights, roles, subjectRights, subjectRoles, subjects } =
      this.tables;

    // Query 1: Load all subjects
    const subjectRows = await this.sql.unsafe(
      `SELECT id, identifier FROM ${subjects} ORDER BY id`
    );

    if (subjectRows.length === 0) {
      return [];
    }

    // Query 2: Batch load all subject-role mappings with role names
    const subjectRoleRows = await this.sql.unsafe(
      `SELECT sr.subject_id, r.name as role_name
       FROM ${subjectRoles} sr
       JOIN ${roles} r ON sr.role_id = r.id`
    );

    // Query 3: Batch load all subject direct rights
    const subjectRightRows = await this.sql.unsafe(
      `SELECT sr.subject_id, rt.*
       FROM ${subjectRights} sr
       JOIN ${rights} rt ON sr.right_id = rt.id`
    );

    // Query 4: Batch load all role rights
    const roleRightRows = await this.sql.unsafe(
      `SELECT r.name as role_name, rt.*
       FROM ${roleRights} rr
       JOIN ${roles} r ON rr.role_id = r.id
       JOIN ${rights} rt ON rr.right_id = rt.id`
    );

    // Build role -> rights mapping
    const roleRightsMap = new Map<string, Rights>();
    for (const row of roleRightRows) {
      const { role_name, ...rightData } = row as {
        role_name: string;
      } & RightsRow;
      if (!roleRightsMap.has(role_name)) {
        roleRightsMap.set(role_name, new Rights());
      }
      roleRightsMap
        .get(role_name)!
        .add(this.rowToRight(rightData as RightsRow));
    }

    // Build subject -> roles mapping
    const subjectRolesMap = new Map<number, string[]>();
    for (const row of subjectRoleRows) {
      const { role_name, subject_id } = row as {
        role_name: string;
        subject_id: number;
      };
      if (!subjectRolesMap.has(subject_id)) {
        subjectRolesMap.set(subject_id, []);
      }
      subjectRolesMap.get(subject_id)!.push(role_name);
    }

    // Build subject -> direct rights mapping
    const subjectDirectRightsMap = new Map<number, Rights>();
    for (const row of subjectRightRows) {
      const { subject_id, ...rightData } = row as {
        subject_id: number;
      } & RightsRow;
      if (!subjectDirectRightsMap.has(subject_id)) {
        subjectDirectRightsMap.set(subject_id, new Rights());
      }
      subjectDirectRightsMap
        .get(subject_id)!
        .add(this.rowToRight(rightData as RightsRow));
    }

    // Build result array
    const result: SubjectWithIdentifier[] = [];

    for (const row of subjectRows) {
      const { id: subjectId, identifier } = row as {
        id: number;
        identifier: string;
      };
      const subject = new Subject();

      // Add roles with their rights
      const roleNames = subjectRolesMap.get(subjectId) ?? [];
      for (const roleName of roleNames) {
        const roleRights = roleRightsMap.get(roleName) ?? new Rights();
        const role = new Role(roleName, roleRights);
        subject.memberOf(role);
      }

      // Add direct rights
      const directRights = subjectDirectRightsMap.get(subjectId);
      if (directRights) {
        for (const right of directRights.allRights()) {
          subject.rights.add(right);
        }
      }

      result.push({ identifier, subject });
    }

    return result;
  }

  /**
   * Load subjects with pagination using optimized batch loading.
   * Uses JOINs to load all data in a constant number of queries (5 queries total),
   * avoiding N+1 query problems.
   */
  async loadSubjectsPaginated(
    options: PaginationOptions
  ): Promise<PaginatedResult<SubjectWithIdentifier>> {
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const { page, pageSize } = options;
    const offset = (page - 1) * pageSize;

    const { rights, roleRights, roles, subjectRights, subjectRoles, subjects } =
      this.tables;

    // Query 1: Get total count
    const [countResult] = await this.sql.unsafe(
      `SELECT COUNT(*) as count FROM ${subjects}`
    );
    const total = Number((countResult as { count: string | number }).count);

    if (total === 0) {
      return { items: [], total: 0 };
    }

    // Query 2: Load paginated subjects
    const subjectRows = await this.sql.unsafe(
      `SELECT id, identifier FROM ${subjects} ORDER BY id LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );

    if (subjectRows.length === 0) {
      return { items: [], total };
    }

    // Get subject IDs for filtering related data
    const subjectIds = subjectRows.map(
      (row: { id: number }) => (row as { id: number }).id
    );

    // Generate placeholders for IN clause (Bun's SQL driver doesn't support ANY($1) with arrays)
    const subjectIdPlaceholders = subjectIds
      .map((_: number, i: number) => `$${i + 1}`)
      .join(', ');

    // Query 3: Batch load subject-role mappings for these subjects only
    const subjectRoleRows = await this.sql.unsafe(
      `SELECT sr.subject_id, r.name as role_name
       FROM ${subjectRoles} sr
       JOIN ${roles} r ON sr.role_id = r.id
       WHERE sr.subject_id IN (${subjectIdPlaceholders})`,
      subjectIds
    );

    // Query 4: Batch load subject direct rights for these subjects only
    const subjectRightRows = await this.sql.unsafe(
      `SELECT sr.subject_id, rt.*
       FROM ${subjectRights} sr
       JOIN ${rights} rt ON sr.right_id = rt.id
       WHERE sr.subject_id IN (${subjectIdPlaceholders})`,
      subjectIds
    );

    // Get unique role names to fetch only relevant role rights
    const roleNamesSet = new Set<string>();
    for (const row of subjectRoleRows) {
      roleNamesSet.add((row as { role_name: string }).role_name);
    }
    const roleNames = Array.from(roleNamesSet);

    // Query 5: Batch load role rights for only the roles used by these subjects
    let roleRightRows: unknown[] = [];
    if (roleNames.length > 0) {
      const roleNamePlaceholders = roleNames
        .map((_, i) => `$${i + 1}`)
        .join(', ');
      roleRightRows = await this.sql.unsafe(
        `SELECT r.name as role_name, rt.*
         FROM ${roleRights} rr
         JOIN ${roles} r ON rr.role_id = r.id
         JOIN ${rights} rt ON rr.right_id = rt.id
         WHERE r.name IN (${roleNamePlaceholders})`,
        roleNames
      );
    }

    // Build role -> rights mapping
    const roleRightsMap = new Map<string, Rights>();
    for (const row of roleRightRows) {
      const { role_name, ...rightData } = row as {
        role_name: string;
      } & RightsRow;
      if (!roleRightsMap.has(role_name)) {
        roleRightsMap.set(role_name, new Rights());
      }
      roleRightsMap
        .get(role_name)!
        .add(this.rowToRight(rightData as RightsRow));
    }

    // Build subject -> roles mapping
    const subjectRolesMap = new Map<number, string[]>();
    for (const row of subjectRoleRows) {
      const { role_name, subject_id } = row as {
        role_name: string;
        subject_id: number;
      };
      if (!subjectRolesMap.has(subject_id)) {
        subjectRolesMap.set(subject_id, []);
      }
      subjectRolesMap.get(subject_id)!.push(role_name);
    }

    // Build subject -> direct rights mapping
    const subjectDirectRightsMap = new Map<number, Rights>();
    for (const row of subjectRightRows) {
      const { subject_id, ...rightData } = row as {
        subject_id: number;
      } & RightsRow;
      if (!subjectDirectRightsMap.has(subject_id)) {
        subjectDirectRightsMap.set(subject_id, new Rights());
      }
      subjectDirectRightsMap
        .get(subject_id)!
        .add(this.rowToRight(rightData as RightsRow));
    }

    // Build result array
    const items: SubjectWithIdentifier[] = [];

    for (const row of subjectRows) {
      const { id: subjectId, identifier } = row as {
        id: number;
        identifier: string;
      };
      const subject = new Subject();

      // Add roles with their rights
      const subjectRoleNames = subjectRolesMap.get(subjectId) ?? [];
      for (const roleName of subjectRoleNames) {
        const roleRights = roleRightsMap.get(roleName) ?? new Rights();
        const role = new Role(roleName, roleRights);
        subject.memberOf(role);
      }

      // Add direct rights
      const directRights = subjectDirectRightsMap.get(subjectId);
      if (directRights) {
        for (const right of directRights.allRights()) {
          subject.rights.add(right);
        }
      }

      items.push({ identifier, subject });
    }

    return { items, total };
  }

  protected async getAllSubjectIdentifiers(): Promise<string[]> {
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const { subjects } = this.tables;
    const rows = (await this.sql.unsafe(
      `SELECT identifier FROM ${subjects}`
    )) as Array<{ identifier: string }>;

    return rows.map(row => row.identifier);
  }

  /**
   * Optimized findSubjectsWithAccess using batch loading with JOINs.
   * Reduces N+1 queries to a constant number of queries regardless of subject count.
   */
  override async findSubjectsWithAccess(
    pathPattern: string,
    flags: Flags
  ): Promise<string[]> {
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const { rights, roleRights, roles, subjectRights, subjectRoles, subjects } =
      this.tables;

    // Load all subjects with their data in batch queries
    const subjectRows = await this.sql.unsafe(
      `SELECT id, identifier FROM ${subjects}`
    );

    if (subjectRows.length === 0) {
      return [];
    }

    // Create a map of subject id -> identifier for quick lookup
    const subjectIdToIdentifier = new Map<number, string>();
    for (const row of subjectRows) {
      const { id, identifier } = row as { id: number; identifier: string };
      subjectIdToIdentifier.set(id, identifier);
    }

    // Batch load all subject-role mappings with role names
    const subjectRoleRows = await this.sql.unsafe(
      `SELECT sr.subject_id, r.name as role_name
       FROM ${subjectRoles} sr
       JOIN ${roles} r ON sr.role_id = r.id`
    );

    // Batch load all subject direct rights
    const subjectRightRows = await this.sql.unsafe(
      `SELECT sr.subject_id, rt.*
       FROM ${subjectRights} sr
       JOIN ${rights} rt ON sr.right_id = rt.id`
    );

    // Batch load all role rights
    const roleRightRows = await this.sql.unsafe(
      `SELECT r.name as role_name, rt.*
       FROM ${roleRights} rr
       JOIN ${roles} r ON rr.role_id = r.id
       JOIN ${rights} rt ON rr.right_id = rt.id`
    );

    // Build role -> rights mapping
    const roleRightsMap = new Map<string, Rights>();
    for (const row of roleRightRows) {
      const { role_name, ...rightData } = row as {
        role_name: string;
      } & RightsRow;
      if (!roleRightsMap.has(role_name)) {
        roleRightsMap.set(role_name, new Rights());
      }
      roleRightsMap
        .get(role_name)!
        .add(this.rowToRight(rightData as RightsRow));
    }

    // Build subject -> roles mapping
    const subjectRolesMap = new Map<number, string[]>();
    for (const row of subjectRoleRows) {
      const { role_name, subject_id } = row as {
        role_name: string;
        subject_id: number;
      };
      if (!subjectRolesMap.has(subject_id)) {
        subjectRolesMap.set(subject_id, []);
      }
      subjectRolesMap.get(subject_id)!.push(role_name);
    }

    // Build subject -> direct rights mapping
    const subjectDirectRightsMap = new Map<number, Rights>();
    for (const row of subjectRightRows) {
      const { subject_id, ...rightData } = row as {
        subject_id: number;
      } & RightsRow;
      if (!subjectDirectRightsMap.has(subject_id)) {
        subjectDirectRightsMap.set(subject_id, new Rights());
      }
      subjectDirectRightsMap
        .get(subject_id)!
        .add(this.rowToRight(rightData as RightsRow));
    }

    // Now construct Subject objects and check access
    const matchingSubjects: string[] = [];

    for (const [subjectId, identifier] of subjectIdToIdentifier) {
      const subject = new Subject();

      // Add roles with their rights
      const roleNames = subjectRolesMap.get(subjectId) ?? [];
      for (const roleName of roleNames) {
        const roleRights = roleRightsMap.get(roleName) ?? new Rights();
        const role = new Role(roleName, roleRights);
        subject.memberOf(role);
      }

      // Add direct rights
      const directRights = subjectDirectRightsMap.get(subjectId);
      if (directRights) {
        for (const right of directRights.allRights()) {
          subject.rights.add(right);
        }
      }

      // Check if subject has the requested access
      if (subject.has(pathPattern, flags)) {
        matchingSubjects.push(identifier);
      }
    }

    return matchingSubjects;
  }

  // ===========================================================================
  // Utility
  // ===========================================================================

  async clear(): Promise<void> {
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const {
      rights,
      roleInheritance,
      roleRights,
      roles,
      subjectRights,
      subjectRoles,
      subjects
    } = this.tables;

    await this.sql.unsafe(`DELETE FROM ${subjectRights}`);
    await this.sql.unsafe(`DELETE FROM ${subjectRoles}`);
    await this.sql.unsafe(`DELETE FROM ${subjects}`);
    await this.sql.unsafe(`DELETE FROM ${roleInheritance}`);
    await this.sql.unsafe(`DELETE FROM ${roleRights}`);
    await this.sql.unsafe(`DELETE FROM ${roles}`);
    await this.sql.unsafe(`DELETE FROM ${rights}`);
  }

  async transaction<T>(
    fn: (adapter: DatabaseAdapter) => Promise<T>
  ): Promise<T> {
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const isNested = this.transactionDepth > 0;

    if (!isNested) {
      await this.sql.unsafe('BEGIN');
    }

    this.transactionDepth++;
    try {
      const result = await fn(this);
      this.transactionDepth--;

      if (!isNested) {
        await this.sql.unsafe('COMMIT');
      }

      return result;
    } catch (error) {
      this.transactionDepth--;

      if (!isNested) {
        await this.sql.unsafe('ROLLBACK');
      }

      throw error;
    }
  }
}
