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

  constructor(path: string, init?: RightInit) {
    this.path = normalizePath(path);
    this.description = init?.description;
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
    if (this.path.includes('*') || this.path.includes('?')) {
      const re = Right.globToRegExp(this.path);
      return re.test(t);
    }
    // No wildcard: segment-aware prefix match
    if (this.path === '/') {
      return true;
    }
    return t === this.path || t.startsWith(this.path + '/');
  }

  // Specificity score: more non-wildcard chars => more specific
  specificity(): number {
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

  add(right: Right): this {
    this.list.push(right);
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
    }
    r.deny(flag);
    return this;
  }

  private matchOrdered(path: string): Right[] {
    return this.list
      .filter(r => r.matches(path))
      .sort((a, b) => b.specificity() - a.specificity());
  }

  has(path: string, flag: Flags): boolean {
    // For composite masks, all bits must succeed
    let remaining = flag;
    for (const bit of ALL_BITS) {
      if (!hasBit(remaining, bit)) {
        continue;
      }
      const ok = this.hasSingle(path, bit);
      if (!ok) {
        return false;
      }
      remaining &= ~bit;
    }
    return true;
  }

  explain(
    path: string,
    flag: Flags
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
      const res = this.explainSingle(p, bit);
      if (!res.allowed) {
        allAllowed = false;
      }
      details.push({ bit, ...res });
    }

    return { allowed: allAllowed, details };
  }

  private hasSingle(path: string, bit: Flags): boolean {
    return this.explainSingle(path, bit).allowed;
  }

  private explainSingle(
    path: string,
    bit: Flags
  ): { allowed: boolean; right?: Right } {
    const matches = this.matchOrdered(normalizePath(path));
    for (const r of matches) {
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
  all(path: string): boolean {
    return this.has(path, Flags.ALL);
  }
  read(path: string): boolean {
    return this.has(path, Flags.READ);
  }
  write(path: string): boolean {
    return this.has(path, Flags.WRITE);
  }
  delete(path: string): boolean {
    return this.has(path, Flags.DELETE);
  }
  create(path: string): boolean {
    return this.has(path, Flags.CREATE);
  }
  execute(path: string): boolean {
    return this.has(path, Flags.EXECUTE);
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
    return list;
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

  memberOf(role: Role): this {
    if (!this.roles.includes(role)) {
      this.roles.push(role);
    }
    return this;
  }

  has(path: string, flag: Flags): boolean {
    return this.explain(path, flag).allowed;
  }

  explain(
    path: string,
    flag: Flags
  ): {
    allowed: boolean;
    details: Array<{
      allowed: boolean;
      bit: Flags;
      right?: Right;
      source?: { name?: string; type: 'direct' | 'role' };
    }>;
  } {
    const aggregate = new Rights();
    const meta = new Map<Right, { name?: string; type: 'direct' | 'role' }>();

    // Add rights from roles
    for (const role of this.roles) {
      for (const entry of role.allRights()) {
        aggregate.add(entry.right);
        if (entry.source) {
          meta.set(entry.right, entry.source);
        }
      }
    }

    // Add direct rights
    for (const r of this.rights.allRights()) {
      aggregate.add(r);
      meta.set(r, { type: 'direct' });
    }

    const res = aggregate.explain(path, flag);
    return {
      allowed: res.allowed,
      details: res.details.map(d => ({
        ...d,
        source: d.right ? meta.get(d.right) : undefined
      }))
    };
  }

  // Convenience helpers
  all(path: string): boolean {
    return this.has(path, Flags.ALL);
  }
  read(path: string): boolean {
    return this.has(path, Flags.READ);
  }
  write(path: string): boolean {
    return this.has(path, Flags.WRITE);
  }
  delete(path: string): boolean {
    return this.has(path, Flags.DELETE);
  }
  create(path: string): boolean {
    return this.has(path, Flags.CREATE);
  }
  execute(path: string): boolean {
    return this.has(path, Flags.EXECUTE);
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
