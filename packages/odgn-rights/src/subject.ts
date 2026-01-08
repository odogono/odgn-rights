import { Flags } from './constants';
import { Right, type ConditionContext } from './right';
import { Rights, type RightJSON } from './rights';
import { Role } from './role';
import type { RoleRegistry } from './role-registry';

export type SubjectJSON = {
  rights?: RightJSON[];
  roles?: string[];
};

export class Subject {
  readonly roles: Role[] = [];
  readonly rights: Rights = new Rights();
  private _aggregate: Rights | null = null;
  private _aggregateMeta: Map<
    Right,
    { name?: string; type: 'direct' | 'role' }
  > | null = null;

  toJSON(): SubjectJSON {
    const out: SubjectJSON = {};
    if (this.roles.length > 0) {
      out.roles = this.roles.map(r => r.name);
    }
    const rights = this.rights.toJSON();
    if (rights.length > 0) {
      out.rights = rights;
    }
    return out;
  }

  static fromJSON(data: SubjectJSON, registry?: RoleRegistry): Subject {
    const subject = new Subject();
    if (data.roles && registry) {
      for (const roleName of data.roles) {
        const role = registry.get(roleName);
        if (role) {
          subject.memberOf(role);
        }
      }
    }
    if (data.rights) {
      const rights = Rights.fromJSON(data.rights);
      for (const r of rights.allRights()) {
        subject.rights.add(r);
      }
    }
    return subject;
  }

  memberOf(role: Role): this {
    if (!this.roles.includes(role)) {
      this.roles.push(role);
      this.invalidateCache();
    }
    return this;
  }

  invalidateCache(): void {
    this._aggregate = null;
    this._aggregateMeta = null;
  }

  has(path: string, flag: Flags, context?: ConditionContext): boolean {
    return this.explain(path, flag, context).allowed;
  }

  explain(
    path: string,
    flag: Flags,
    context?: ConditionContext
  ): {
    allowed: boolean;
    details: Array<{
      allowed: boolean;
      bit: Flags;
      right?: Right;
      source?: { name?: string; type: 'direct' | 'role' };
    }>;
  } {
    const { meta, rights } = this.ensureAggregate();
    const res = rights.explain(path, flag, context);
    return {
      allowed: res.allowed,
      details: res.details.map(d => ({
        ...d,
        source: d.right ? meta.get(d.right) : undefined
      }))
    };
  }

  allRights(): Array<{
    right: Right;
    source?: { name?: string; type: 'direct' | 'role' };
  }> {
    const { meta, rights } = this.ensureAggregate();
    return rights.allRights().map(right => ({
      right,
      source: meta.get(right)
    }));
  }

  private ensureAggregate(): {
    meta: Map<Right, { name?: string; type: 'direct' | 'role' }>;
    rights: Rights;
  } {
    if (!this._aggregate) {
      this._aggregate = new Rights();
      this._aggregateMeta = new Map<
        Right,
        { name?: string; type: 'direct' | 'role' }
      >();

      // Add rights from roles
      for (const role of this.roles) {
        for (const entry of role.allRights()) {
          this._aggregate.add(entry.right);
          if (entry.source) {
            this._aggregateMeta.set(entry.right, entry.source);
          }
        }
      }

      // Add direct rights
      for (const r of this.rights.allRights()) {
        this._aggregate.add(r);
        this._aggregateMeta.set(r, { type: 'direct' });
      }
    }
    return { meta: this._aggregateMeta!, rights: this._aggregate };
  }

  // Convenience helpers
  all(path: string, context?: ConditionContext): boolean {
    return this.has(path, Flags.ALL, context);
  }
  read(path: string, context?: ConditionContext): boolean {
    return this.has(path, Flags.READ, context);
  }
  write(path: string, context?: ConditionContext): boolean {
    return this.has(path, Flags.WRITE, context);
  }
  delete(path: string, context?: ConditionContext): boolean {
    return this.has(path, Flags.DELETE, context);
  }
  create(path: string, context?: ConditionContext): boolean {
    return this.has(path, Flags.CREATE, context);
  }
  execute(path: string, context?: ConditionContext): boolean {
    return this.has(path, Flags.EXECUTE, context);
  }

  checkMany(
    requests: Array<{ flags: Flags; path: string }>,
    context?: ConditionContext
  ): boolean[] {
    return requests.map(req => this.has(req.path, req.flags, context));
  }
}
