import { describe, expect, it } from 'bun:test';

import {
  Flags,
  Right,
  Rights,
  Role,
  RoleRegistry,
  Subject,
  type RoleJSON
} from '../index';

describe('Role Basics', () => {
  it('inherits rights from parents', () => {
    const adminRights = new Rights().allow('/', Flags.ALL);
    const adminRole = new Role('admin', adminRights);

    const userRole = new Role('user');
    userRole.inheritsFrom(adminRole);

    const subject = new Subject().memberOf(userRole);
    expect(subject.all('/')).toBe(true);
  });

  it('handles complex inheritance and specificity', () => {
    // Viewer role: can read everything
    const viewer = new Role('viewer', new Rights().allow('/', Flags.READ));

    // Editor role: inherits viewer, can write to /content
    const editor = new Role(
      'editor',
      new Rights().allow('/content', Flags.WRITE)
    );
    editor.inheritsFrom(viewer);

    // Restricted Editor: inherits editor, but DENIED write to /content/private
    const restricted = new Role(
      'restricted_editor',
      new Rights().deny('/content/private', Flags.WRITE)
    );
    restricted.inheritsFrom(editor);

    const sub = new Subject().memberOf(restricted);

    expect(sub.read('/anywhere')).toBe(true); // From viewer
    expect(sub.write('/content/public')).toBe(true); // From editor
    expect(sub.write('/content/private')).toBe(false); // Denied by restricted
  });
});

describe('Subject Aggregation', () => {
  it('combines rights from multiple roles', () => {
    const reader = new Role('reader', new Rights().allow('/docs', Flags.READ));
    const writer = new Role('writer', new Rights().allow('/docs', Flags.WRITE));

    const sub = new Subject().memberOf(reader).memberOf(writer);

    expect(sub.read('/docs')).toBe(true);
    expect(sub.write('/docs')).toBe(true);
    expect(sub.create('/docs')).toBe(false);
  });

  it('prefers direct subject rights over roles if more specific', () => {
    const admin = new Role('admin', new Rights().allow('/', Flags.ALL));
    const sub = new Subject().memberOf(admin);

    // Direct deny on a specific path
    sub.rights.deny('/protected', Flags.ALL);

    expect(sub.all('/other')).toBe(true);
    expect(sub.all('/protected')).toBe(false);
  });

  it('serializes and restores subject state', () => {
    const registry = new RoleRegistry();
    const adminRole = registry.define('admin');
    adminRole.rights.allow('/admin', Flags.ALL);

    const subject = new Subject();
    subject.memberOf(adminRole);
    subject.rights.allow('/personal', Flags.READ);

    const json = subject.toJSON();
    expect(json.roles).toContain('admin');
    expect(json.rights).toHaveLength(1);

    const restored = Subject.fromJSON(json, registry);
    expect(restored.has('/admin', Flags.READ)).toBe(true);
    expect(restored.has('/personal', Flags.READ)).toBe(true);
  });
});

describe('RoleRegistry', () => {
  it('serializes and deserializes with inheritance', () => {
    const registry = new RoleRegistry();
    const base = registry.define('base', new Rights().allow('/', Flags.READ));
    const admin = registry.define('admin', new Rights().allow('/', Flags.ALL));
    admin.inheritsFrom(base);

    const json = registry.toJSON();
    const loaded = RoleRegistry.fromJSON(json);

    const loadedAdmin = loaded.get('admin');
    expect(loadedAdmin).toBeDefined();

    const sub = new Subject().memberOf(loadedAdmin!);
    expect(sub.all('/')).toBe(true);
  });

  it('invalidates child role cache when parent changes', () => {
    const parent = new Role('parent');
    const child = new Role('child');
    child.inheritsFrom(parent);

    // Trigger cache
    expect(child.allRights()).toHaveLength(0);

    parent.rights.allow('/shared', Flags.READ);

    // Now child should have the new right
    const all = child.allRights();
    expect(all).toHaveLength(1);
    expect(all[0]!.right.path).toBe('/shared');
  });

  it('throws error when parent role is missing', () => {
    const data = [
      {
        inherits: ['parent'],
        name: 'child',
        rights: []
      }
    ];

    expect(() => RoleRegistry.fromJSON(data as RoleJSON[])).toThrow(
      /inherits from missing role parent/
    );
  });
});

describe('Explanation API', () => {
  it('explains why a subject was denied', () => {
    const reader = new Role('reader', new Rights().allow('/docs', Flags.READ));
    const writer = new Role('writer', new Rights().allow('/docs', Flags.WRITE));
    const sub = new Subject().memberOf(reader).memberOf(writer);

    const explanation = sub.explain('/docs', Flags.CREATE);
    expect(explanation.allowed).toBe(false);
    expect(explanation.details).toHaveLength(1);
    expect(explanation.details[0]!.bit).toBe(Flags.CREATE);
    expect(explanation.details[0]!.allowed).toBe(false);
    expect(explanation.details[0]!.right).toBeUndefined();
  });

  it('explains which role provided a right', () => {
    const reader = new Role('reader', new Rights().allow('/docs', Flags.READ));
    const sub = new Subject().memberOf(reader);

    const explanation = sub.explain('/docs', Flags.READ);
    expect(explanation.allowed).toBe(true);
    expect(explanation.details[0]!.source).toEqual({
      name: 'reader',
      type: 'role'
    });
    expect(explanation.details[0]!.right?.path).toBe('/docs');
  });

  it('explains a multi-bit check', () => {
    const editor = new Role(
      'editor',
      new Rights().allow('/docs', Flags.READ, Flags.WRITE)
    );
    const sub = new Subject().memberOf(editor);

    const explanation = sub.explain(
      '/docs',
      (Flags.READ | Flags.WRITE) as Flags
    );
    expect(explanation.allowed).toBe(true);
    expect(explanation.details).toHaveLength(2);
    expect(explanation.details.every(d => d.allowed)).toBe(true);
  });
});

describe('ABAC / Contextual Rights', () => {
  it('evaluates conditions based on context', () => {
    const rights = new Rights();
    rights.add(
      new Right('/posts/*', {
        allow: [Flags.WRITE],
        condition: ctx =>
          (ctx as { userId: string }).userId ===
          (ctx as { ownerId: string }).ownerId
      })
    );

    // Denied if IDs don't match
    expect(rights.write('/posts/123', { ownerId: 'xyz', userId: 'abc' })).toBe(
      false
    );

    // Allowed if IDs match
    expect(rights.write('/posts/123', { ownerId: 'abc', userId: 'abc' })).toBe(
      true
    );
  });

  it('skips rights where condition is not met in specificity chain', () => {
    const rights = new Rights();

    // General allow
    rights.allow('/', Flags.READ);

    // Conditional deny
    rights.add(
      new Right('/secret', {
        condition: ctx => !(ctx as { isInternal: boolean }).isInternal,
        deny: [Flags.READ]
      })
    );

    expect(rights.read('/secret', { isInternal: true })).toBe(true); // Condition not met, skip deny
    expect(rights.read('/secret', { isInternal: false })).toBe(false); // Condition met, apply deny
  });
});

describe('Subject batch permission checks', () => {
  it('checks multiple permissions for a subject with roles', () => {
    const reader = new Role('reader', new Rights().allow('/docs', Flags.READ));
    const writer = new Role(
      'writer',
      new Rights().allow('/posts', Flags.WRITE)
    );
    const sub = new Subject().memberOf(reader).memberOf(writer);

    const results = sub.checkMany([
      { flags: Flags.READ, path: '/docs' },
      { flags: Flags.WRITE, path: '/docs' },
      { flags: Flags.WRITE, path: '/posts' },
      { flags: Flags.READ, path: '/posts' }
    ]);

    expect(results).toEqual([true, false, true, false]);
  });

  it('handles mixed direct rights and role-based rights', () => {
    const registry = new RoleRegistry();
    const viewer = registry.define(
      'viewer',
      new Rights().allow('/public', Flags.READ)
    );
    const sub = new Subject().memberOf(viewer);
    sub.rights.allow('/private', Flags.ALL);

    const results = sub.checkMany([
      { flags: Flags.READ, path: '/public' },
      { flags: Flags.ALL, path: '/private' },
      { flags: Flags.DELETE, path: '/private' },
      { flags: Flags.WRITE, path: '/public' }
    ]);

    expect(results).toEqual([true, true, true, false]);
  });

  it('respects shared context across all checks', () => {
    const rights = new Rights();
    rights.add(
      new Right('/posts/*', {
        allow: [Flags.WRITE],
        condition: ctx =>
          (ctx as { userId: string }).userId ===
          (ctx as { ownerId: string }).ownerId
      })
    );

    const sub = new Subject();
    sub.rights.add(
      new Right('/posts/*', {
        allow: [Flags.WRITE],
        condition: ctx =>
          (ctx as { userId: string }).userId ===
          (ctx as { ownerId: string }).ownerId
      })
    );

    const results = sub.checkMany(
      [
        { flags: Flags.WRITE, path: '/posts/1' },
        { flags: Flags.WRITE, path: '/posts/2' },
        { flags: Flags.WRITE, path: '/posts/3' }
      ],
      { ownerId: 'user1', userId: 'user1' }
    );

    expect(results).toEqual([true, true, true]);
  });

  it('returns empty array for empty input', () => {
    const reader = new Role('reader', new Rights().allow('/docs', Flags.READ));
    const sub = new Subject().memberOf(reader);

    const results = sub.checkMany([]);

    expect(results).toEqual([]);
  });

  it('is consistent with individual has() calls', () => {
    const viewer = new Role('viewer', new Rights().allow('/docs', Flags.READ));
    const editor = new Role('editor', new Rights().allow('/docs', Flags.WRITE));
    const sub = new Subject().memberOf(viewer).memberOf(editor);

    const requests = [
      { flags: Flags.READ, path: '/docs' },
      { flags: Flags.WRITE, path: '/docs' },
      { flags: Flags.DELETE, path: '/docs' },
      { flags: Flags.READ, path: '/other' }
    ];

    const batchResults = sub.checkMany(requests);
    const individualResults = requests.map(req => sub.has(req.path, req.flags));

    expect(batchResults).toEqual(individualResults);
  });

  it('handles inheritance chains in batch checks', () => {
    const base = new Role('base', new Rights().allow('/', Flags.READ));
    const editor = new Role(
      'editor',
      new Rights().allow('/content', Flags.WRITE)
    );
    editor.inheritsFrom(base);

    const sub = new Subject().memberOf(editor);

    const results = sub.checkMany([
      { flags: Flags.WRITE, path: '/content' },
      { flags: Flags.READ, path: '/other' },
      { flags: Flags.READ, path: '/content' }
    ]);

    expect(results).toEqual([true, true, true]);
  });
});

describe('Role.clearParents', () => {
  it('removes all parent relationships', () => {
    const parent1 = new Role('parent1', new Rights().allow('/', Flags.READ));
    const parent2 = new Role(
      'parent2',
      new Rights().allow('/admin', Flags.ALL)
    );
    const child = new Role('child');

    child.inheritsFrom(parent1);
    child.inheritsFrom(parent2);

    expect(child.parents).toHaveLength(2);

    child.clearParents();

    expect(child.parents).toHaveLength(0);
  });

  it('removes child from parent children lists', () => {
    const parent = new Role('parent');
    const child1 = new Role('child1');
    const child2 = new Role('child2');

    child1.inheritsFrom(parent);
    child2.inheritsFrom(parent);

    // Access private children via inheritance test
    expect(child1.parents).toContain(parent);
    expect(child2.parents).toContain(parent);

    child1.clearParents();

    // child2 should still be a child of parent
    // Verify by checking that parent changes still propagate to child2
    parent.rights.allow('/new', Flags.READ);
    expect(child2.allRights().some(r => r.right.path === '/new')).toBe(true);

    // But child1 should NOT get the new right
    expect(child1.allRights().some(r => r.right.path === '/new')).toBe(false);
  });

  it('invalidates cache so inherited rights are no longer accessible', () => {
    const parent = new Role(
      'parent',
      new Rights().allow('/shared', Flags.READ)
    );
    const child = new Role('child');

    child.inheritsFrom(parent);

    // Before clearParents: child has inherited rights
    expect(child.allRights()).toHaveLength(1);
    expect(child.allRights()[0]!.right.path).toBe('/shared');

    child.clearParents();

    // After clearParents: child has no rights
    expect(child.allRights()).toHaveLength(0);
  });

  it('works correctly when role has no parents', () => {
    const role = new Role('standalone', new Rights().allow('/', Flags.READ));

    expect(role.parents).toHaveLength(0);

    // Should not throw
    role.clearParents();

    expect(role.parents).toHaveLength(0);
    expect(role.allRights()).toHaveLength(1);
  });

  it('is chainable', () => {
    const parent = new Role('parent');
    const child = new Role('child');
    child.inheritsFrom(parent);

    const result = child.clearParents();

    expect(result).toBe(child);
  });

  it('allows setting new parents after clearing', () => {
    const oldParent = new Role(
      'oldParent',
      new Rights().allow('/old', Flags.READ)
    );
    const newParent = new Role(
      'newParent',
      new Rights().allow('/new', Flags.WRITE)
    );
    const child = new Role('child');

    child.inheritsFrom(oldParent);
    expect(child.allRights().some(r => r.right.path === '/old')).toBe(true);

    child.clearParents();
    child.inheritsFrom(newParent);

    expect(child.allRights()).toHaveLength(1);
    expect(child.allRights()[0]!.right.path).toBe('/new');
    expect(child.allRights().some(r => r.right.path === '/old')).toBe(false);
  });

  it('handles multi-level inheritance correctly', () => {
    const grandparent = new Role(
      'grandparent',
      new Rights().allow('/gp', Flags.READ)
    );
    const parent = new Role('parent', new Rights().allow('/p', Flags.READ));
    const child = new Role('child');

    parent.inheritsFrom(grandparent);
    child.inheritsFrom(parent);

    // Child should have both grandparent and parent rights
    expect(child.allRights()).toHaveLength(2);

    // Clear only the child's direct parents
    child.clearParents();

    // Child should have no rights now
    expect(child.allRights()).toHaveLength(0);

    // Parent should still inherit from grandparent
    expect(parent.allRights()).toHaveLength(2);
  });
});

describe('Role.removeParent', () => {
  it('removes only the named parent, keeping the others in order', () => {
    const parent1 = new Role('parent1', new Rights().allow('/a', Flags.READ));
    const parent2 = new Role('parent2', new Rights().allow('/b', Flags.READ));
    const parent3 = new Role('parent3', new Rights().allow('/c', Flags.READ));
    const child = new Role('child');

    child.inheritsFrom(parent1);
    child.inheritsFrom(parent2);
    child.inheritsFrom(parent3);

    child.removeParent(parent2);

    expect(child.parents).toEqual([parent1, parent3]);
    expect(child.allRights()).toHaveLength(2);
  });

  it('is a no-op for a role that is not a parent', () => {
    const parent = new Role('parent');
    const stranger = new Role('stranger');
    const child = new Role('child');
    child.inheritsFrom(parent);

    child.removeParent(stranger);

    expect(child.parents).toEqual([parent]);
  });

  it('lets the removed parent be re-attached', () => {
    const parent = new Role('parent', new Rights().allow('/a', Flags.READ));
    const child = new Role('child');
    child.inheritsFrom(parent);

    child.removeParent(parent);
    expect(child.allRights()).toHaveLength(0);

    child.inheritsFrom(parent);
    expect(child.allRights()).toHaveLength(1);
  });
});

describe('RoleRegistry.delete', () => {
  it('removes the role and the inheritance edges pointing at it', () => {
    const registry = new RoleRegistry();
    const base = registry.define('base', new Rights().allow('/a', Flags.READ));
    const middle = registry.define(
      'middle',
      new Rights().allow('/b', Flags.READ)
    );
    const leaf = registry.define('leaf', new Rights().allow('/c', Flags.READ));
    middle.inheritsFrom(base);
    leaf.inheritsFrom(middle);

    expect(registry.delete('middle')).toBe(true);

    expect(registry.get('middle')).toBeUndefined();
    expect(registry.getAll().map(role => role.name)).toEqual(['base', 'leaf']);
    // leaf loses the edge to middle, and with it middle's inherited rights
    expect(leaf.parents).toHaveLength(0);
    expect(leaf.allRights()).toHaveLength(1);
  });

  it('leaves unrelated inheritance intact', () => {
    const registry = new RoleRegistry();
    const base = registry.define('base', new Rights().allow('/a', Flags.READ));
    const other = registry.define(
      'other',
      new Rights().allow('/b', Flags.READ)
    );
    const leaf = registry.define('leaf');
    leaf.inheritsFrom(base);
    leaf.inheritsFrom(other);

    registry.delete('other');

    expect(leaf.parents).toEqual([base]);
    expect(leaf.allRights()).toHaveLength(1);
  });

  it('returns false for an unknown role', () => {
    const registry = new RoleRegistry();
    registry.define('base');

    expect(registry.delete('nope')).toBe(false);
    expect(registry.getAll()).toHaveLength(1);
  });
});
