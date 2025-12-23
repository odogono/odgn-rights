import { ALL_BITS, Flags, hasBit } from './constants';
import { lettersFromMask, normalizePath } from './utils';

export type ConditionContext = unknown;
export type Condition = (context?: ConditionContext) => boolean;

export type RightInit = {
  allow?: Flags[];
  condition?: Condition;
  deny?: Flags[];
  description?: string;
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
  private readonly _specificity: number;
  private readonly _re?: RegExp;

  constructor(path: string, init?: RightInit) {
    this.path = normalizePath(path);
    this.description = init?.description;
    this.condition = init?.condition;
    this.validFrom = init?.validFrom;
    this.validUntil = init?.validUntil;

    if (this.validFrom && this.validUntil && this.validFrom > this.validUntil) {
      throw new Error('validFrom must be before validUntil');
    }

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
    const atIdx = s.lastIndexOf('@');

    let flagsStr = '';
    let pathStr = '';
    let timeStr = '';

    if (colonIdx === -1) {
      if (atIdx === -1) {
        pathStr = s;
      } else {
        pathStr = s.slice(0, atIdx);
        timeStr = s.slice(atIdx + 1);
      }
    } else {
      flagsStr = s.slice(0, colonIdx);
      if (atIdx === -1 || atIdx < colonIdx) {
        pathStr = s.slice(colonIdx + 1);
      } else {
        pathStr = s.slice(colonIdx + 1, atIdx);
        timeStr = s.slice(atIdx + 1);
      }
    }

    const init: RightInit = {};
    if (timeStr) {
      const parts = timeStr.split('/');
      const from = parts[0];
      const until = parts[1];
      if (from && from !== '*') {
        const d = new Date(from);
        if (!isNaN(d.getTime())) {
          init.validFrom = d;
        }
      }
      if (until && until !== '*') {
        const d = new Date(until);
        if (!isNaN(d.getTime())) {
          init.validUntil = d;
        }
      }
    }

    const r = new Right(pathStr, init);

    if (!flagsStr) {
      return r;
    }

    // parse groups like '-abc+xyz' or '+xyz-abc'
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
