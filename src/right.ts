import { ALL_BITS, Flags, hasBit } from './constants';
import { lettersFromMask, normalizePath, parsePath } from './helpers';

export type ConditionContext = unknown;
export type Condition = (context?: ConditionContext) => boolean;

export type RightInit = {
  allow?: Flags[];
  condition?: Condition;
  deny?: Flags[];
  description?: string;
  priority?: number;
  tags?: string[];
  validFrom?: Date;
  validUntil?: Date;
};

export class Right {
  readonly path: string;
  private allowMask = 0;
  private denyMask = 0;
  readonly description?: string;
  readonly condition?: Condition;
  readonly validFrom?: Date;
  readonly validUntil?: Date;
  private readonly _tags: Set<string>;
  private readonly _specificity: number;
  private readonly _priority: number;
  private readonly _re?: RegExp;
  private _dbId?: number;

  constructor(path: string, init?: RightInit) {
    const parsed = parsePath(path);
    this.path = parsed.path;
    this.description = init?.description;
    this.condition = init?.condition;
    this.validFrom = init?.validFrom;
    this.validUntil = init?.validUntil;
    this._tags = new Set(init?.tags);
    this._priority = init?.priority ?? 0;

    if (this.validFrom && this.validUntil && this.validFrom > this.validUntil) {
      throw new Error('validFrom must be before validUntil');
    }

    this._specificity = this.calculateSpecificity();
    if (this.path.includes('*') || this.path.includes('?')) {
      this._re = Right.globToRegExp(this.path);
    }

    // When path is negated (!path), swap allow and deny semantics
    // allow becomes deny, deny becomes allow
    if (parsed.negated) {
      if (init?.allow) {
        init.allow.forEach(f => this.deny(f));
      }
      if (init?.deny) {
        init.deny.forEach(f => this.allow(f));
      }
    } else {
      if (init?.allow) {
        init.allow.forEach(f => this.allow(f));
      }
      if (init?.deny) {
        init.deny.forEach(f => this.deny(f));
      }
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

  get tags(): string[] {
    return [...this._tags].sort();
  }

  hasTag(tag: string): boolean {
    return this._tags.has(tag);
  }

  hasTags(tags: string[], mode: 'and' | 'or' = 'and'): boolean {
    if (mode === 'and') {
      return tags.every(t => this._tags.has(t));
    }
    return tags.some(t => this._tags.has(t));
  }

  addTag(tag: string): this {
    this._tags.add(tag);
    return this;
  }

  removeTag(tag: string): this {
    this._tags.delete(tag);
    return this;
  }

  has(flag: Flags, now: Date = new Date()): boolean {
    if (this.validFrom && now < this.validFrom) {
      return false;
    }
    if (this.validUntil && now > this.validUntil) {
      return false;
    }

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

  isValidAt(now: Date = new Date()): boolean {
    if (this.validFrom && now < this.validFrom) {
      return false;
    }
    if (this.validUntil && now > this.validUntil) {
      return false;
    }
    return true;
  }

  isExpired(now: Date = new Date()): boolean {
    return this.validUntil !== undefined && now > this.validUntil;
  }

  get allowMaskValue(): number {
    return this.allowMask;
  }

  get denyMaskValue(): number {
    return this.denyMask;
  }

  get dbId(): number | undefined {
    return this._dbId;
  }

  _setDbId(id: number): void {
    this._dbId = id;
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
    let res = `${left}:${this.path}`;

    if (this._priority !== 0) {
      res += `^${this._priority}`;
    }

    if (this._tags.size > 0) {
      res += `#${this.tags.join(',')}`;
    }

    if (this.validFrom || this.validUntil) {
      const from = this.validFrom ? this.validFrom.toISOString() : '*';
      const until = this.validUntil ? this.validUntil.toISOString() : '*';
      res += `@${from}/${until}`;
    }

    return res;
  }

  toJSON(): {
    allow: string;
    deny?: string;
    description?: string;
    path: string;
    priority?: number;
    tags?: string[];
    validFrom?: string;
    validUntil?: string;
  } {
    const allow = lettersFromMask(this.allowMask);
    const deny = lettersFromMask(this.denyMask);
    const out: {
      allow: string;
      deny?: string;
      description?: string;
      path: string;
      priority?: number;
      tags?: string[];
      validFrom?: string;
      validUntil?: string;
    } = {
      allow,
      path: this.path
    };
    if (deny) {
      out.deny = deny;
    }
    if (this.description) {
      out.description = this.description;
    }
    if (this._priority !== 0) {
      out.priority = this._priority;
    }
    if (this._tags.size > 0) {
      out.tags = this.tags;
    }
    if (this.validFrom) {
      out.validFrom = this.validFrom.toISOString();
    }
    if (this.validUntil) {
      out.validUntil = this.validUntil.toISOString();
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

  get priority(): number {
    return this._priority;
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
    const colonIdx = s.indexOf(':');
    const hashIdx = s.lastIndexOf('#');
    const atIdx = s.lastIndexOf('@');

    let flagsStr = '';
    let pathStr = '';
    let tagsStr = '';
    let timeStr = '';
    let priorityStr = '';

    let pathEndIdx = s.length;
    if (atIdx !== -1) {
      timeStr = s.slice(atIdx + 1);
      pathEndIdx = atIdx;
    }
    if (hashIdx !== -1 && (atIdx === -1 || hashIdx < atIdx)) {
      tagsStr = s.slice(hashIdx + 1, pathEndIdx);
      pathEndIdx = hashIdx;
    }

    // Find ^ for priority (between path and #/@)
    const pathStartIdx = colonIdx === -1 ? 0 : colonIdx + 1;
    const caretIdx = s.indexOf('^', pathStartIdx);
    if (caretIdx !== -1 && caretIdx < pathEndIdx) {
      priorityStr = s.slice(caretIdx + 1, pathEndIdx);
      pathEndIdx = caretIdx;
    }

    if (colonIdx === -1) {
      pathStr = s.slice(0, pathEndIdx);
    } else {
      flagsStr = s.slice(0, colonIdx);
      pathStr = s.slice(colonIdx + 1, pathEndIdx);
    }

    const init: RightInit = {};
    if (timeStr) {
      const parts = timeStr.split('/');
      const from = parts[0];
      const until = parts[1];
      if (from && from !== '*') {
        const d = new Date(from);
        if (!Number.isNaN(d.getTime())) {
          init.validFrom = d;
        }
      }
      if (until && until !== '*') {
        const d = new Date(until);
        if (!Number.isNaN(d.getTime())) {
          init.validUntil = d;
        }
      }
    }

    if (tagsStr) {
      init.tags = tagsStr.split(',').map(t => t.trim());
    }

    if (priorityStr) {
      const p = Number.parseInt(priorityStr, 10);
      if (!Number.isNaN(p)) {
        init.priority = p;
      }
    }

    // Check if path is negated (starts with !)
    const parsed = parsePath(pathStr);
    const r = new Right(parsed.path, init);

    if (!flagsStr) {
      return r;
    }

    // parse groups like '-abc+xyz' or '+xyz-abc'
    // When path is negated, swap the meaning of + and -
    let i = 0;
    while (i < flagsStr.length) {
      const sign = flagsStr[i];
      if (sign !== '+' && sign !== '-') {
        i++;
        continue;
      }
      i++;
      let letters = '';
      while (
        i < flagsStr.length &&
        flagsStr[i] !== '+' &&
        flagsStr[i] !== '-'
      ) {
        letters += flagsStr[i];
        i++;
      }

      // When negated: + becomes deny, - becomes allow
      let apply: (f: Flags) => void;
      if (parsed.negated) {
        apply =
          sign === '+' ? (f: Flags) => r.deny(f) : (f: Flags) => r.allow(f);
      } else {
        apply =
          sign === '+' ? (f: Flags) => r.allow(f) : (f: Flags) => r.deny(f);
      }

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
