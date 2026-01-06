import { describe, expect, it } from 'bun:test';

import {
  Flags,
  Right,
  Rights,
  Role,
  RoleRegistry,
  Subject,
  SubjectRegistry
} from '../index';

describe('SubjectRegistry', () => {
  describe('basic operations', () => {
    it('registers and retrieves subjects', () => {
      const registry = new SubjectRegistry();
      const alice = new Subject();
      const bob = new Subject();

      registry.register('user-alice', alice);
      registry.register('user-bob', bob);

      expect(registry.get('user-alice')).toBe(alice);
      expect(registry.get('user-bob')).toBe(bob);
      expect(registry.get('user-unknown')).toBeUndefined();
    });

    it('checks if a subject exists', () => {
      const registry = new SubjectRegistry();
      const alice = new Subject();

      registry.register('user-alice', alice);

      expect(registry.has('user-alice')).toBe(true);
      expect(registry.has('user-unknown')).toBe(false);
    });

    it('deletes subjects', () => {
      const registry = new SubjectRegistry();
      const alice = new Subject();

      registry.register('user-alice', alice);
      expect(registry.has('user-alice')).toBe(true);

      const deleted = registry.delete('user-alice');
      expect(deleted).toBe(true);
      expect(registry.has('user-alice')).toBe(false);

      const deletedAgain = registry.delete('user-alice');
      expect(deletedAgain).toBe(false);
    });

    it('replaces existing subjects with same identifier', () => {
      const registry = new SubjectRegistry();
      const alice1 = new Subject();
      alice1.rights.allow('/path1', Flags.READ);

      const alice2 = new Subject();
      alice2.rights.allow('/path2', Flags.WRITE);

      registry.register('user-alice', alice1);
      registry.register('user-alice', alice2);

      const retrieved = registry.get('user-alice');
      expect(retrieved).toBe(alice2);
      expect(retrieved?.read('/path1')).toBe(false);
      expect(retrieved?.write('/path2')).toBe(true);
    });

    it('returns all identifiers', () => {
      const registry = new SubjectRegistry();
      registry.register('user-alice', new Subject());
      registry.register('user-bob', new Subject());
      registry.register('user-charlie', new Subject());

      const ids = registry.identifiers();
      expect(ids).toHaveLength(3);
      expect(ids).toContain('user-alice');
      expect(ids).toContain('user-bob');
      expect(ids).toContain('user-charlie');
    });

    it('tracks size correctly', () => {
      const registry = new SubjectRegistry();
      expect(registry.size).toBe(0);

      registry.register('user-alice', new Subject());
      expect(registry.size).toBe(1);

      registry.register('user-bob', new Subject());
      expect(registry.size).toBe(2);

      registry.delete('user-alice');
      expect(registry.size).toBe(1);
    });

    it('clears all subjects', () => {
      const registry = new SubjectRegistry();
      registry.register('user-alice', new Subject());
      registry.register('user-bob', new Subject());
      expect(registry.size).toBe(2);

      registry.clear();
      expect(registry.size).toBe(0);
      expect(registry.has('user-alice')).toBe(false);
    });

    it('iterates over entries', () => {
      const registry = new SubjectRegistry();
      const alice = new Subject();
      const bob = new Subject();

      registry.register('user-alice', alice);
      registry.register('user-bob', bob);

      const entries = Array.from(registry.entries());
      expect(entries).toHaveLength(2);
      expect(entries).toContainEqual(['user-alice', alice]);
      expect(entries).toContainEqual(['user-bob', bob]);
    });
  });

  describe('findSubjectsWithAccess', () => {
    it('finds subjects with direct rights', () => {
      const registry = new SubjectRegistry();

      const alice = new Subject();
      alice.rights.allow('/admin', Flags.READ, Flags.WRITE);

      const bob = new Subject();
      bob.rights.allow('/admin', Flags.READ);

      const charlie = new Subject();
      charlie.rights.allow('/public', Flags.ALL);

      registry.register('user-alice', alice);
      registry.register('user-bob', bob);
      registry.register('user-charlie', charlie);

      const writeAccess = registry.findSubjectsWithAccess(
        '/admin',
        Flags.WRITE
      );
      expect(writeAccess).toHaveLength(1);
      expect(writeAccess).toContain('user-alice');

      const readAccess = registry.findSubjectsWithAccess('/admin', Flags.READ);
      expect(readAccess).toHaveLength(2);
      expect(readAccess).toContain('user-alice');
      expect(readAccess).toContain('user-bob');
    });

    it('finds subjects with role-based rights', () => {
      const registry = new SubjectRegistry();
      const roleRegistry = new RoleRegistry();

      const adminRole = roleRegistry.define(
        'admin',
        new Rights().allow('/admin/**', Flags.ALL)
      );
      const viewerRole = roleRegistry.define(
        'viewer',
        new Rights().allow('/admin/**', Flags.READ)
      );

      const alice = new Subject().memberOf(adminRole);
      const bob = new Subject().memberOf(viewerRole);
      const charlie = new Subject();

      registry.register('user-alice', alice);
      registry.register('user-bob', bob);
      registry.register('user-charlie', charlie);

      const writeAccess = registry.findSubjectsWithAccess(
        '/admin/users',
        Flags.WRITE
      );
      expect(writeAccess).toHaveLength(1);
      expect(writeAccess).toContain('user-alice');

      const readAccess = registry.findSubjectsWithAccess(
        '/admin/users',
        Flags.READ
      );
      expect(readAccess).toHaveLength(2);
      expect(readAccess).toContain('user-alice');
      expect(readAccess).toContain('user-bob');
    });

    it('respects deny rules', () => {
      const registry = new SubjectRegistry();
      const roleRegistry = new RoleRegistry();

      const adminRole = roleRegistry.define(
        'admin',
        new Rights().allow('/**', Flags.ALL)
      );

      const alice = new Subject().memberOf(adminRole);
      alice.rights.deny('/restricted', Flags.WRITE);

      const bob = new Subject().memberOf(adminRole);

      registry.register('user-alice', alice);
      registry.register('user-bob', bob);

      const writeAccess = registry.findSubjectsWithAccess(
        '/restricted',
        Flags.WRITE
      );
      expect(writeAccess).toHaveLength(1);
      expect(writeAccess).toContain('user-bob');
      expect(writeAccess).not.toContain('user-alice');
    });

    it('supports condition context', () => {
      const registry = new SubjectRegistry();

      const alice = new Subject();
      alice.rights.add(
        new Right('/posts/*', {
          allow: [Flags.WRITE],
          condition: ctx => {
            if (!ctx) return false;
            return (
              (ctx as { userId: string }).userId ===
              (ctx as { ownerId: string }).ownerId
            );
          }
        })
      );

      const bob = new Subject();
      bob.rights.allow('/posts/*', Flags.WRITE);

      registry.register('user-alice', alice);
      registry.register('user-bob', bob);

      // Without matching context, alice shouldn't have access
      const noContext = registry.findSubjectsWithAccess(
        '/posts/123',
        Flags.WRITE
      );
      expect(noContext).toHaveLength(1);
      expect(noContext).toContain('user-bob');

      // With matching context, alice should have access
      const withContext = registry.findSubjectsWithAccess(
        '/posts/123',
        Flags.WRITE,
        { ownerId: 'alice', userId: 'alice' }
      );
      expect(withContext).toHaveLength(2);
      expect(withContext).toContain('user-alice');
      expect(withContext).toContain('user-bob');
    });

    it('returns empty array when no subjects match', () => {
      const registry = new SubjectRegistry();

      const alice = new Subject();
      alice.rights.allow('/docs', Flags.READ);

      registry.register('user-alice', alice);

      const result = registry.findSubjectsWithAccess('/admin', Flags.WRITE);
      expect(result).toEqual([]);
    });

    it('returns empty array for empty registry', () => {
      const registry = new SubjectRegistry();

      const result = registry.findSubjectsWithAccess('/admin', Flags.WRITE);
      expect(result).toEqual([]);
    });

    it('handles glob patterns', () => {
      const registry = new SubjectRegistry();

      const alice = new Subject();
      alice.rights.allow('/docs/**', Flags.READ);

      const bob = new Subject();
      bob.rights.allow('/docs/public/*', Flags.READ);

      registry.register('user-alice', alice);
      registry.register('user-bob', bob);

      const deepAccess = registry.findSubjectsWithAccess(
        '/docs/private/secret',
        Flags.READ
      );
      expect(deepAccess).toHaveLength(1);
      expect(deepAccess).toContain('user-alice');

      const shallowAccess = registry.findSubjectsWithAccess(
        '/docs/public/readme',
        Flags.READ
      );
      expect(shallowAccess).toHaveLength(2);
      expect(shallowAccess).toContain('user-alice');
      expect(shallowAccess).toContain('user-bob');
    });
  });

  describe('serialization', () => {
    it('serializes to JSON', () => {
      const registry = new SubjectRegistry();
      const roleRegistry = new RoleRegistry();
      const adminRole = roleRegistry.define('admin');

      const alice = new Subject().memberOf(adminRole);
      alice.rights.allow('/docs', Flags.READ);

      const bob = new Subject();
      bob.rights.allow('/public', Flags.ALL);

      registry.register('user-alice', alice);
      registry.register('user-bob', bob);

      const json = registry.toJSON();

      expect(json['user-alice']).toBeDefined();
      expect(json['user-alice']!.roles).toContain('admin');
      expect(json['user-alice']!.rights).toHaveLength(1);

      expect(json['user-bob']).toBeDefined();
      expect(json['user-bob']!.roles).toBeUndefined();
      expect(json['user-bob']!.rights).toHaveLength(1);
    });

    it('deserializes from JSON without role registry', () => {
      const json = {
        'user-alice': {
          rights: [{ allow: 'r', path: '/docs' }]
        },
        'user-bob': {
          rights: [{ allow: '*', path: '/public' }]
        }
      };

      const registry = SubjectRegistry.fromJSON(json);

      expect(registry.size).toBe(2);
      expect(registry.get('user-alice')?.read('/docs')).toBe(true);
      expect(registry.get('user-bob')?.all('/public')).toBe(true);
    });

    it('deserializes from JSON with role registry', () => {
      const roleRegistry = new RoleRegistry();
      roleRegistry.define('admin', new Rights().allow('/admin', Flags.ALL));

      const json = {
        'user-alice': {
          rights: [{ allow: 'r', path: '/docs' }],
          roles: ['admin']
        }
      };

      const registry = SubjectRegistry.fromJSON(json, roleRegistry);

      const alice = registry.get('user-alice');
      expect(alice).toBeDefined();
      expect(alice?.read('/docs')).toBe(true);
      expect(alice?.all('/admin')).toBe(true);
    });

    it('roundtrips through JSON', () => {
      const roleRegistry = new RoleRegistry();
      roleRegistry.define(
        'editor',
        new Rights().allow('/content', Flags.WRITE)
      );

      const originalRegistry = new SubjectRegistry();
      const alice = new Subject().memberOf(roleRegistry.get('editor')!);
      alice.rights.allow('/personal', Flags.ALL);

      originalRegistry.register('user-alice', alice);

      const json = originalRegistry.toJSON();
      const restoredRegistry = SubjectRegistry.fromJSON(json, roleRegistry);

      const restoredAlice = restoredRegistry.get('user-alice');
      expect(restoredAlice).toBeDefined();
      expect(restoredAlice?.write('/content')).toBe(true);
      expect(restoredAlice?.all('/personal')).toBe(true);
    });
  });
});
