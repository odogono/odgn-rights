import { ALL_BITS, Flags, hasBit } from './constants';
import { lettersFromMask, normalizePath } from './utils';

export type ConditionContext = unknown;
export type Condition = (context?: ConditionContext) => boolean;

export type RightInit = {
  allow?: Flags[];
  condition?: Condition;
  deny?: Flags[];
  description?: string;
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

  toJSON(): {
    allow: string;
    deny?: string;
    description?: string;
    path: string;
  } {
    const allow = lettersFromMask(this.allowMask);
    const deny = lettersFromMask(this.denyMask);
    const out: {
      allow: string;
      deny?: string;
      description?: string;
      path: string;
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
