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
  RightsRow,
  RoleInheritanceRow,
  RoleRightRow,
  RoleRow,
  SubjectRightRow,
  SubjectRoleRow,
  SubjectRow
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

  async loadRole(name: string): Promise<Role | null> {
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
    if (!this.db || !this.stmtSelectAllRoles) {
      throw new Error('Not connected');
    }

    const roleRows = this.stmtSelectAllRoles.all() as RoleRow[];
    const roles: Role[] = [];

    for (const roleRow of roleRows) {
      const role = await this.loadRole(roleRow.name);
      if (role) {
        roles.push(role);
      }
    }

    return roles;
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
      const registryRole = registry.define(role.name, role.rights);
      const roleRow = this.stmtSelectRoleByName?.get({
        $name: role.name
      }) as { id: number } | null;
      if (roleRow) {
        roleMap.set(role.name, { id: roleRow.id, role: registryRole });
        this.roleIdCache.set(role.name, roleRow.id);
      }
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

  async loadSubject(identifier: string): Promise<Subject | null> {
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

    const roleRows = this.stmtSelectSubjectRoles?.all({
      $subject_id: subjectRow.id
    }) as SubjectRoleRow[];

    if (roleRows) {
      for (const sr of roleRows) {
        const roleName = this.db!.prepare(
          `SELECT name FROM ${this.tables.roles} WHERE id = $id`
        ).get({ $id: sr.role_id }) as { name: string } | null;

        if (roleName) {
          const role = await this.loadRole(roleName.name);
          if (role) {
            subject.memberOf(role);
          }
        }
      }
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
