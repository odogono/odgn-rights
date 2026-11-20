import { describe, expect, it } from 'bun:test';

import { Flags, Right, Role, RoleRegistry, Subject } from '../index';

// A subject caches the combined rights of its roles and its direct rights.
// Each check must still see the current state, without invalidateCache().
describe('Subject sees changes made after a check', () => {
  it('sees a right added to its role', () => {
    const role = new Role('editor');
    const s = new Subject().memberOf(role);
    expect(s.has('/doc', Flags.READ)).toBe(false);
    role.rights.add(Right.parse('+r:/doc'));
    expect(s.has('/doc', Flags.READ)).toBe(true);
  });

  it('sees a right removed from its role', () => {
    const right = Right.parse('+r:/doc');
    const role = new Role('editor');
    role.rights.add(right);
    const s = new Subject().memberOf(role);
    expect(s.has('/doc', Flags.READ)).toBe(true);
    role.rights.remove(right);
    expect(s.has('/doc', Flags.READ)).toBe(false);
  });

  it('sees its role start and stop inheriting from another', () => {
    const viewer = new Role('viewer');
    viewer.rights.add(Right.parse('+r:/doc'));
    const editor = new Role('editor');
    const s = new Subject().memberOf(editor);
    expect(s.has('/doc', Flags.READ)).toBe(false);
    editor.inheritsFrom(viewer);
    expect(s.has('/doc', Flags.READ)).toBe(true);
    editor.removeParent(viewer);
    expect(s.has('/doc', Flags.READ)).toBe(false);
    editor.inheritsFrom(viewer);
    expect(s.has('/doc', Flags.READ)).toBe(true);
    editor.clearParents();
    expect(s.has('/doc', Flags.READ)).toBe(false);
  });

  it('sees a change to a role inherited through another role', () => {
    const base = new Role('base');
    const viewer = new Role('viewer').inheritsFrom(base);
    const editor = new Role('editor').inheritsFrom(viewer);
    const s = new Subject().memberOf(editor);
    expect(s.has('/doc', Flags.READ)).toBe(false);
    base.rights.add(Right.parse('+r:/doc'));
    expect(s.has('/doc', Flags.READ)).toBe(true);
    const other = new Role('other');
    other.rights.add(Right.parse('-r:/doc/secret'));
    base.inheritsFrom(other);
    expect(s.has('/doc/secret', Flags.READ)).toBe(false);
  });

  it('sees a role deleted from the registry', () => {
    const registry = new RoleRegistry();
    const viewer = registry.define('viewer');
    viewer.rights.add(Right.parse('+r:/doc'));
    const editor = registry.define('editor');
    editor.inheritsFrom(viewer);
    const s = new Subject().memberOf(editor);
    expect(s.has('/doc', Flags.READ)).toBe(true);
    registry.delete('viewer');
    expect(s.has('/doc', Flags.READ)).toBe(false);
  });

  it('sees changes to its direct rights', () => {
    const s = new Subject();
    expect(s.has('/doc', Flags.READ)).toBe(false);
    const right = Right.parse('+r:/doc');
    s.rights.add(right);
    expect(s.has('/doc', Flags.READ)).toBe(true);
    s.rights.remove(right);
    expect(s.has('/doc', Flags.READ)).toBe(false);
    s.rights.allow('/doc', Flags.WRITE);
    expect(s.has('/doc', Flags.WRITE)).toBe(true);
  });

  it('lists current rights in allRights() and explain()', () => {
    const role = new Role('editor');
    const s = new Subject().memberOf(role);
    expect(s.allRights()).toEqual([]);
    const right = Right.parse('+r:/doc');
    role.rights.add(right);
    expect(s.allRights()).toEqual([
      { right, source: { name: 'editor', type: 'role' } }
    ]);
    expect(s.explain('/doc', Flags.READ).details[0]?.right).toBe(right);
  });

  it('still answers from a sealed registry', () => {
    const registry = new RoleRegistry();
    registry.define('viewer').rights.add(Right.parse('+r:/doc'));
    registry.seal();
    const s = new Subject().memberOf(registry.get('viewer')!);
    expect(s.has('/doc', Flags.READ)).toBe(true);
    expect(s.has('/doc', Flags.WRITE)).toBe(false);
  });

  it('keeps invalidateCache() working', () => {
    const role = new Role('editor');
    const s = new Subject().memberOf(role);
    role.rights.add(Right.parse('+r:/doc'));
    s.invalidateCache();
    expect(s.has('/doc', Flags.READ)).toBe(true);
  });

  it('reuses its combined rights while nothing changes', () => {
    const role = new Role('editor');
    role.rights.add(Right.parse('+r:/doc'));
    const s = new Subject().memberOf(role);
    const first = s.allRights();
    const second = s.allRights();
    expect(second.map(e => e.right)).toEqual(first.map(e => e.right));
    let builds = 0;
    const original = role.allRights.bind(role);
    role.allRights = () => {
      builds++;
      return original();
    };
    s.has('/doc', Flags.READ);
    s.has('/doc', Flags.READ);
    expect(builds).toBe(0);
  });
});
