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

  toJSON(): RoleJSON[] {
    return Array.from(this.roles.values()).map(r => r.toJSON());
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
