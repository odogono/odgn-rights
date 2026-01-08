import { Right } from './right';
import { Rights } from './rights';
import type { RoleJSON } from './role-registry';

export class Role {
  readonly name: string;
  readonly rights: Rights;
  readonly parents: Role[] = [];
  private children: Role[] = [];
  private _cachedAllRights: Array<{
    right: Right;
    source?: { name: string; type: 'role' };
  }> | null = null;

  constructor(name: string, rights?: Rights) {
    this.name = name;
    this.rights = rights ?? new Rights();
    this.rights.onChange = () => this.invalidateCache();
  }

  inheritsFrom(role: Role): this {
    if (role === this) {
      throw new Error(`Role ${this.name} cannot inherit from itself`);
    }
    if (!this.parents.includes(role)) {
      this.parents.push(role);
      role.children.push(this);
      this.invalidateCache();
    }
    return this;
  }

  /**
   * Clear all parent role relationships.
   * Useful when setting a new inheritance list.
   */
  clearParents(): this {
    // Remove this role from each parent's children list
    for (const parent of this.parents) {
      const idx = parent.children.indexOf(this);
      if (idx !== -1) {
        parent.children.splice(idx, 1);
      }
    }
    // Clear parents array
    this.parents.length = 0;
    this.invalidateCache();
    return this;
  }

  /**
   * Returns all rights associated with this role, including inherited ones.
   */
  allRights(): Array<{
    right: Right;
    source?: { name: string; type: 'role' };
  }> {
    if (this._cachedAllRights) {
      return this._cachedAllRights;
    }
    const list: Array<{
      right: Right;
      source?: { name: string; type: 'role' };
    }> = this.rights.allRights().map(r => ({
      right: r,
      source: { name: this.name, type: 'role' as const }
    }));
    for (const parent of this.parents) {
      list.push(...parent.allRights());
    }
    this._cachedAllRights = list;
    return list;
  }

  findRightsByTag(tag: string): Right[] {
    return this.allRights()
      .map(r => r.right)
      .filter(r => r.hasTag(tag));
  }

  invalidateCache(): void {
    this._cachedAllRights = null;
    for (const child of this.children) {
      child.invalidateCache();
    }
  }

  toJSON(): RoleJSON {
    const out: RoleJSON = {
      name: this.name,
      rights: this.rights.toJSON()
    };
    if (this.parents.length > 0) {
      out.inherits = this.parents.map(p => p.name);
    }
    return out;
  }
}
