import { Database, type Statement } from 'bun:sqlite';

import { Right } from '../right';
import { Rights } from '../rights';
import { Role } from '../role';
import { RoleRegistry } from '../role-registry';
import { Subject } from '../subject';
import { BaseAdapter } from './base-adapter';
import { generateSQLiteSchema } from './schema';
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
  RoleRightRow,
  RoleRow,
  RoleSummaryQuery,
  SubjectRightRow,
  SubjectRoleRow,
  SubjectRow,
  SubjectWithIdentifier
} from './types';

export type SQLiteAdapterOptions = BaseAdapterOptions & {
  create?: boolean;
  enableWAL?: boolean;
  filename?: string;
  readonly?: boolean;
  strict?: boolean;
};

export class SQLiteAdapter extends BaseAdapter {
  private db: Database | null = null;
  private readonly options: SQLiteAdapterOptions;
  private roleIdCache: Map<string, number> = new Map();
  private transactionDepth = 0;

  private stmtInsertRight: Statement | null = null;
  private stmtSelectRightById: Statement | null = null;
  private stmtSelectAllRights: Statement | null = null;
  private stmtDeleteRight: Statement | null = null;

  private stmtInsertRole: Statement | null = null;
  private stmtSelectRoleByName: Statement | null = null;
  private stmtSelectAllRoles: Statement | null = null;
  private stmtSelectRoleById: Statement | null = null;
  private stmtDeleteRole: Statement | null = null;

  private stmtInsertRoleRight: Statement | null = null;
  private stmtDeleteRoleRights: Statement | null = null;
  private stmtSelectRoleRights: Statement | null = null;

  private stmtInsertRoleInheritance: Statement | null = null;
  private stmtDeleteRoleInheritance: Statement | null = null;
  private stmtDeleteChildInheritance: Statement | null = null;
  private stmtSelectRoleInheritance: Statement | null = null;

  private stmtInsertSubject: Statement | null = null;
  private stmtSelectSubjectByIdentifier: Statement | null = null;
  private stmtUpdateSubject: Statement | null = null;
  private stmtDeleteSubject: Statement | null = null;

  private stmtInsertSubjectRole: Statement | null = null;
  private stmtDeleteSubjectRoles: Statement | null = null;
  private stmtSelectSubjectRoles: Statement | null = null;

  private stmtInsertSubjectRight: Statement | null = null;
  private stmtDeleteSubjectRights: Statement | null = null;
  private stmtSelectSubjectRights: Statement | null = null;

  constructor(options: SQLiteAdapterOptions = {}) {
    super(options);
    this.options = {
      create: true,
      enableWAL: false,
      filename: ':memory:',
      ...options
    };
  }

  async connect(): Promise<void> {
    this.db = new Database(this.options.filename!, {
      create: this.options.create,
      readonly: this.options.readonly,
      strict: this.options.strict
    });

    if (this.options.enableWAL) {
      this.db.run('PRAGMA journal_mode = WAL');
    }
  }

  prepareStatementsAfterMigration(): void {
    this.prepareStatements();
  }

  async disconnect(): Promise<void> {
    this.finalizeStatements();
    this.db?.close();
    this.db = null;
    this.roleIdCache.clear();
  }

  async migrate(): Promise<void> {
    if (!this.db) {
      throw new Error('Not connected');
    }
    this.db.run(generateSQLiteSchema(this.tables));
  }

  async enableWAL(): Promise<void> {
    if (!this.db) {
      throw new Error('Not connected');
    }
    this.db.run('PRAGMA journal_mode = WAL');
  }

  // ===========================================================================
  // Rights Operations
  // ===========================================================================

  async saveRight(right: Right): Promise<number> {
    if (!this.db || !this.stmtInsertRight) {
      throw new Error('Not connected');
    }

    const row = this.rightToRow(right);

    this.stmtInsertRight.run({
      $allow_mask: row.allow_mask,
      $deny_mask: row.deny_mask,
      $description: row.description,
      $path: row.path,
      $priority: row.priority,
      $tags: row.tags,
      $valid_from: row.valid_from,
      $valid_until: row.valid_until
    });

    const result = this.db.query('SELECT last_insert_rowid() as id').get() as {
      id: number;
    };
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
    if (!this.db || !this.stmtSelectRightById) {
      throw new Error('Not connected');
    }

    const row = this.stmtSelectRightById.get({ $id: id }) as RightsRow | null;
    if (!row) {
      return null;
    }

    return this.rowToRight(row);
  }

  async loadRights(): Promise<Rights> {
    if (!this.db || !this.stmtSelectAllRights) {
      throw new Error('Not connected');
    }

    const rows = this.stmtSelectAllRights.all() as RightsRow[];
    const loadedRights = new Rights();

    for (const row of rows) {
      loadedRights.add(this.rowToRight(row));
    }

    return loadedRights;
  }

  async loadRightsByPath(pathPattern: string): Promise<Rights> {
    if (!this.db) {
      throw new Error('Not connected');
    }

    const { rights: rightsTable } = this.tables;
    const pattern = pathPattern
      .replaceAll('%', String.raw`\%`)
      .replaceAll('_', String.raw`\_`);
    const sqlPattern = pattern.replaceAll('*', '%');

    const stmt = this.db.prepare(
      String.raw`SELECT * FROM ${rightsTable} WHERE path LIKE $pattern ESCAPE '\' ORDER BY id`
    );

    const rows = stmt.all({ $pattern: sqlPattern }) as RightsRow[];
    const loadedRights = new Rights();

    for (const row of rows) {
      loadedRights.add(this.rowToRight(row));
    }

    return loadedRights;
  }

  async deleteRight(id: number): Promise<boolean> {
    if (!this.db || !this.stmtDeleteRight) {
      throw new Error('Not connected');
    }

    const result = this.stmtDeleteRight.run({ $id: id });
    return result.changes > 0;
  }

  // ===========================================================================
  // Role Operations
  // ===========================================================================

  async saveRole(role: Role): Promise<number> {
    if (!this.db) {
      throw new Error('Not connected');
    }

    const { roles } = this.tables;

    return this.transaction(async () => {
      let roleId: number;

      const existing = this.db!.prepare(
        `SELECT id FROM ${roles} WHERE name = $name`
      ).get({ $name: role.name }) as { id: number } | null;

      if (existing) {
        roleId = existing.id;
        this.db!.prepare(
          `UPDATE ${roles} SET updated_at = datetime('now') WHERE id = $id`
        ).run({ $id: roleId });
      } else {
        this.db!.prepare(`INSERT INTO ${roles} (name) VALUES ($name)`).run({
          $name: role.name
        });
        const result = this.db!.query(
          'SELECT last_insert_rowid() as id'
        ).get() as { id: number };
        roleId = result.id;
      }

      this.roleIdCache.set(role.name, roleId);

      this.stmtDeleteRoleRights?.run({ $role_id: roleId });
      this.stmtDeleteChildInheritance?.run({ $child_role_id: roleId });

      for (const right of role.rights.allRights()) {
        const rightId = await this.saveRight(right);
        this.stmtInsertRoleRight?.run({
          $right_id: rightId,
          $role_id: roleId
        });
      }

      for (const parent of role.parents) {
        const parentId = await this.saveRole(parent);
        this.stmtInsertRoleInheritance?.run({
          $child_role_id: roleId,
          $parent_role_id: parentId
        });
      }

      return roleId;
    });
  }

  private async loadRoleDirect(name: string): Promise<Role | null> {
    if (!this.db || !this.stmtSelectRoleByName) {
      throw new Error('Not connected');
    }

    const roleRow = this.stmtSelectRoleByName.get({
      $name: name
    }) as RoleRow | null;
    if (!roleRow) {
      return null;
    }

    const rights = new Rights();
    const rightRows = this.stmtSelectRoleRights?.all({
      $role_id: roleRow.id
    }) as RoleRightRow[];

    if (rightRows) {
      for (const rr of rightRows) {
        const right = await this.loadRight(rr.right_id);
        if (right) {
          rights.add(right);
        }
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
    if (!this.db) {
      throw new Error('Not connected');
    }
    const { roleRegistryState, roles } = this.tables;
    const needle = query.name?.trim().toLocaleLowerCase() ?? '';
    // Read the rows and the revision in one transaction, so a competing
    // writer cannot commit between them and leave the caller holding stale
    // summaries stamped with the revision that replaced them.
    return this.transaction(async () => {
      // SQLite's lower() folds ASCII only, so filtering in SQL would miss
      // Unicode case variants that PostgreSQL's LOWER() and the Redis
      // adapter's JS folding both match. Filter in JS instead, using the same
      // folding as the needle, so all three backends agree.
      const allRows = this.db!.query(
        `SELECT name, created_at, updated_at
         FROM ${roles}
         ORDER BY created_at, name COLLATE NOCASE, name`
      ).all() as Array<{
        created_at: string;
        name: string;
        updated_at: string;
      }>;
      const rows = needle
        ? allRows.filter(row => row.name.toLocaleLowerCase().includes(needle))
        : allRows;
      const state = this.db!.query(
        `SELECT revision FROM ${roleRegistryState} WHERE singleton = 1`
      ).get() as { revision: number } | undefined;
      return {
        items: rows.map(row => ({
          createdAt: new Date(`${row.created_at}Z`).toISOString(),
          name: row.name,
          updatedAt: new Date(`${row.updated_at}Z`).toISOString()
        })),
        revision: state?.revision ?? 0
      };
    });
  }

  async deleteRole(name: string): Promise<boolean> {
    if (!this.db || !this.stmtDeleteRole) {
      throw new Error('Not connected');
    }

    const roleRow = this.stmtSelectRoleByName?.get({ $name: name }) as {
      id: number;
    } | null;
    if (roleRow) {
      this.roleIdCache.delete(name);
    }

    const result = this.stmtDeleteRole.run({ $name: name });
    return result.changes > 0;
  }

  // ===========================================================================
  // RoleRegistry Operations
  // ===========================================================================

  async saveRegistry(registry: RoleRegistry): Promise<void> {
    if (!this.db) {
      throw new Error('Not connected');
    }

    await this.transaction(async () => {
      for (const role of this.collectPersistedRoles(registry).values()) {
        await this.saveRole(role);
      }
      this.db!.run(
        `UPDATE ${this.tables.roleRegistryState} SET revision = revision + 1 WHERE singleton = 1`
      );
    });
  }

  async loadRegistrySnapshot(): Promise<RoleRegistrySnapshot> {
    return this.transaction(async () => {
      const registry = await this.loadRegistry();
      const state = this.db!.query(
        `SELECT revision FROM ${this.tables.roleRegistryState} WHERE singleton = 1`
      ).get() as { revision: number } | undefined;
      return { registry, revision: state?.revision ?? 0 };
    });
  }

  async saveRegistryIfRevision(
    registry: RoleRegistry,
    expectedRevision: number
  ): Promise<RegistryCommitResult> {
    return this.transaction(async () => {
      const state = this.db!.query(
        `SELECT revision FROM ${this.tables.roleRegistryState} WHERE singleton = 1`
      ).get() as { revision: number } | undefined;
      const revision = state?.revision ?? 0;
      if (revision !== expectedRevision) {
        return { committed: false, revision };
      }
      const nextNames = new Set(this.collectPersistedRoles(registry).keys());
      const currentNames = this.stmtSelectAllRoles!.all() as RoleRow[];
      for (const current of currentNames) {
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
    if (!this.db || !this.stmtSelectAllRoles) {
      throw new Error('Not connected');
    }

    const roles = this.stmtSelectAllRoles.all() as RoleRow[];
    const roleMap = new Map<string, { id: number; role: Role }>();

    for (const roleRow of roles) {
      const role = await this.loadRoleDirect(roleRow.name);
      if (!role) {
        continue;
      }

      const registryRole = registry.define(role.name, role.rights);
      roleMap.set(role.name, { id: roleRow.id, role: registryRole });
      this.roleIdCache.set(role.name, roleRow.id);
    }

    const { roleInheritance } = this.tables;
    const inheritRows = this.db
      ?.query(`SELECT child_role_id, parent_role_id FROM ${roleInheritance}`)
      .all() as RoleInheritanceRow[];

    if (inheritRows) {
      for (const ir of inheritRows) {
        let childRole: Role | undefined;
        let parentRole: Role | undefined;

        for (const [, data] of roleMap.entries()) {
          if (data.id === ir.child_role_id) {
            childRole = data.role;
          }
          if (data.id === ir.parent_role_id) {
            parentRole = data.role;
          }
        }

        if (childRole && parentRole) {
          childRole.inheritsFrom(parentRole);
        }
      }
    }

    return registry;
  }

  // ===========================================================================
  // Subject Operations
  // ===========================================================================

  async saveSubject(identifier: string, subject: Subject): Promise<number> {
    if (!this.db) {
      throw new Error('Not connected');
    }

    const { subjects } = this.tables;

    return this.transaction(async () => {
      let subjectId: number;

      const existing = this.db!.prepare(
        `SELECT id FROM ${subjects} WHERE identifier = $identifier`
      ).get({ $identifier: identifier }) as { id: number } | null;

      if (existing) {
        subjectId = existing.id;
        this.db!.prepare(
          `UPDATE ${subjects} SET updated_at = datetime('now') WHERE id = $id`
        ).run({ $id: subjectId });
      } else {
        this.db!.prepare(
          `INSERT INTO ${subjects} (identifier) VALUES ($identifier)`
        ).run({ $identifier: identifier });
        const result = this.db!.query(
          'SELECT last_insert_rowid() as id'
        ).get() as { id: number };
        subjectId = result.id;
      }

      this.stmtDeleteSubjectRoles?.run({ $subject_id: subjectId });
      this.stmtDeleteSubjectRights?.run({ $subject_id: subjectId });

      for (const role of subject.roles) {
        const roleId = await this.saveRole(role);
        this.stmtInsertSubjectRole?.run({
          $role_id: roleId,
          $subject_id: subjectId
        });
      }

      for (const right of subject.rights.allRights()) {
        const rightId = await this.saveRight(right);
        this.stmtInsertSubjectRight?.run({
          $right_id: rightId,
          $subject_id: subjectId
        });
      }

      return subjectId;
    });
  }

  async loadSubject(
    identifier: string,
    registry?: RoleRegistry
  ): Promise<Subject | null> {
    if (!this.db || !this.stmtSelectSubjectByIdentifier) {
      throw new Error('Not connected');
    }

    const subjectRow = this.stmtSelectSubjectByIdentifier.get({
      $identifier: identifier
    }) as SubjectRow | null;

    if (!subjectRow) {
      return null;
    }

    const subject = new Subject();
    const reg = registry ?? (await this.loadRegistry());

    const roleRows = this.stmtSelectSubjectRoles?.all({
      $subject_id: subjectRow.id
    }) as SubjectRoleRow[];

    if (roleRows) {
      const roleNames: string[] = [];
      for (const sr of roleRows) {
        const roleName = this.db!.prepare(
          `SELECT name FROM ${this.tables.roles} WHERE id = $id`
        ).get({ $id: sr.role_id }) as { name: string } | null;

        if (roleName) {
          roleNames.push(roleName.name);
        }
      }
      this.applyRolesToSubject(subject, roleNames, reg);
    }

    const rightRows = this.stmtSelectSubjectRights?.all({
      $subject_id: subjectRow.id
    }) as SubjectRightRow[];

    if (rightRows) {
      for (const sr of rightRows) {
        const right = await this.loadRight(sr.right_id);
        if (right) {
          subject.rights.add(right);
        }
      }
    }

    return subject;
  }

  async deleteSubject(identifier: string): Promise<boolean> {
    if (!this.db || !this.stmtDeleteSubject) {
      throw new Error('Not connected');
    }

    const result = this.stmtDeleteSubject.run({ $identifier: identifier });
    return result.changes > 0;
  }

  /**
   * Load all subjects with their identifiers, direct rights, and hydrated roles.
   */
  async loadSubjects(): Promise<SubjectWithIdentifier[]> {
    if (!this.db) {
      throw new Error('Not connected');
    }

    const { rights, roles, subjectRights, subjectRoles, subjects } =
      this.tables;

    // Query 1: Load all subjects
    const subjectRows = this.db
      .prepare(`SELECT id, identifier FROM ${subjects} ORDER BY id`)
      .all() as Array<{ id: number; identifier: string }>;

    if (subjectRows.length === 0) {
      return [];
    }

    // Query 2: Batch load all subject-role mappings with role names
    const subjectRoleRows = this.db
      .prepare(
        `SELECT sr.subject_id, r.name as role_name
         FROM ${subjectRoles} sr
         JOIN ${roles} r ON sr.role_id = r.id`
      )
      .all() as Array<{ role_name: string; subject_id: number }>;

    // Query 3: Batch load all subject direct rights
    const subjectRightRows = this.db
      .prepare(
        `SELECT sr.subject_id, rt.*
         FROM ${subjectRights} sr
         JOIN ${rights} rt ON sr.right_id = rt.id`
      )
      .all() as Array<{ subject_id: number } & RightsRow>;

    const registry = await this.loadRegistry();

    // Build subject -> roles mapping
    const subjectRolesMap = new Map<number, string[]>();
    for (const row of subjectRoleRows) {
      if (!subjectRolesMap.has(row.subject_id)) {
        subjectRolesMap.set(row.subject_id, []);
      }
      subjectRolesMap.get(row.subject_id)!.push(row.role_name);
    }

    // Build subject -> direct rights mapping
    const subjectDirectRightsMap = new Map<number, Rights>();
    for (const row of subjectRightRows) {
      if (!subjectDirectRightsMap.has(row.subject_id)) {
        subjectDirectRightsMap.set(row.subject_id, new Rights());
      }
      subjectDirectRightsMap.get(row.subject_id)!.add(this.rowToRight(row));
    }

    // Build result array
    const result: SubjectWithIdentifier[] = [];

    for (const row of subjectRows) {
      const subject = new Subject();

      // Add roles with their (inherited) rights
      this.applyRolesToSubject(
        subject,
        subjectRolesMap.get(row.id) ?? [],
        registry
      );

      // Add direct rights
      const directRights = subjectDirectRightsMap.get(row.id);
      if (directRights) {
        for (const right of directRights.allRights()) {
          subject.rights.add(right);
        }
      }

      result.push({ identifier: row.identifier, subject });
    }

    return result;
  }

  /**
   * Load subjects with pagination, direct rights, and hydrated roles.
   */
  async loadSubjectsPaginated(
    options: PaginationOptions
  ): Promise<PaginatedResult<SubjectWithIdentifier>> {
    if (!this.db) {
      throw new Error('Not connected');
    }

    const { page, pageSize } = options;
    const offset = (page - 1) * pageSize;

    const { rights, roles, subjectRights, subjectRoles, subjects } =
      this.tables;

    // Query 1: Get total count
    const countResult = this.db
      .prepare(`SELECT COUNT(*) as count FROM ${subjects}`)
      .get() as { count: number };
    const total = countResult.count;

    if (total === 0) {
      return { items: [], total: 0 };
    }

    // Query 2: Load paginated subjects
    const subjectRows = this.db
      .prepare(
        `SELECT id, identifier FROM ${subjects} ORDER BY id LIMIT $limit OFFSET $offset`
      )
      .all({ $limit: pageSize, $offset: offset }) as Array<{
      id: number;
      identifier: string;
    }>;

    if (subjectRows.length === 0) {
      return { items: [], total };
    }

    // Get subject IDs for filtering related data
    const subjectIds = subjectRows.map(row => row.id);
    const subjectIdsPlaceholders = subjectIds.map(() => '?').join(',');

    // Query 3: Batch load subject-role mappings for these subjects only
    const subjectRoleRows = this.db
      .prepare(
        `SELECT sr.subject_id, r.name as role_name
         FROM ${subjectRoles} sr
         JOIN ${roles} r ON sr.role_id = r.id
         WHERE sr.subject_id IN (${subjectIdsPlaceholders})`
      )
      .all(...subjectIds) as Array<{ role_name: string; subject_id: number }>;

    // Query 4: Batch load subject direct rights for these subjects only
    const subjectRightRows = this.db
      .prepare(
        `SELECT sr.subject_id, rt.*
         FROM ${subjectRights} sr
         JOIN ${rights} rt ON sr.right_id = rt.id
         WHERE sr.subject_id IN (${subjectIdsPlaceholders})`
      )
      .all(...subjectIds) as Array<{ subject_id: number } & RightsRow>;

    const registry = await this.loadRegistry();

    // Build subject -> roles mapping
    const subjectRolesMap = new Map<number, string[]>();
    for (const row of subjectRoleRows) {
      if (!subjectRolesMap.has(row.subject_id)) {
        subjectRolesMap.set(row.subject_id, []);
      }
      subjectRolesMap.get(row.subject_id)!.push(row.role_name);
    }

    // Build subject -> direct rights mapping
    const subjectDirectRightsMap = new Map<number, Rights>();
    for (const row of subjectRightRows) {
      if (!subjectDirectRightsMap.has(row.subject_id)) {
        subjectDirectRightsMap.set(row.subject_id, new Rights());
      }
      subjectDirectRightsMap.get(row.subject_id)!.add(this.rowToRight(row));
    }

    // Build result array
    const items: SubjectWithIdentifier[] = [];

    for (const row of subjectRows) {
      const subject = new Subject();

      // Add roles with their (inherited) rights
      this.applyRolesToSubject(
        subject,
        subjectRolesMap.get(row.id) ?? [],
        registry
      );

      // Add direct rights
      const directRights = subjectDirectRightsMap.get(row.id);
      if (directRights) {
        for (const right of directRights.allRights()) {
          subject.rights.add(right);
        }
      }

      items.push({ identifier: row.identifier, subject });
    }

    return { items, total };
  }

  // ===========================================================================
  // Utility
  // ===========================================================================

  async clear(): Promise<void> {
    if (!this.db) {
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

    this.db.run(`DELETE FROM ${subjectRights}`);
    this.db.run(`DELETE FROM ${subjectRoles}`);
    this.db.run(`DELETE FROM ${subjects}`);
    this.db.run(`DELETE FROM ${roleInheritance}`);
    this.db.run(`DELETE FROM ${roleRights}`);
    this.db.run(`DELETE FROM ${roles}`);
    this.db.run(`DELETE FROM ${rights}`);
    this.roleIdCache.clear();
  }

  async transaction<T>(
    fn: (adapter: DatabaseAdapter) => Promise<T>
  ): Promise<T> {
    if (!this.db) {
      throw new Error('Not connected');
    }

    const isNested = this.transactionDepth > 0;

    if (!isNested) {
      this.db.run('BEGIN IMMEDIATE TRANSACTION');
    }

    this.transactionDepth++;
    try {
      const result = await fn(this);
      this.transactionDepth--;

      if (!isNested) {
        this.db.run('COMMIT');
      }

      return result;
    } catch (error) {
      this.transactionDepth--;

      if (!isNested) {
        this.db.run('ROLLBACK');
      }

      throw error;
    }
  }

  // ===========================================================================
  // Prepared Statements
  // ===========================================================================

  private prepareStatements = (): void => {
    if (!this.db) {
      return;
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

    this.stmtInsertRight = this.db.prepare(`
      INSERT INTO ${rights} (path, allow_mask, deny_mask, priority, description, tags, valid_from, valid_until)
      VALUES ($path, $allow_mask, $deny_mask, $priority, $description, $tags, $valid_from, $valid_until)
    `);

    this.stmtSelectRightById = this.db.prepare(`
      SELECT * FROM ${rights} WHERE id = $id
    `);

    this.stmtSelectAllRights = this.db.prepare(`
      SELECT * FROM ${rights} ORDER BY id
    `);

    this.stmtDeleteRight = this.db.prepare(`
      DELETE FROM ${rights} WHERE id = $id
    `);

    this.stmtInsertRole = this.db.prepare(`
      INSERT INTO ${roles} (name) VALUES ($name)
    `);

    this.stmtSelectRoleByName = this.db.prepare(`
      SELECT * FROM ${roles} WHERE name = $name
    `);

    this.stmtSelectAllRoles = this.db.prepare(`
      SELECT * FROM ${roles} ORDER BY id
    `);

    this.stmtSelectRoleById = this.db.prepare(`
      SELECT * FROM ${roles} WHERE id = $id
    `);

    this.stmtDeleteRole = this.db.prepare(`
      DELETE FROM ${roles} WHERE name = $name
    `);

    this.stmtInsertRoleRight = this.db.prepare(`
      INSERT INTO ${roleRights} (role_id, right_id) VALUES ($role_id, $right_id)
    `);

    this.stmtDeleteRoleRights = this.db.prepare(`
      DELETE FROM ${roleRights} WHERE role_id = $role_id
    `);

    this.stmtSelectRoleRights = this.db.prepare(`
      SELECT right_id FROM ${roleRights} WHERE role_id = $role_id
    `);

    this.stmtInsertRoleInheritance = this.db.prepare(`
      INSERT INTO ${roleInheritance} (child_role_id, parent_role_id) VALUES ($child_role_id, $parent_role_id)
    `);

    this.stmtDeleteRoleInheritance = this.db.prepare(`
      DELETE FROM ${roleInheritance} WHERE child_role_id = $child_role_id AND parent_role_id = $parent_role_id
    `);

    this.stmtDeleteChildInheritance = this.db.prepare(`
      DELETE FROM ${roleInheritance} WHERE child_role_id = $child_role_id
    `);

    this.stmtSelectRoleInheritance = this.db.prepare(`
      SELECT child_role_id, parent_role_id FROM ${roleInheritance}
    `);

    this.stmtInsertSubject = this.db.prepare(`
      INSERT INTO ${subjects} (identifier) VALUES ($identifier)
    `);

    this.stmtSelectSubjectByIdentifier = this.db.prepare(`
      SELECT * FROM ${subjects} WHERE identifier = $identifier
    `);

    this.stmtUpdateSubject = this.db.prepare(`
      UPDATE ${subjects} SET updated_at = datetime('now') WHERE id = $id
    `);

    this.stmtDeleteSubject = this.db.prepare(`
      DELETE FROM ${subjects} WHERE identifier = $identifier
    `);

    this.stmtInsertSubjectRole = this.db.prepare(`
      INSERT INTO ${subjectRoles} (subject_id, role_id) VALUES ($subject_id, $role_id)
    `);

    this.stmtDeleteSubjectRoles = this.db.prepare(`
      DELETE FROM ${subjectRoles} WHERE subject_id = $subject_id
    `);

    this.stmtSelectSubjectRoles = this.db.prepare(`
      SELECT role_id FROM ${subjectRoles} WHERE subject_id = $subject_id
    `);

    this.stmtInsertSubjectRight = this.db.prepare(`
      INSERT INTO ${subjectRights} (subject_id, right_id) VALUES ($subject_id, $right_id)
    `);

    this.stmtDeleteSubjectRights = this.db.prepare(`
      DELETE FROM ${subjectRights} WHERE subject_id = $subject_id
    `);

    this.stmtSelectSubjectRights = this.db.prepare(`
      SELECT right_id FROM ${subjectRights} WHERE subject_id = $subject_id
    `);
  };

  private finalizeStatements = (): void => {
    this.stmtInsertRight?.finalize();
    this.stmtSelectRightById?.finalize();
    this.stmtSelectAllRights?.finalize();
    this.stmtDeleteRight?.finalize();

    this.stmtInsertRole?.finalize();
    this.stmtSelectRoleByName?.finalize();
    this.stmtSelectAllRoles?.finalize();
    this.stmtSelectRoleById?.finalize();
    this.stmtDeleteRole?.finalize();

    this.stmtInsertRoleRight?.finalize();
    this.stmtDeleteRoleRights?.finalize();
    this.stmtSelectRoleRights?.finalize();

    this.stmtInsertRoleInheritance?.finalize();
    this.stmtDeleteRoleInheritance?.finalize();
    this.stmtDeleteChildInheritance?.finalize();
    this.stmtSelectRoleInheritance?.finalize();

    this.stmtInsertSubject?.finalize();
    this.stmtSelectSubjectByIdentifier?.finalize();
    this.stmtUpdateSubject?.finalize();
    this.stmtDeleteSubject?.finalize();

    this.stmtInsertSubjectRole?.finalize();
    this.stmtDeleteSubjectRoles?.finalize();
    this.stmtSelectSubjectRoles?.finalize();

    this.stmtInsertSubjectRight?.finalize();
    this.stmtDeleteSubjectRights?.finalize();
    this.stmtSelectSubjectRights?.finalize();
  };
}
