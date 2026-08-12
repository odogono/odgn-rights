import type { DatabaseAdapter } from './adapters/types';
import { Rights, type RightJSON } from './rights';
import { Role } from './role';

export type RoleJSON = {
  inherits?: string[];
  name: string;
  rights: RightJSON[];
};

export class RoleRegistry {
  private roles: Map<string, Role> = new Map();

  define(name: string, rights?: Rights): Role {
    let role = this.roles.get(name);
    if (!role) {
      role = new Role(name, rights);
      this.roles.set(name, role);
    } else if (rights) {
      for (const r of rights.allRights()) {
        role.rights.add(r);
      }
    }
    return role;
  }

  get(name: string): Role | undefined {
    return this.roles.get(name);
  }

  /**
   * Return all registered roles in definition order.
   */
  getAll(): Role[] {
    return Array.from(this.roles.values());
  }

  /**
   * Remove a role and any inheritance edges that point to it.
   */
  delete(name: string): boolean {
    const removed = this.roles.get(name);
    if (!removed) {
      return false;
    }
    this.roles.delete(name);
    for (const role of this.roles.values()) {
      role.removeParent(removed);
    }
    return true;
  }

  toJSON(): RoleJSON[] {
    return this.getAll().map(r => r.toJSON());
  }

  /**
   * Load all roles and their relationships from a database adapter
   */
  static async loadFrom(adapter: DatabaseAdapter): Promise<RoleRegistry> {
    return adapter.loadRegistry();
  }

  /**
   * Save all roles and their relationships to a database adapter
   */
  async saveTo(adapter: DatabaseAdapter): Promise<void> {
    await adapter.saveRegistry(this);
  }

  static fromJSON(data: RoleJSON[]): RoleRegistry {
    const registry = new RoleRegistry();

    // First pass: create all roles
    for (const item of data) {
      registry.define(
        item.name,
        item.rights ? Rights.fromJSON(item.rights) : undefined
      );
    }

    // Second pass: resolve inheritance
    for (const item of data) {
      const role = registry.get(item.name)!;
      if (item.inherits) {
        for (const parentName of item.inherits) {
          const parent = registry.get(parentName);
          if (parent) {
            role.inheritsFrom(parent);
          } else {
            throw new Error(
              `Role ${item.name} inherits from missing role ${parentName}`
            );
          }
        }
      }
    }

    return registry;
  }
}
