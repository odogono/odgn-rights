export const Flags = {
  EXECUTE: 16,
  READ: 1,
  // eslint-disable-next-line perfectionist/sort-objects
  DELETE: 4,
  // eslint-disable-next-line perfectionist/sort-objects
  CREATE: 8,

  WRITE: 2,
  // eslint-disable-next-line perfectionist/sort-objects
  ALL: 31
} as const;

export type Flags = (typeof Flags)[keyof typeof Flags];

export type Condition = (context?: any) => boolean;

const ALL_BITS: Flags[] = [
  Flags.READ,
  Flags.WRITE,
  Flags.DELETE,
  Flags.CREATE,
  Flags.EXECUTE
];

type RightInit = {
  allow?: Flags[];
  deny?: Flags[];
  description?: string;
  condition?: Condition;
};

const hasBit = (mask: number, bit: number) => (mask & bit) === bit;

const normalizePath = (p: string): string => {
  if (!p) {
    return '/';
  }
  let out = p.trim();
  if (!out.startsWith('/')) {
    out = '/' + out;
  }
  out = out.replace(/\/+/, '/');
  out = out.replaceAll(/\/+/g, '/');
  if (out.length > 1 && out.endsWith('/')) {
    out = out.slice(0, -1);
  }
  return out;
};

// Map flags to display letters.
const letterForFlag = (flag: Flags): 'r' | 'w' | 'c' | 'd' | 'x' => {
  switch (flag) {
    case Flags.READ:
      return 'r';
    case Flags.WRITE:
      return 'w';
    case Flags.DELETE:
      return 'd';
    case Flags.CREATE:
      return 'c';
    case Flags.EXECUTE:
      return 'x';
    default:
      return 'x';
  }
};

const lettersFromMask = (mask: number): string => {
  if (mask === Flags.ALL) {
    return '*';
  }
  const letters: string[] = [];
  if (hasBit(mask, Flags.READ)) {
    letters.push('r');
  }
  if (hasBit(mask, Flags.WRITE)) {
    letters.push('w');
  }
  if (hasBit(mask, Flags.CREATE)) {
    letters.push('c');
  }
  if (hasBit(mask, Flags.DELETE)) {
    letters.push('d');
  }
  if (hasBit(mask, Flags.EXECUTE)) {
    letters.push('x');
  }
  return letters.join('');
};

export class Right {
  readonly path: string;
  private allowMask = 0;
  private denyMask = 0;
  readonly description?: string;
  readonly condition?: Condition;
  private readonly _specificity: number;
  private readonly _re?: RegExp;

  constructor(path: string, init?: RightInit) {
    this.path = normalizePath(path);
    this.description = init?.description;
    this.condition = init?.condition;
    this._specificity = this.calculateSpecificity();
    if (this.path.includes('*') || this.path.includes('?')) {
      this._re = Right.globToRegExp(this.path);
    }
    if (init?.allow) {
      init.allow.forEach(f => this.allow(f));
    }
    if (init?.deny) {
      init.deny.forEach(f => this.deny(f));
    }
  }

  allow(flag: Flags): this {
    this.allowMask |= flag;
    // allowing a flag clears it from deny
    this.denyMask &= ~flag;
    return this;
  }

  deny(flag: Flags): this {
    this.denyMask |= flag;
    // denying a flag clears it from allow
    this.allowMask &= ~flag;
    return this;
  }

  clear(): this {
    this.allowMask = 0;
    this.denyMask = 0;
    return this;
  }

  has(flag: Flags): boolean {
    // For composite masks, require all bits
    let remaining = flag;
    for (const bit of ALL_BITS) {
      if (!hasBit(remaining, bit)) {
        continue;
      }
      if (hasBit(this.denyMask, bit)) {
        return false;
      }
      if (!hasBit(this.allowMask, bit)) {
        return false;
      }
      remaining &= ~bit;
    }
    return true;
  }

  get allowMaskValue(): number {
    return this.allowMask;
  }

  get denyMaskValue(): number {
    return this.denyMask;
  }

  toString(): string {
    const denyLetters = lettersFromMask(this.denyMask);
    const allowLetters = lettersFromMask(this.allowMask);
    const parts: string[] = [];
    if (denyLetters) {
      parts.push(`-${denyLetters}`);
    }
    if (allowLetters) {
      parts.push(`+${allowLetters}`);
    }
    const left = parts.join('');
    return `${left}:${this.path}`;
  }

  toJSON(): { allow: string; description?: string; path: string } {
    const allow = lettersFromMask(this.allowMask);
    const out: { allow: string; description?: string; path: string } = {
      allow,
      path: this.path
    };
    if (this.description) {
      out.description = this.description;
    }
    return out;
  }

  // Pattern match helper
  matches(targetPath: string): boolean {
    const t = normalizePath(targetPath);
    if (this._re) {
      return this._re.test(t);
    }
    // No wildcard: segment-aware prefix match
    if (this.path === '/') {
      return true;
    }
    return t === this.path || t.startsWith(this.path + '/');
  }

  // Specificity score: more non-wildcard chars => more specific
  specificity(): number {
    return this._specificity;
  }

  private calculateSpecificity(): number {
    const parts = this.path.split('/').filter(p => p.length > 0);
    let literalCount = 0;
    let literalLen = 0;
    for (const p of parts) {
      if (!p.includes('*')) {
        literalCount += 1;
        literalLen += p.length;
      }
    }
    // Prioritize by number of literal segments, then by total literal length
    return literalCount * 1000 + literalLen;
  }

  private static globToRegExp(pattern: string): RegExp {
    // Convert a path glob with '**', '*', '?' into a safe anchored RegExp
    let out = '^';
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      if (!ch) {
        continue;
      }
      if (ch === '*') {
        let starCount = 1;
        while (i + 1 < pattern.length && pattern[i + 1] === '*') {
          starCount++;
          i++;
        }

        out += starCount >= 2 ? '.*' : '[^/]*';
        continue;
      }
      if (ch === '?') {
        out += '[^/]';
        continue;
      }
      // Escape regex specials
      out += String.raw`\^$+.?()|{}[]`.includes(ch) ? '\\' + ch : ch;
    }
    out += '$';
    return new RegExp(out);
  }

  static parse(input: string): Right {
    const s = input.trim();
    const idx = s.indexOf(':');
    if (idx === -1) {
      return new Right(s);
    }
    const groups = s.slice(0, idx);
    const path = s.slice(idx + 1);
    const r = new Right(path);
    // parse groups like '-abc+xyz' or '+xyz-abc'
    let i = 0;
    while (i < groups.length) {
      const sign = groups[i];
      if (sign !== '+' && sign !== '-') {
        i++;
        continue;
      }
      i++;
      let letters = '';
      while (i < groups.length && groups[i] !== '+' && groups[i] !== '-') {
        letters += groups[i];
        i++;
      }
      const apply =
        sign === '+' ? (f: Flags) => r.allow(f) : (f: Flags) => r.deny(f);
      if (letters === '*') {
        apply(Flags.ALL);
        continue;
      }
      for (const ch of letters) {
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
    return r;
  }
}

export class Rights {
  private list: Right[] = [];
  private matchCache = new Map<string, Right[]>();

  add(right: Right): this {
    this.list.push(right);
    this.matchCache.clear();
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
      this.add(r);
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
    return this;
  }

  deny(path: string, flag: Flags): this {
    const p = normalizePath(path);
    let r = this.list.find(x => x.path === p);
    if (!r) {
      r = new Right(p);
      this.add(r);
    } else {
      // Invalidate cache if we update an existing right
      this.matchCache.clear();
    }
    r.deny(flag);
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

  has(path: string, flag: Flags, context?: any): boolean {
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
    context?: any
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

  private hasSingle(path: string, bit: Flags, context?: any): boolean {
    return this.explainSingle(path, bit, context).allowed;
  }

  private explainSingle(
    path: string,
    bit: Flags,
    context?: any
  ): { allowed: boolean; right?: Right } {
    const matches = this.matchOrdered(normalizePath(path));
    for (const r of matches) {
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
  all(path: string, context?: any): boolean {
    return this.has(path, Flags.ALL, context);
  }
  read(path: string, context?: any): boolean {
    return this.has(path, Flags.READ, context);
  }
  write(path: string, context?: any): boolean {
    return this.has(path, Flags.WRITE, context);
  }
  delete(path: string, context?: any): boolean {
    return this.has(path, Flags.DELETE, context);
  }
  create(path: string, context?: any): boolean {
    return this.has(path, Flags.CREATE, context);
  }
  execute(path: string, context?: any): boolean {
    return this.has(path, Flags.EXECUTE, context);
  }

  toString(): string {
    return this.list
      .map(r => `+${lettersFromMask(r.allowMaskValue)}:${r.path}`)
      .join(', ');
  }

  toJSON(): Array<{ allow: string; description?: string; path: string }> {
    return this.list.map(r => r.toJSON());
  }

  static fromJSON(
    arr: Array<{ allow: string; description?: string; path: string }>
  ): Rights {
    const rights = new Rights();
    for (const item of arr) {
      const p = normalizePath(item.path);
      const r = new Right(p, { description: item.description });
      const allowStr = item.allow;
      if (allowStr === '*') {
        r.allow(Flags.ALL);
      } else {
        for (const ch of allowStr) {
          switch (ch) {
            case 'r':
              r.allow(Flags.READ);
              break;
            case 'w':
              r.allow(Flags.WRITE);
              break;
            case 'c':
              r.allow(Flags.CREATE);
              break;
            case 'd':
              r.allow(Flags.DELETE);
              break;
            case 'x':
              r.allow(Flags.EXECUTE);
              break;
          }
        }
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

export class Role {
  readonly name: string;
  readonly rights: Rights;
  private parents: Role[] = [];
  private _cachedAllRights: Array<{
    right: Right;
    source?: { name: string; type: 'role' };
  }> | null = null;

  constructor(name: string, rights?: Rights) {
    this.name = name;
    this.rights = rights ?? new Rights();
  }

  inheritsFrom(role: Role): this {
    if (role === this) {
      throw new Error(`Role ${this.name} cannot inherit from itself`);
    }
    if (!this.parents.includes(role)) {
      this.parents.push(role);
      this.invalidateCache();
    }
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

  invalidateCache(): void {
    this._cachedAllRights = null;
  }

  toJSON(): any {
    const out: any = {
      name: this.name,
      rights: this.rights.toJSON()
    };
    if (this.parents.length > 0) {
      out.inherits = this.parents.map(p => p.name);
    }
    return out;
  }
}

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

  has(path: string, flag: Flags, context?: any): boolean {
    return this.explain(path, flag, context).allowed;
  }

  explain(
    path: string,
    flag: Flags,
    context?: any
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
  all(path: string, context?: any): boolean {
    return this.has(path, Flags.ALL, context);
  }
  read(path: string, context?: any): boolean {
    return this.has(path, Flags.READ, context);
  }
  write(path: string, context?: any): boolean {
    return this.has(path, Flags.WRITE, context);
  }
  delete(path: string, context?: any): boolean {
    return this.has(path, Flags.DELETE, context);
  }
  create(path: string, context?: any): boolean {
    return this.has(path, Flags.CREATE, context);
  }
  execute(path: string, context?: any): boolean {
    return this.has(path, Flags.EXECUTE, context);
  }
}

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

  toJSON(): any {
    return Array.from(this.roles.values()).map(r => r.toJSON());
  }

  static fromJSON(data: any[]): RoleRegistry {
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
          }
        }
      }
    }

    return registry;
  }
}
