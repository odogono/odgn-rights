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

  test('a sealed right can still record its database id', () => {
    const right = new Right('/x', { allow: [Flags.READ] }).seal();
    right._setDbId(7);
    expect(right.dbId).toBe(7);
  });
});
