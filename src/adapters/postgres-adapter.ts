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
  RightsRow,
  RoleInheritanceRow,
  RoleRow
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
      registry.define(role.name, role.rights);

      const { roles: rolesTable } = this.tables;

      const [roleRow] = await this.sql!.unsafe(
        `SELECT id FROM ${rolesTable} WHERE name = $1`,
        [role.name]
      );

      if (roleRow) {
        roleMap.set(role.name, { id: roleRow.id, role });
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

  async findSubjectsWithAccess(
    pathPattern: string,
    flags: Flags
  ): Promise<string[]> {
    if (!this.sql) {
      throw new Error('Not connected');
    }

    const { subjects } = this.tables;
    const matchingSubjects: string[] = [];

    const allSubjects = await this.sql.unsafe(
      `SELECT identifier FROM ${subjects}`
    );

    for (const row of allSubjects) {
      const subjectRow = row as { identifier: string };
      const subject = await this.loadSubject(subjectRow.identifier);
      if (subject && subject.has(pathPattern, flags)) {
        matchingSubjects.push(subjectRow.identifier);
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
