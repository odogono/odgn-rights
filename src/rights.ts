import { ALL_BITS, Flags, hasBit } from './constants';
import { Right, type ConditionContext } from './right';
import { normalizePath } from './utils';

export type RightJSON = {
  allow: string;
  deny?: string;
  description?: string;
  path: string;
  validFrom?: string;
  validUntil?: string;
};

export class Rights {
  private list: Right[] = [];
  private matchCache = new Map<string, Right[]>();
  private _onChange?: () => void;

  set onChange(cb: () => void | undefined) {
    this._onChange = cb;
  }

  private notify() {
    this._onChange?.();
  }

  add(right: Right): this {
    this.list.push(right);
    this.matchCache.clear();
    this.notify();
    return this;
  }

  prune(now: Date = new Date()): this {
    const originalCount = this.list.length;
    this.list = this.list.filter(r => !r.isExpired(now));
    if (this.list.length !== originalCount) {
      this.matchCache.clear();
      this.notify();
    }
    return this;
  }

  allRights(): Right[] {
    return [...this.list];
  }

  allow(path: string, ...flags: Flags[]): this {
    const p = normalizePath(path);
    let r = this.list.find(x => x.path === p);
    if (!r) {
      r = new Right(p);
      this.list.push(r);
    } else {
      // Invalidate cache if we update an existing right
      this.matchCache.clear();
    }
    // Support spreading an array: allow(path, [Flags.READ] as any)
    const flat: Flags[] = ([] as Flags[]).concat(
      ...(flags as unknown as Flags[][])
    );
    for (const f of flat) {
      r.allow(f);
    }
    this.notify();
    return this;
  }

  deny(path: string, flag: Flags): this {
    const p = normalizePath(path);
    let r = this.list.find(x => x.path === p);
    if (!r) {
      r = new Right(p);
      this.list.push(r);
    } else {
      // Invalidate cache if we update an existing right
      this.matchCache.clear();
    }
    r.deny(flag);
    this.notify();
    return this;
  }

  private matchOrdered(path: string): Right[] {
    const cached = this.matchCache.get(path);
    if (cached) {
      return cached;
    }
    const result = this.list
      .filter(r => r.matches(path))
      .sort((a, b) => b.specificity() - a.specificity());
    this.matchCache.set(path, result);
    return result;
  }

  has(path: string, flag: Flags, context?: ConditionContext): boolean {
    // For composite masks, all bits must succeed
    let remaining = flag;
    for (const bit of ALL_BITS) {
      if (!hasBit(remaining, bit)) {
        continue;
      }
      const ok = this.hasSingle(path, bit, context);
      if (!ok) {
        return false;
      }
      remaining &= ~bit;
    }
    return true;
  }

  explain(
    path: string,
    flag: Flags,
    context?: ConditionContext
  ): {
    allowed: boolean;
    details: Array<{ allowed: boolean; bit: Flags; right?: Right }>;
  } {
    const p = normalizePath(path);
    const details: Array<{ allowed: boolean; bit: Flags; right?: Right }> = [];
    let allAllowed = true;

    for (const bit of ALL_BITS) {
      if (!hasBit(flag, bit)) {
        continue;
      }
      const res = this.explainSingle(p, bit, context);
      if (!res.allowed) {
        allAllowed = false;
      }
      details.push({ bit, ...res });
    }

    return { allowed: allAllowed, details };
  }

  private hasSingle(
    path: string,
    bit: Flags,
    context?: ConditionContext
  ): boolean {
    return this.explainSingle(path, bit, context).allowed;
  }

  private explainSingle(
    path: string,
    bit: Flags,
    context?: ConditionContext
  ): { allowed: boolean; right?: Right } {
    const now = getNow(context);
    const matches = this.matchOrdered(normalizePath(path));
    for (const r of matches) {
      if (!r.isValidAt(now)) {
        continue;
      }
      if (r.condition && !r.condition(context)) {
        continue;
      }
      if (hasBit(r.denyMaskValue, bit)) {
        return { allowed: false, right: r };
      }
      if (hasBit(r.allowMaskValue, bit)) {
        return { allowed: true, right: r };
      }
    }
    return { allowed: false };
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

  toString(): string {
    return this.list.map(r => r.toString()).join(', ');
  }

  toJSON(): RightJSON[] {
    return this.list.map(r => r.toJSON());
  }

  static fromJSON(arr: RightJSON[]): Rights {
    const rights = new Rights();
    for (const item of arr) {
      const p = normalizePath(item.path);
      const init: any = { description: item.description };
      if (item.validFrom) {
        const d = new Date(item.validFrom);
        if (!isNaN(d.getTime())) {
          init.validFrom = d;
        }
      }
      if (item.validUntil) {
        const d = new Date(item.validUntil);
        if (!isNaN(d.getTime())) {
          init.validUntil = d;
        }
      }
      const r = new Right(p, init);
      const allowStr = item.allow;
      const denyStr = item.deny;

      const applyFlags = (str: string, apply: (f: Flags) => void) => {
        if (str === '*') {
          apply(Flags.ALL);
        } else {
          for (const ch of str) {
            switch (ch) {
              case 'r':
                apply(Flags.READ);
                break;
              case 'w':
                apply(Flags.WRITE);
                break;
              case 'c':
                apply(Flags.CREATE);
                break;
              case 'd':
                apply(Flags.DELETE);
                break;
              case 'x':
                apply(Flags.EXECUTE);
                break;
            }
          }
        }
      };

      if (allowStr) {
        applyFlags(allowStr, f => r.allow(f));
      }
      if (denyStr) {
        applyFlags(denyStr, f => r.deny(f));
      }

      rights.add(r);
    }
    return rights;
  }

  static parse(input: string): Rights {
    const rights = new Rights();
    if (!input) {
      return rights;
    }
    const parts = input.split(/[\n\r,?]+/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) {
        continue;
      }
      const r = Right.parse(trimmed);
      rights.add(r);
    }
    return rights;
  }

  format(separator = ', '): string {
    return this.list.map(r => r.toString()).join(separator);
  }
}

function getNow(context?: ConditionContext): Date {
  if (
    context &&
    typeof context === 'object' &&
    '_now' in context &&
    (context as any)._now instanceof Date
  ) {
    return (context as any)._now;
  }
  return new Date();
}
