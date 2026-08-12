import { SQL } from 'bun';

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
  RegistryCommitResult,
  RevisionedRoleSummaries,
  RightsRow,
  RoleInheritanceRow,
  RoleRegistrySnapshot,
  RoleSummaryQuery,
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

  async loadRoles(): Promise<Role[]> {
    const registry = await this.loadRegistry();
    return registry.getAll();
  }

  async loadRoleSummaries(
    query: RoleSummaryQuery = {}
  ): Promise<RevisionedRoleSummaries> {
    if (!this.sql) {
      throw new Error('Not connected');
    }
    const { roleRegistryState, roles } = this.tables;
    const name = query.name?.trim() ?? '';
    return this.transaction(async () => {
      // Keep the summary rows and revision in one read view. The shared lock
      // prevents a revision-changing registry commit until these rows have
      // been returned to the caller.
      const states = await this.sql!.unsafe<
        Array<{ revision: number | string }>
      >(
        `SELECT revision FROM ${roleRegistryState} WHERE singleton = 1 FOR SHARE`
      );
      const rows = await this.sql!.unsafe<
        Array<{ created_at: Date; name: string; updated_at: Date }>
      >(
        `SELECT name, created_at, updated_at
         FROM ${roles}
         WHERE $1 = '' OR POSITION(LOWER($1) IN LOWER(name)) > 0
         ORDER BY created_at, LOWER(name), name`,
        [name]
      );
      return {
        items: rows.map(row => ({
          createdAt: new Date(row.created_at).toISOString(),
          name: row.name,
          updatedAt: new Date(row.updated_at).toISOString()
        })),
        revision: Number(states[0]?.revision ?? 0)
      };
    });
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
      // Serialize legacy whole-registry saves with revisioned readers/writers.
      // Taking this lock before touching role rows keeps summaries paired with
      // the revision they report.
      await this.sql!.unsafe(
        `SELECT revision FROM ${this.tables.roleRegistryState} WHERE singleton = 1 FOR UPDATE`
      );
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
      await this.sql!.unsafe(
        `UPDATE ${this.tables.roleRegistryState} SET revision = revision + 1 WHERE singleton = 1`
      );
    });
  }

  async loadRegistrySnapshot(): Promise<RoleRegistrySnapshot> {
    return this.transaction(async () => {
      // Take the shared lock before reading role rows, so a concurrent
      // registry commit cannot slip in between and leave us reporting old
      // roles alongside the revision that superseded them.
      const [state] = await this.sql!.unsafe<
        Array<{
          revision: number | string;
        }>
      >(
        `SELECT revision FROM ${this.tables.roleRegistryState} WHERE singleton = 1 FOR SHARE`
      );
      const registry = await this.loadRegistry();
      return { registry, revision: Number(state?.revision ?? 0) };
    });
  }

  async saveRegistryIfRevision(
    registry: RoleRegistry,
    expectedRevision: number
  ): Promise<RegistryCommitResult> {
    return this.transaction(async () => {
      const [state] = await this.sql!.unsafe<
        Array<{
          revision: number | string;
        }>
      >(
        `SELECT revision FROM ${this.tables.roleRegistryState} WHERE singleton = 1 FOR UPDATE`
      );
      const revision = Number(state?.revision ?? 0);
      if (revision !== expectedRevision) {
        return { committed: false, revision };
      }
      const nextNames = new Set(registry.getAll().map(role => role.name));
      const currentRoles = await this.sql!.unsafe<Array<{ name: string }>>(
        `SELECT name FROM ${this.tables.roles}`
      );
      for (const current of currentRoles) {
        if (!nextNames.has(current.name)) {
          await this.deleteRole(current.name);
        }
      }
      await this.saveRegistry(registry);
      return { committed: true, revision: expectedRevision + 1 };
    });
  }

  async loadRegistry(): Promise<RoleRegistry> {
    const registry = new RoleRegistry();
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const { rights, roleInheritance, roleRights, roles } = this.tables;

    // Roles left-joined onto their mapped rights: one row per mapping, and a
    // single row with null right columns for roles that have none.
    type RoleRightJoinRow = Omit<RightsRow, 'id'> & {
      id: number | null;
      role_id: number;
      role_name: string;
    };

    const roleRightRows = (await this.sql.unsafe(`
      SELECT
        role.id AS role_id,
        role.name AS role_name,
        mapped_right.*
      FROM ${roles} role
      LEFT JOIN ${roleRights} role_right
        ON role_right.role_id = role.id
      LEFT JOIN ${rights} mapped_right
        ON mapped_right.id = role_right.right_id
      ORDER BY role.id, mapped_right.id
    `)) as RoleRightJoinRow[];

    const roleMap = new Map<number, Role>();
    for (const row of roleRightRows) {
      let role = roleMap.get(row.role_id);
      if (!role) {
        role = registry.define(row.role_name);
        roleMap.set(row.role_id, role);
      }

      if (row.id !== null) {
        role.rights.add(this.rowToRight(row as RightsRow));
      }
    }

    const inheritRows = await this.sql!.unsafe(
      `SELECT child_role_id, parent_role_id FROM ${roleInheritance}`
    );

    for (const ir of inheritRows) {
      const inheritanceRow = ir as RoleInheritanceRow;
      const childRole = roleMap.get(inheritanceRow.child_role_id);
      const parentRole = roleMap.get(inheritanceRow.parent_role_id);

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

  async loadSubject(
    identifier: string,
    registry?: RoleRegistry
  ): Promise<Subject | null> {
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const { rights, roles, subjectRights, subjectRoles, subjects } =
      this.tables;
    const subjectRoleRows = (await this.sql.unsafe(
      `
      SELECT
        subject.id AS subject_id,
        role.name AS role_name
      FROM ${subjects} subject
      LEFT JOIN ${subjectRoles} subject_role
        ON subject_role.subject_id = subject.id
      LEFT JOIN ${roles} role
        ON role.id = subject_role.role_id
      WHERE subject.identifier = $1
      ORDER BY role.id
      `,
      [identifier]
    )) as Array<{ role_name: string | null; subject_id: number }>;

    const [subjectRow] = subjectRoleRows;
    if (!subjectRow) {
      return null;
    }

    const subject = new Subject();
    const reg = registry ?? (await this.loadRegistry());
    const roleNames = subjectRoleRows
      .map(row => row.role_name)
      .filter((roleName): roleName is string => roleName !== null);
    this.applyRolesToSubject(subject, roleNames, reg);

    const subjectRightRows = await this.sql.unsafe(
      `
      SELECT mapped_right.*
      FROM ${subjectRights} subject_right
      JOIN ${rights} mapped_right ON mapped_right.id = subject_right.right_id
      WHERE subject_right.subject_id = $1
      ORDER BY mapped_right.id
      `,
      [subjectRow.subject_id]
    );

    for (const row of subjectRightRows) {
      subject.rights.add(this.rowToRight(row as RightsRow));
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
   * Load all subjects with their identifiers, direct rights, and hydrated roles.
   */
  async loadSubjects(): Promise<SubjectWithIdentifier[]> {
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const { rights, roles, subjectRights, subjectRoles, subjects } =
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

    const registry = await this.loadRegistry();

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

      // Add roles with their (inherited) rights
      this.applyRolesToSubject(
        subject,
        subjectRolesMap.get(subjectId) ?? [],
        registry
      );

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
   * Load subjects with pagination, direct rights, and hydrated roles.
   */
  async loadSubjectsPaginated(
    options: PaginationOptions
  ): Promise<PaginatedResult<SubjectWithIdentifier>> {
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const { page, pageSize } = options;
    const offset = (page - 1) * pageSize;

    const { rights, roles, subjectRights, subjectRoles, subjects } =
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

    const registry = await this.loadRegistry();

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

      // Add roles with their (inherited) rights
      this.applyRolesToSubject(
        subject,
        subjectRolesMap.get(subjectId) ?? [],
        registry
      );

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
