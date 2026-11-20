import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';

import {
  ALL_BITS,
  Right,
  Rights,
  RoleRegistry,
  Subject,
  normalizePath,
  type Condition,
  type RightJSON,
  type RoleJSON,
  type SubjectJSON
} from '../index';
import { flagsFromLetters } from './flags-from-letters';

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

type Change = {
  addRights?: RightJSON[];
  inheritFrom?: string;
  removeParent?: string;
  removeRights?: string[];
  role?: string;
};

type Step = Check | { change: Change };

type Expectation<T> = T | { error: true };

type Case =
  | {
      checks: Step[];
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

type Built = { checker: Checker; registry?: RoleRegistry; subject?: Subject };

const buildChecker = (c: Extract<Case, { kind: 'check' }>): Built => {
  if (c.subject) {
    if (c.conditions) {
      throw new Error(
        'conditions apply only to rights or rightsJSON, not to a subject'
      );
    }
    const registry = RoleRegistry.fromJSON(c.roles ?? []);
    const subject = Subject.fromJSON(c.subject, registry);
    return { checker: subject, registry, subject };
  }
  const list = c.rightsJSON
    ? Rights.fromJSON(c.rightsJSON).allRights()
    : (c.rights ?? []).map(text => Right.parse(text));
  const rights = new Rights();
  list.forEach((right, index) => {
    const name = c.conditions?.[String(index)];
    rights.add(name ? withCondition(right, CONDITIONS[name]!) : right);
  });
  return { checker: rights };
};

// Change a role of the case's registry, or the subject's direct rights.
const applyChange = ({ registry, subject }: Built, change: Change) => {
  if (!registry || !subject) {
    throw new Error('a change needs a case with a subject');
  }
  const mustGet = (name: string) => {
    const role = registry.get(name);
    if (!role) {
      throw new Error(`unknown role ${name}`);
    }
    return role;
  };
  const role = change.role === undefined ? undefined : mustGet(change.role);
  const rights = role ? role.rights : subject.rights;
  for (const path of change.removeRights ?? []) {
    const p = normalizePath(path);
    for (const right of rights.allRights().filter(r => r.path === p)) {
      rights.remove(right);
    }
  }
  for (const right of Rights.fromJSON(change.addRights ?? []).allRights()) {
    rights.add(right);
  }
  if (change.removeParent !== undefined || change.inheritFrom !== undefined) {
    if (!role) {
      throw new Error('inheritFrom and removeParent need a role');
    }
    if (change.removeParent !== undefined) {
      role.removeParent(mustGet(change.removeParent));
    }
    if (change.inheritFrom !== undefined) {
      role.inheritsFrom(mustGet(change.inheritFrom));
    }
  }
};

const runCase = (c: Case) => {
  switch (c.kind) {
    case 'check': {
      const built = buildChecker(c);
      const { checker } = built;
      for (const check of c.checks) {
        if ('change' in check) {
          applyChange(built, check.change);
          continue;
        }
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
