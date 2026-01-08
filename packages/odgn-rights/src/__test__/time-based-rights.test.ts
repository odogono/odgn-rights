import { describe, expect, it } from 'bun:test';

import { Flags, Right, Rights } from '../index';

describe('Time-Based Rights', () => {
  it('respects validFrom and validUntil', () => {
    const from = new Date('2025-01-01');
    const until = new Date('2025-12-31');
    const right = new Right('/api/beta/*', {
      allow: [Flags.ALL],
      validFrom: from,
      validUntil: until
    });

    const before = new Date('2024-12-31');
    const during = new Date('2025-06-15');
    const after = new Date('2026-01-01');

    expect(right.isValidAt(before)).toBe(false);
    expect(right.isValidAt(during)).toBe(true);
    expect(right.isValidAt(after)).toBe(false);

    expect(right.has(Flags.READ, before)).toBe(false);
    expect(right.has(Flags.READ, during)).toBe(true);
    expect(right.has(Flags.READ, after)).toBe(false);

    expect(right.isExpired(before)).toBe(false);
    expect(right.isExpired(during)).toBe(false);
    expect(right.isExpired(after)).toBe(true);
  });

  it('throws error if validFrom > validUntil', () => {
    expect(() => {
      new Right('/path', {
        validFrom: new Date('2025-12-31'),
        validUntil: new Date('2025-01-01')
      });
    }).toThrow('validFrom must be before validUntil');
  });

  it('handles partial time windows', () => {
    const fromOnly = new Right('/from', {
      validFrom: new Date('2025-01-01')
    });
    expect(fromOnly.isValidAt(new Date('2024-12-31'))).toBe(false);
    expect(fromOnly.isValidAt(new Date('2025-01-01'))).toBe(true);
    expect(fromOnly.isValidAt(new Date('2099-01-01'))).toBe(true);

    const untilOnly = new Right('/until', {
      validUntil: new Date('2025-12-31')
    });
    expect(untilOnly.isValidAt(new Date('2000-01-01'))).toBe(true);
    expect(untilOnly.isValidAt(new Date('2025-12-31'))).toBe(true);
    expect(untilOnly.isValidAt(new Date('2026-01-01'))).toBe(false);
  });

  describe('Serialization', () => {
    it('serializes to JSON', () => {
      const from = new Date('2025-01-01T00:00:00.000Z');
      const until = new Date('2025-12-31T23:59:59.999Z');
      const right = new Right('/api/beta/*', {
        allow: [Flags.ALL],
        validFrom: from,
        validUntil: until
      });

      const json = right.toJSON();
      expect(json.validFrom).toBe('2025-01-01T00:00:00.000Z');
      expect(json.validUntil).toBe('2025-12-31T23:59:59.999Z');
      expect(json.allow).toBe('*');
      expect(json.path).toBe('/api/beta/*');
    });

    it('round-trips through JSON', () => {
      const rights = new Rights();
      rights.add(
        new Right('/api/beta/*', {
          allow: [Flags.ALL],
          validFrom: new Date('2025-01-01T00:00:00.000Z'),
          validUntil: new Date('2025-12-31T23:59:59.999Z')
        })
      );

      const json = rights.toJSON();
      const restored = Rights.fromJSON(json);

      const during = new Date('2025-06-15');
      const after = new Date('2026-01-01');

      expect(restored.has('/api/beta/test', Flags.READ, { _now: during })).toBe(
        true
      );
      expect(restored.has('/api/beta/test', Flags.READ, { _now: after })).toBe(
        false
      );
    });

    it('serializes to String', () => {
      const right = new Right('/test', {
        allow: [Flags.READ],
        validFrom: new Date('2025-01-01T00:00:00.000Z'),
        validUntil: new Date('2025-12-31T23:59:59.999Z')
      });
      expect(right.toString()).toBe(
        '+r:/test@2025-01-01T00:00:00.000Z/2025-12-31T23:59:59.999Z'
      );
    });

    it('parses from String', () => {
      const s = '+rw:/path@2025-01-01T00:00:00.000Z/2025-12-31T23:59:59.999Z';
      const right = Right.parse(s);
      expect(right.path).toBe('/path');
      // Test with a date within the valid range
      const validDate = new Date('2025-06-15T12:00:00.000Z');
      expect(right.has(Flags.READ, validDate)).toBe(true);
      expect(right.validFrom?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
      expect(right.validUntil?.toISOString()).toBe('2025-12-31T23:59:59.999Z');
    });

    it('parses partial time from String', () => {
      const s1 = '+r:/reports/*@2025-01-01T00:00:00.000Z/*';
      const r1 = Right.parse(s1);
      expect(r1.validFrom?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
      expect(r1.validUntil).toBeUndefined();

      const s2 = '+rw:/temp/**@*/2025-12-31T00:00:00.000Z';
      const r2 = Right.parse(s2);
      expect(r2.validFrom).toBeUndefined();
      expect(r2.validUntil?.toISOString()).toBe('2025-12-31T00:00:00.000Z');
    });
  });

  describe('Rights Collection', () => {
    it('filters expired rules in has() using context', () => {
      const rights = new Rights();
      rights.add(
        new Right('/beta', {
          allow: [Flags.READ],
          validUntil: new Date('2025-01-01')
        })
      );

      expect(
        rights.has('/beta', Flags.READ, { _now: new Date('2024-12-31') })
      ).toBe(true);
      expect(
        rights.has('/beta', Flags.READ, { _now: new Date('2025-01-02') })
      ).toBe(false);
    });

    it('prunes expired rights', () => {
      const rights = new Rights();
      rights.add(
        new Right('/expired', {
          allow: [Flags.READ],
          validUntil: new Date('2024-01-01')
        })
      );
      rights.add(
        new Right('/active', {
          allow: [Flags.READ],
          validUntil: new Date('2026-01-01')
        })
      );

      expect(rights.allRights().length).toBe(2);

      rights.prune(new Date('2025-01-01'));

      expect(rights.allRights().length).toBe(1);
      const activeRight = rights.allRights()[0];
      expect(activeRight?.path).toBe('/active');
    });
  });
});
