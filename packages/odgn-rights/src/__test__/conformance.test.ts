import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';

import {
  ALL_BITS,
  Flags,
  Right,
  Rights,
  RoleRegistry,
  Subject,
  type Condition,
  type RightJSON,
  type RoleJSON,
  type SubjectJSON
} from '../index';

// Runs the language-neutral cases in /conformance, which the Go port runs too.
// See conformance/schema.json for the case format.

const CONFORMANCE_DIR = join(import.meta.dir, '../../../../conformance');

type Check = {
  context?: Record<string, unknown>;
  expect: boolean;
  flags: string;
  now?: string;
  path: string;
};

type Expectation<T> = T | { error: true };

type Case =
  | {
      checks: Check[];
      conditions?: Record<string, string>;
      kind: 'check';
      name: string;
      rights?: string[];
      rightsJSON?: RightJSON[];
      roles?: RoleJSON[];
      subject?: SubjectJSON;
    }
  | {
      expect: Expectation<{ json: RightJSON; text: string }>;
      input: string;
      kind: 'parseRight';
      name: string;
    }
  | {
      expect: { text: string; texts: string[] };
      input: string;
      kind: 'parseRights';
      name: string;
    }
  | {
      expect: Expectation<{ json: RightJSON[]; texts: string[] }>;
      input: RightJSON[];
      kind: 'rightsFromJSON';
      name: string;
    }
  | {
      expect: Expectation<{ json: RoleJSON[] }>;
      input: RoleJSON[];
      kind: 'registryFromJSON';
      name: string;
    };

type Ctx = Record<string, unknown> | undefined;

const CONDITIONS: Record<string, Condition> = {
  always: () => true,
  internal: ctx => (ctx as Ctx)?.isInternal === true,
  never: () => false,
  notInternal: ctx => (ctx as Ctx)?.isInternal !== true,
  owner: ctx =>
    ctx != null &&
    (ctx as Ctx)?.userId !== undefined &&
    (ctx as Ctx)?.userId === (ctx as Ctx)?.ownerId
};

const LETTERS: Record<string, Flags> = {
  c: Flags.CREATE,
  d: Flags.DELETE,
  r: Flags.READ,
  w: Flags.WRITE,
  x: Flags.EXECUTE
};

// A check may combine flags, which the Flags type does not list, so the mask
// is cast back to it.
const flagsFromLetters = (letters: string): Flags => {
  if (letters === '*') {
    return Flags.ALL;
  }
  let mask = 0;
  for (const ch of letters) {
    mask |= LETTERS[ch] ?? 0;
  }
  return mask as Flags;
};

// Right's constructor takes the condition, so rebuild an indexed right with it.
const withCondition = (right: Right, condition: Condition): Right => {
  const copy = new Right(right.path, {
    condition,
    description: right.description,
    priority: right.priority,
    tags: right.tags,
    validFrom: right.validFrom,
    validUntil: right.validUntil
  });
  for (const bit of ALL_BITS) {
    if (right.allowMaskValue & bit) {
      copy.allow(bit);
    }
    if (right.denyMaskValue & bit) {
      copy.deny(bit);
    }
  }
  return copy;
};

type Checker = { has: Rights['has'] };

const buildChecker = (c: Extract<Case, { kind: 'check' }>): Checker => {
  if (c.subject) {
    if (c.conditions) {
      throw new Error(
        'conditions apply only to rights or rightsJSON, not to a subject'
      );
    }
    const registry = RoleRegistry.fromJSON(c.roles ?? []);
    return Subject.fromJSON(c.subject, registry);
  }
  const list = c.rightsJSON
    ? Rights.fromJSON(c.rightsJSON).allRights()
    : (c.rights ?? []).map(text => Right.parse(text));
  const rights = new Rights();
  list.forEach((right, index) => {
    const name = c.conditions?.[String(index)];
    rights.add(name ? withCondition(right, CONDITIONS[name]!) : right);
  });
  return rights;
};

const runCase = (c: Case) => {
  switch (c.kind) {
    case 'check': {
      const checker = buildChecker(c);
      for (const check of c.checks) {
        const context = check.now
          ? { ...check.context, _now: new Date(check.now) }
          : check.context;
        const got = checker.has(
          check.path,
          flagsFromLetters(check.flags),
          context
        );
        expect({ ...check, got }).toEqual({ ...check, got: check.expect });
      }
      return;
    }
    case 'parseRight': {
      if ('error' in c.expect) {
        expect(() => Right.parse(c.input)).toThrow();
        return;
      }
      const right = Right.parse(c.input);
      expect(right.toString()).toBe(c.expect.text);
      expect(right.toJSON()).toEqual(c.expect.json as never);
      return;
    }
    case 'parseRights': {
      const rights = Rights.parse(c.input);
      expect(rights.allRights().map(r => r.toString())).toEqual(c.expect.texts);
      expect(rights.toString()).toBe(c.expect.text);
      return;
    }
    case 'rightsFromJSON': {
      if ('error' in c.expect) {
        expect(() => Rights.fromJSON(c.input)).toThrow();
        return;
      }
      const rights = Rights.fromJSON(c.input);
      expect(rights.allRights().map(r => r.toString())).toEqual(c.expect.texts);
      expect(rights.toJSON()).toEqual(c.expect.json as never);
      return;
    }
    case 'registryFromJSON': {
      if ('error' in c.expect) {
        expect(() => RoleRegistry.fromJSON(c.input)).toThrow();
        return;
      }
      expect(RoleRegistry.fromJSON(c.input).toJSON()).toEqual(c.expect.json);
      return;
    }
  }
};

const files = readdirSync(CONFORMANCE_DIR)
  .filter(f => f.endsWith('.json') && f !== 'schema.json')
  .sort();

for (const file of files) {
  const { cases } = (await Bun.file(join(CONFORMANCE_DIR, file)).json()) as {
    cases: Case[];
  };
  describe(`conformance/${file}`, () => {
    for (const c of cases) {
      it(c.name, () => runCase(c));
    }
  });
}
