import { describe, expect, test } from 'bun:test';

import {
  Flags,
  Right,
  Rights,
  Role,
  RoleRegistry,
  SealedError,
  Subject
} from '../index';

const sealedRegistry = () => {
  const registry = new RoleRegistry();
  const viewer = registry.define('viewer');
  viewer.rights.allow('/docs/**', Flags.READ);
  const editor = registry.define('editor');
  editor.rights.allow('/docs/**', Flags.WRITE);
  editor.inheritsFrom(viewer);
  return registry.seal();
};

describe('Sealing', () => {
  test('a sealed registry still answers reads and permission checks', () => {
    const registry = sealedRegistry();
    const subject = new Subject();
    subject.memberOf(registry.get('editor')!);

    expect(registry.isSealed).toBe(true);
    expect(registry.getAll().map(role => role.name)).toEqual([
      'viewer',
      'editor'
    ]);
    expect(registry.define('viewer')).toBe(registry.get('viewer')!);
    expect(subject.has('/docs/a', Flags.READ)).toBe(true);
    expect(subject.has('/docs/a', Flags.WRITE)).toBe(true);
    expect(subject.has('/other', Flags.READ)).toBe(false);
  });

  test('a sealed registry refuses new roles, added rights and deletes', () => {
    const registry = sealedRegistry();

    expect(() => registry.define('new')).toThrow(SealedError);
    expect(() =>
      registry.define('viewer', new Rights().allow('/x', Flags.READ))
    ).toThrow(SealedError);
    expect(() => registry.delete('viewer')).toThrow(SealedError);
    expect(registry.get('new')).toBeUndefined();
  });

  test('roles in a sealed registry refuse changes to rights and parents', () => {
    const registry = sealedRegistry();
    const viewer = registry.get('viewer')!;
    const editor = registry.get('editor')!;
    const [right] = viewer.rights.allRights();

    const changes: Array<() => unknown> = [
      () => viewer.rights.add(new Right('/x', { allow: [Flags.READ] })),
      () => viewer.rights.remove(right!),
      () => viewer.rights.allow('/x', Flags.READ),
      () => viewer.rights.deny('/x', Flags.READ),
      () => viewer.rights.exclude('/x', Flags.READ),
      () => viewer.rights.revokeByTag('t'),
      () => viewer.rights.allowByTag('t', Flags.READ),
      () => viewer.rights.prune(),
      () => right!.allow(Flags.WRITE),
      () => right!.deny(Flags.READ),
      () => right!.clear(),
      () => right!.addTag('t'),
      () => right!.removeTag('t'),
      () => editor.inheritsFrom(new Role('other')),
      () => editor.removeParent(viewer),
      () => editor.clearParents()
    ];
    for (const change of changes) {
      expect(change).toThrow(SealedError);
    }
    expect(editor.parents).toEqual([viewer]);
    expect(viewer.rights.allRights()).toEqual([right!]);
  });

  test('an unsealed role cannot inherit from a sealed one', () => {
    const viewer = sealedRegistry().get('viewer')!;

    expect(() => new Role('outsider').inheritsFrom(viewer)).toThrow(
      SealedError
    );
  });

  test('sealing a role seals the roles it inherits from', () => {
    const parent = new Role('parent');
    parent.rights.allow('/base', Flags.READ);
    const registry = new RoleRegistry();
    registry.define('child').inheritsFrom(parent);
    registry.seal();

    expect(parent.isSealed).toBe(true);
    expect(() => parent.rights.allow('/base', Flags.WRITE)).toThrow(
      SealedError
    );
  });

  test('a sealed role freezes its parents and its inherited rights list', () => {
    const editor = sealedRegistry().get('editor')!;

    expect(() => editor.parents.push(new Role('extra'))).toThrow(TypeError);
    expect(() => editor.allRights().pop()).toThrow(TypeError);
    expect(editor.parents.map(role => role.name)).toEqual(['viewer']);
  });

  test('sealing drops a rights list built before it, and freezes entries', () => {
    const registry = new RoleRegistry();
    const role = registry.define('early');
    role.rights.allow('/early', Flags.READ);
    const before = role.allRights();
    registry.seal();

    const after = role.allRights();
    expect(after).not.toBe(before);
    expect(() => after.push(before[0]!)).toThrow(TypeError);
    expect(() => {
      after[0]!.right = new Right('/other', { allow: [Flags.ALL] });
    }).toThrow(TypeError);
    expect(after[0]!.right.path).toBe('/early');
  });

  test('delete checks every affected role before changing anything', () => {
    const registry = new RoleRegistry();
    const base = registry.define('base');
    registry.define('other');
    registry.define('unrelated').seal();
    const dependent = registry.define('dependent').inheritsFrom(base);
    dependent.seal();

    expect(() => registry.delete('base')).toThrow(SealedError);
    expect(registry.get('base')).toBe(base);
    expect(dependent.parents).toEqual([base]);

    // A sealed role without the edge does not block a delete.
    expect(registry.delete('other')).toBe(true);
  });

  test('a sealed right can still record its database id', () => {
    const right = new Right('/x', { allow: [Flags.READ] }).seal();
    right._setDbId(7);
    expect(right.dbId).toBe(7);
  });
});
