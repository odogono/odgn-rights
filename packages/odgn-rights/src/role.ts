import { Right } from './right';
import { Rights } from './rights';
import type { RoleJSON } from './role-registry';
import { SealedError } from './sealed';

export class Role {
  readonly name: string;
  readonly rights: Rights;
  readonly parents: Role[] = [];
  private children: Role[] = [];
  private _sealed = false;
  private _cachedAllRights: Array<{
    right: Right;
    source?: { name: string; type: 'role' };
  }> | null = null;

  constructor(name: string, rights?: Rights) {
    this.name = name;
    this.rights = rights ?? new Rights();
    this.rights.onChange = () => this.invalidateCache();
  }

  /**
   * Stop further changes to this role's rights and parents, and seal every
   * role it inherits from, since their rights reach it. The parents array is
   * frozen, so writing to it directly throws a TypeError.
   */
  seal(): this {
    if (this._sealed) {
      return this;
    }
    this._sealed = true;
    this.rights.seal();
    Object.freeze(this.parents);
    // Drop a list built before sealing, so the next allRights() builds a
    // frozen one.
    this._cachedAllRights = null;
    for (const parent of this.parents) {
      parent.seal();
    }
    return this;
  }

  get isSealed(): boolean {
    return this._sealed;
  }

  private assertNotSealed(): void {
    if (this._sealed) {
      throw new SealedError(`Role ${this.name}`);
    }
  }

  inheritsFrom(role: Role): this {
    this.assertNotSealed();
    // Inheriting adds this role to the parent's children, which changes it.
    role.assertNotSealed();
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
   * Remove a single parent role relationship.
   * @returns This role, whether or not the parent was present.
   */
  removeParent(role: Role): this {
    const idx = this.parents.indexOf(role);
    if (idx === -1) {
      return this;
    }
    this.assertNotSealed();
    this.parents.splice(idx, 1);
    const childIdx = role.children.indexOf(this);
    if (childIdx !== -1) {
      role.children.splice(childIdx, 1);
    }
    this.invalidateCache();
    return this;
  }

  /**
   * Clear all parent role relationships.
   * Useful when setting a new inheritance list.
   */
  clearParents(): this {
    if (this.parents.length === 0) {
      return this;
    }
    this.assertNotSealed();
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
    // A sealed role's list is shared by every reader, so freeze it and its
    // entries.
    if (this._sealed) {
      for (const entry of list) {
        if (entry.source) {
          Object.freeze(entry.source);
        }
        Object.freeze(entry);
      }
      Object.freeze(list);
    }
    this._cachedAllRights = list;
    return this._cachedAllRights;
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
