import { describe, expect, it } from 'bun:test';

import { Flags } from '../constants';
import { Right } from '../right';
import { Rights } from '../rights';
import { Role } from '../role';

describe('Resource Tags / Labels', () => {
  describe('Right', () => {
    it('should store tags in constructor', () => {
      const right = new Right('/billing/**', {
        tags: ['pii', 'sensitive']
      });
      expect(right.tags).toEqual(['pii', 'sensitive']);
    });

    it('should sort tags alphabetically', () => {
      const right = new Right('/billing/**', {
        tags: ['sensitive', 'pii', 'audit-required']
      });
      expect(right.tags).toEqual(['audit-required', 'pii', 'sensitive']);
    });

    it('should check for a single tag', () => {
      const right = new Right('/billing/**', {
        tags: ['pii', 'sensitive']
      });
      expect(right.hasTag('pii')).toBe(true);
      expect(right.hasTag('audit')).toBe(false);
    });

    it('should check for multiple tags (AND mode)', () => {
      const right = new Right('/billing/**', {
        tags: ['pii', 'sensitive', 'audit']
      });
      expect(right.hasTags(['pii', 'sensitive'])).toBe(true);
      expect(right.hasTags(['pii', 'gdpr'])).toBe(false);
    });

    it('should check for multiple tags (OR mode)', () => {
      const right = new Right('/billing/**', {
        tags: ['pii', 'sensitive']
      });
      expect(right.hasTags(['pii', 'gdpr'], 'or')).toBe(true);
      expect(right.hasTags(['audit', 'gdpr'], 'or')).toBe(false);
    });

    it('should add and remove tags', () => {
      const right = new Right('/billing/**');
      right.addTag('pii');
      expect(right.hasTag('pii')).toBe(true);
      right.removeTag('pii');
      expect(right.hasTag('pii')).toBe(false);
    });

    it('should serialize to string with # suffix', () => {
      const right = new Right('/billing/**', {
        allow: [Flags.READ],
        tags: ['pii', 'sensitive']
      });
      expect(right.toString()).toBe('+r:/billing/**#pii,sensitive');
    });

    it('should serialize to string with # suffix and @ time', () => {
      const right = new Right('/billing/**', {
        allow: [Flags.READ],
        tags: ['pii'],
        validFrom: new Date('2025-01-01T00:00:00.000Z')
      });
      expect(right.toString()).toBe(
        '+r:/billing/**#pii@2025-01-01T00:00:00.000Z/*'
      );
    });

    it('should parse from string with tags', () => {
      const right = Right.parse('+rw:/billing/**#sensitive,pii');
      expect(right.path).toBe('/billing/**');
      expect(right.has(Flags.READ)).toBe(true);
      expect(right.tags).toEqual(['pii', 'sensitive']);
    });

    it('should parse from string with tags and time', () => {
      const right = Right.parse(
        '+r:/audit/*#compliance,sox@2025-01-01/2025-12-31'
      );
      expect(right.tags).toEqual(['compliance', 'sox']);
      expect(right.validFrom).toBeDefined();
      expect(right.validUntil).toBeDefined();
      if (right.validFrom && right.validUntil) {
        expect(right.validFrom.toISOString()).toBe(
          new Date('2025-01-01').toISOString()
        );
        expect(right.validUntil.toISOString()).toBe(
          new Date('2025-12-31').toISOString()
        );
      }
    });

    it('should serialize to JSON with tags', () => {
      const right = new Right('/billing/**', {
        allow: [Flags.READ],
        tags: ['pii', 'sensitive']
      });
      expect(right.toJSON()).toEqual({
        path: '/billing/**',
        allow: 'r',
        tags: ['pii', 'sensitive']
      });
    });
  });

  describe('Rights', () => {
    it('should find rights by tag', () => {
      const rights = new Rights();
      rights.add(new Right('/a', { tags: ['t1'] }));
      rights.add(new Right('/b', { tags: ['t2'] }));
      rights.add(new Right('/c', { tags: ['t1', 't2'] }));

      expect(rights.findByTag('t1').length).toBe(2);
      expect(rights.findByTag('t2').length).toBe(2);
      expect(rights.findByTag('t3').length).toBe(0);
    });

    it('should find rights by multiple tags', () => {
      const rights = new Rights();
      rights.add(new Right('/a', { tags: ['t1'] }));
      rights.add(new Right('/b', { tags: ['t2'] }));
      rights.add(new Right('/c', { tags: ['t1', 't2'] }));

      expect(rights.findByTags(['t1', 't2'], 'and').length).toBe(1);
      expect(rights.findByTags(['t1', 't2'], 'or').length).toBe(3);
    });

    it('should revoke rights by tag', () => {
      const rights = new Rights();
      rights.add(new Right('/a', { tags: ['temp'] }));
      rights.add(new Right('/b', { tags: ['perm'] }));

      rights.revokeByTag('temp');
      const all = rights.allRights();
      expect(all.length).toBe(1);
      expect(all[0]?.path).toBe('/b');
    });

    it('should allow rights by tag', () => {
      const rights = new Rights();
      rights.add(new Right('/a', { tags: ['read-only'] }));
      rights.add(new Right('/b', { tags: ['read-only'] }));

      rights.allowByTag('read-only', Flags.READ);
      expect(rights.read('/a')).toBe(true);
      expect(rights.read('/b')).toBe(true);
    });

    it('should handle JSON round-trip with tags', () => {
      const rights = new Rights();
      rights.add(
        new Right('/billing/**', {
          allow: [Flags.READ],
          tags: ['pii', 'sensitive']
        })
      );

      const json = rights.toJSON();
      const restored = Rights.fromJSON(json);

      const r = restored.allRights()[0];
      expect(r).toBeDefined();
      if (r) {
        expect(r.path).toBe('/billing/**');
        expect(r.tags).toEqual(['pii', 'sensitive']);
      }
    });
  });

  describe('Role', () => {
    it('should find rights by tag including inherited ones', () => {
      const parent = new Role('parent');
      parent.rights.add(new Right('/parent', { tags: ['shared'] }));

      const child = new Role('child');
      child.inheritsFrom(parent);
      child.rights.add(new Right('/child', { tags: ['shared', 'private'] }));

      expect(child.findRightsByTag('shared').length).toBe(2);
      expect(child.findRightsByTag('private').length).toBe(1);
    });
  });
});
