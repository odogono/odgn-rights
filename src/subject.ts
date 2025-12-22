import { Flags } from './constants';
import { Right, type ConditionContext } from './right';
import { Rights } from './rights';
import { Role } from './role';

export class Subject {
  private roles: Role[] = [];
  readonly rights: Rights = new Rights();
  private _aggregate: Rights | null = null;
  private _aggregateMeta: Map<
    Right,
    { name?: string; type: 'direct' | 'role' }
  > | null = null;

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

    const res = this._aggregate.explain(path, flag, context);
    return {
      allowed: res.allowed,
      details: res.details.map(d => ({
        ...d,
        source: d.right ? this._aggregateMeta!.get(d.right) : undefined
      }))
    };
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
}
