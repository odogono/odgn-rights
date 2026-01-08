import { describe, expect, it } from 'bun:test';

import { Flags, Right, Rights, parsePath } from '../index';

describe('parsePath helper', () => {
  it('parses regular path without negation', () => {
    const result = parsePath('/api/users');
    expect(result.path).toBe('/api/users');
    expect(result.negated).toBe(false);
  });

  it('parses negated path', () => {
    const result = parsePath('!/api/internal');
    expect(result.path).toBe('/api/internal');
    expect(result.negated).toBe(true);
  });

  it('handles double negation as positive', () => {
    const result = parsePath('!!/api/path');
    expect(result.path).toBe('/api/path');
    expect(result.negated).toBe(false);
  });

  it('handles triple negation as negative', () => {
    const result = parsePath('!!!/api/path');
    expect(result.path).toBe('/api/path');
    expect(result.negated).toBe(true);
  });

  it('trims whitespace before checking negation', () => {
    const result = parsePath('  !/api/path  ');
    expect(result.path).toBe('/api/path');
    expect(result.negated).toBe(true);
  });

  it('handles whitespace after negation', () => {
    const result = parsePath('! /api/path');
    expect(result.path).toBe('/api/path');
    expect(result.negated).toBe(true);
  });

  it('normalizes negated path correctly', () => {
    const result = parsePath('!api/path/');
    expect(result.path).toBe('/api/path');
    expect(result.negated).toBe(true);
  });

  it('handles negation with glob patterns', () => {
    const result = parsePath('!/api/**');
    expect(result.path).toBe('/api/**');
    expect(result.negated).toBe(true);
  });

  it('handles empty path after negation', () => {
    const result = parsePath('!');
    expect(result.path).toBe('/');
    expect(result.negated).toBe(true);
  });
});

describe('Right constructor with negated path', () => {
  it('creates deny rule from negated path with allow init', () => {
    const r = new Right('!/api/secret', { allow: [Flags.READ] });
    expect(r.path).toBe('/api/secret');
    expect(r.denyMaskValue).toBe(Flags.READ);
    expect(r.allowMaskValue).toBe(0);
  });

  it('creates allow rule from negated path with deny init', () => {
    const r = new Right('!/api/secret', { deny: [Flags.WRITE] });
    expect(r.path).toBe('/api/secret');
    expect(r.allowMaskValue).toBe(Flags.WRITE);
    expect(r.denyMaskValue).toBe(0);
  });

  it('swaps both allow and deny when negated', () => {
    const r = new Right('!/path', {
      allow: [Flags.READ, Flags.WRITE],
      deny: [Flags.DELETE]
    });
    expect(r.path).toBe('/path');
    // allow becomes deny
    expect(r.denyMaskValue).toBe(Flags.READ | Flags.WRITE);
    // deny becomes allow
    expect(r.allowMaskValue).toBe(Flags.DELETE);
  });

  it('normalizes negated path correctly', () => {
    const r = new Right('!api/path/', { allow: [Flags.READ] });
    expect(r.path).toBe('/api/path');
  });

  it('handles double negation as positive', () => {
    const r = new Right('!!/api/path', { allow: [Flags.READ] });
    expect(r.path).toBe('/api/path');
    expect(r.allowMaskValue).toBe(Flags.READ);
    expect(r.denyMaskValue).toBe(0);
  });

  it('handles glob patterns in negated path', () => {
    const r = new Right('!/api/**', { allow: [Flags.ALL] });
    expect(r.path).toBe('/api/**');
    expect(r.denyMaskValue).toBe(Flags.ALL);
    expect(r.matches('/api/internal/secret')).toBe(true);
  });
});

describe('Right.parse() with negation', () => {
  it('parses negated path with allow flags as deny', () => {
    const r = Right.parse('+r:!/api/internal/**');
    expect(r.path).toBe('/api/internal/**');
    expect(r.denyMaskValue).toBe(Flags.READ);
    expect(r.allowMaskValue).toBe(0);
  });

  it('parses negated path with deny flags as allow', () => {
    const r = Right.parse('-w:!/api/internal');
    expect(r.path).toBe('/api/internal');
    expect(r.allowMaskValue).toBe(Flags.WRITE);
    expect(r.denyMaskValue).toBe(0);
  });

  it('parses negated path swapping allow and deny', () => {
    const r = Right.parse('+rw-d:!/path');
    // +rw becomes deny rw, -d becomes allow d
    expect(r.denyMaskValue).toBe(Flags.READ | Flags.WRITE);
    expect(r.allowMaskValue).toBe(Flags.DELETE);
  });

  it('parses negated path with ALL flag', () => {
    const r = Right.parse('+*:!/admin/**');
    expect(r.path).toBe('/admin/**');
    expect(r.denyMaskValue).toBe(Flags.ALL);
    expect(r.allowMaskValue).toBe(0);
  });

  it('parses negated path without explicit flags', () => {
    const r = Right.parse('!/api/internal');
    expect(r.path).toBe('/api/internal');
    expect(r.allowMaskValue).toBe(0);
    expect(r.denyMaskValue).toBe(0);
  });

  it('parses negated path with priority', () => {
    const r = Right.parse('+r:!/api/internal^100');
    expect(r.path).toBe('/api/internal');
    expect(r.priority).toBe(100);
    expect(r.denyMaskValue).toBe(Flags.READ);
  });

  it('parses negated path with tags', () => {
    const r = Right.parse('+rw:!/protected/**#secure,admin');
    expect(r.path).toBe('/protected/**');
    expect(r.denyMaskValue).toBe(Flags.READ | Flags.WRITE);
    expect(r.tags).toEqual(['admin', 'secure']);
  });

  it('handles double negation in parse', () => {
    const r = Right.parse('+r:!!/api/path');
    expect(r.path).toBe('/api/path');
    // Double negation = positive, so +r stays as allow
    expect(r.allowMaskValue).toBe(Flags.READ);
    expect(r.denyMaskValue).toBe(0);
  });
});

describe('Rights.exclude()', () => {
  it('excludes specific flags from a path', () => {
    const rights = new Rights();
    rights.allow('/api/**', Flags.READ);
    rights.exclude('/api/internal/**', Flags.READ);

    expect(rights.read('/api/public')).toBe(true);
    expect(rights.read('/api/internal/secret')).toBe(false);
  });

  it('accepts multiple flags', () => {
    const rights = new Rights();
    rights.allow('/files/**', Flags.ALL);
    rights.exclude('/files/system/**', Flags.DELETE, Flags.WRITE);

    expect(rights.read('/files/system/config')).toBe(true);
    expect(rights.write('/files/system/config')).toBe(false);
    expect(rights.delete('/files/system/config')).toBe(false);
    expect(rights.create('/files/system/config')).toBe(true);
  });

  it('follows specificity rules', () => {
    const rights = new Rights();
    rights.allow('/api/**', Flags.READ, Flags.WRITE);
    rights.exclude('/api/internal/**', Flags.READ);
    // More specific path re-allows read
    rights.allow('/api/internal/public', Flags.READ);

    expect(rights.read('/api/internal/public')).toBe(true);
    expect(rights.read('/api/internal/secret')).toBe(false);
  });

  it('only affects specified flags', () => {
    const rights = new Rights();
    rights.allow('/api/**', Flags.ALL);
    rights.exclude('/api/admin/**', Flags.DELETE);

    expect(rights.read('/api/admin/users')).toBe(true);
    expect(rights.write('/api/admin/users')).toBe(true);
    expect(rights.create('/api/admin/users')).toBe(true);
    expect(rights.delete('/api/admin/users')).toBe(false);
  });

  it('overrides less specific allow with ALL', () => {
    const rights = new Rights();
    rights.allow('/api/**', Flags.ALL);
    rights.exclude('/api/internal/**', Flags.READ);

    // /api/internal/** is more specific than /api/**
    expect(rights.read('/api/internal/data')).toBe(false);
    expect(rights.write('/api/internal/data')).toBe(true);
  });

  it('strips leading ! if present', () => {
    const rights = new Rights();
    rights.allow('/api/**', Flags.READ);
    rights.exclude('!/api/internal/**', Flags.READ);

    expect(rights.read('/api/public')).toBe(true);
    expect(rights.read('/api/internal/secret')).toBe(false);
  });

  it('updates existing right if path exists', () => {
    const rights = new Rights();
    rights.allow('/api/admin', Flags.READ, Flags.WRITE);
    rights.exclude('/api/admin', Flags.WRITE);

    expect(rights.read('/api/admin')).toBe(true);
    expect(rights.write('/api/admin')).toBe(false);
  });

  it('can be chained', () => {
    const rights = new Rights();
    rights
      .allow('/api/**', Flags.ALL)
      .exclude('/api/admin/**', Flags.DELETE)
      .exclude('/api/internal/**', Flags.READ);

    expect(rights.delete('/api/admin/users')).toBe(false);
    expect(rights.read('/api/internal/data')).toBe(false);
    expect(rights.read('/api/public')).toBe(true);
  });
});

describe('Rights.parse() with negation', () => {
  it('parses mixed allow and negation patterns', () => {
    const rights = Rights.parse('+r:/api/**, +r:!/api/internal/**');

    expect(rights.read('/api/public')).toBe(true);
    expect(rights.read('/api/internal/secret')).toBe(false);
  });

  it('parses multiline with negation', () => {
    const input = `+rw:/files/**
+rw:!/files/system/**
+r:/files/system/readme`;
    const rights = Rights.parse(input);

    expect(rights.read('/files/docs')).toBe(true);
    expect(rights.write('/files/docs')).toBe(true);
    expect(rights.read('/files/system/config')).toBe(false);
    expect(rights.write('/files/system/config')).toBe(false);
    expect(rights.read('/files/system/readme')).toBe(true);
    expect(rights.write('/files/system/readme')).toBe(false);
  });

  it('handles complex negation scenarios', () => {
    const rights = Rights.parse('+*:/**, +*:!/admin/**, +r:/admin/docs/**');

    // Root has all permissions
    expect(rights.all('/public/file')).toBe(true);
    // Admin is denied all
    expect(rights.all('/admin/settings')).toBe(false);
    expect(rights.read('/admin/settings')).toBe(false);
    // Admin docs has read
    expect(rights.read('/admin/docs/readme')).toBe(true);
    expect(rights.write('/admin/docs/readme')).toBe(false);
  });
});

describe('Negation patterns - edge cases', () => {
  it('negation on root path', () => {
    const r = new Right('!/', { allow: [Flags.DELETE] });
    expect(r.path).toBe('/');
    expect(r.denyMaskValue).toBe(Flags.DELETE);
    expect(r.matches('/anything')).toBe(true);
  });

  it('negation with single segment wildcard', () => {
    const rights = new Rights();
    rights.allow('/users/*', Flags.READ);
    rights.add(new Right('!/users/admin', { allow: [Flags.READ] }));

    expect(rights.read('/users/john')).toBe(true);
    expect(rights.read('/users/admin')).toBe(false);
  });

  it('negation with question mark wildcard', () => {
    const r = new Right('!/file?.txt', { allow: [Flags.WRITE] });
    expect(r.denyMaskValue).toBe(Flags.WRITE);
    expect(r.matches('/file1.txt')).toBe(true);
    expect(r.matches('/file12.txt')).toBe(false);
  });

  it('explain shows negated rule', () => {
    const rights = new Rights();
    rights.allow('/api/**', Flags.READ);
    const denyRule = new Right('!/api/internal/**', { allow: [Flags.READ] });
    rights.add(denyRule);

    const explanation = rights.explain('/api/internal/secret', Flags.READ);
    expect(explanation.allowed).toBe(false);
    expect(explanation.details[0]?.right).toBe(denyRule);
  });

  it('serialization of negated right uses standard format', () => {
    const r = new Right('!/api/secret', { allow: [Flags.READ, Flags.WRITE] });
    // Negation creates deny, so output should show deny flags
    expect(r.toString()).toBe('-rw:/api/secret');
  });

  it('JSON serialization of negated right', () => {
    const r = new Right('!/api/secret', { allow: [Flags.READ] });
    const json = r.toJSON();
    expect(json.path).toBe('/api/secret');
    expect(json.deny).toBe('r');
    expect(json.allow).toBe('');
  });
});
