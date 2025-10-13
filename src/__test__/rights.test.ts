import { describe, expect, it } from 'bun:test';

import { Flags, Right, Rights } from '../index';

describe('Right basics', () => {
  it('allows/denies and serializes', () => {
    const right = new Right('/');

    expect(right.has(Flags.READ)).toBe(false);

    right.allow(Flags.READ);

    expect(right.has(Flags.READ)).toBe(true);
    expect(right.has(Flags.WRITE)).toBe(false);
    expect(right.has(Flags.DELETE)).toBe(false);
    expect(right.has(Flags.CREATE)).toBe(false);
    expect(right.has(Flags.EXECUTE)).toBe(false);

    expect(right.toString()).toBe('+r:/');

    right.allow(Flags.WRITE);
    expect(right.toString()).toBe('+rw:/');
    right.deny(Flags.DELETE);
    expect(right.toString()).toBe('-c+rw:/');
    right.clear();
    expect(right.toString()).toBe(':/');
    right.allow(Flags.READ);
    expect(right.toJSON()).toEqual({
      allow: 'r',
      path: '/'
    });
  });
});

describe('Rights matching & precedence', () => {
  it('resolves overlapping rules and globs', () => {
    const root = new Right('/');
    root.allow(Flags.READ);
    const rights = new Rights();
    rights.add(root);

    expect(rights.has('/', Flags.READ)).toBe(true);
    expect(rights.has('/system/device/alpha', Flags.READ)).toBe(true);
    expect(rights.has('/system/device/alpha', Flags.WRITE)).toBe(false);

    const deviceRight = new Right('/*/device/**', {
      allow: [Flags.CREATE],
      deny: [Flags.READ]
    });
    rights.add(deviceRight);

    expect(rights.has('/system/device/alpha', Flags.READ)).toBe(false);
    expect(rights.has('/system/device/alpha', Flags.CREATE)).toBe(true);
    expect(rights.has('/system/device/alpha/description', Flags.CREATE)).toBe(
      true
    );

    expect(rights.toString()).toBe('+r:/, +c:/*/device/**');
  });
});

describe('Rights convenience & JSON', () => {
  it('supports ALL and JSON round-trip', () => {
    const rights = new Rights();
    rights.allow('/', Flags.READ);
    rights.add(
      new Right('/*/device/**', {
        allow: [Flags.CREATE],
        deny: [Flags.READ]
      })
    );

    const userRight = new Right('/system/user/*', {
      allow: [Flags.ALL],
      description: 'User management'
    });
    rights.add(userRight);

    expect(rights.all('/system/user/1')).toBe(true);
    expect(rights.read('/system/user/1')).toBe(true);
    expect(rights.write('/system/user/1')).toBe(true);
    expect(rights.delete('/system/user/1')).toBe(true);
    expect(rights.create('/system/user/1')).toBe(true);
    expect(rights.execute('/system/user/1')).toBe(true);

    expect(rights.toJSON()).toEqual([
      {
        allow: 'r',
        path: '/'
      },
      {
        allow: 'c',
        path: '/*/device/**'
      },
      {
        allow: '*',
        description: 'User management',
        path: '/system/user/*'
      }
    ]);

    rights.deny('/system/user/admin', Flags.ALL);

    expect(rights.has('/system/user/admin', Flags.ALL)).toBe(false);
    expect(rights.has('/system/user/admin', Flags.READ)).toBe(false);
    expect(rights.has('/system/user/admin', Flags.WRITE)).toBe(false);
    expect(rights.has('/system/user/admin', Flags.DELETE)).toBe(false);
    expect(rights.has('/system/user/admin', Flags.CREATE)).toBe(false);
    expect(rights.has('/system/user/admin', Flags.EXECUTE)).toBe(false);
  });
});

describe('Right.parse', () => {
  it('parses from string representation', () => {
    const r1 = Right.parse('+rw:/');
    expect(r1.has(Flags.READ)).toBe(true);
    expect(r1.has(Flags.WRITE)).toBe(true);
    expect(r1.has(Flags.CREATE)).toBe(false);
    expect(r1.toString()).toBe('+rw:/');

    const r2 = Right.parse('-c+rw:/system');
    expect(r2.has(Flags.READ)).toBe(true);
    expect(r2.has(Flags.WRITE)).toBe(true);
    expect(r2.has(Flags.CREATE)).toBe(false);
    // Deny should block READ if present (it is not), but ensure deny bit set for CREATE
    expect(r2.toString()).toBe('-c+rw:/system');

    // Round-trip with ALL
    const r3 = new Right('/system/user/*', { allow: [Flags.ALL] });
    const parsed = Right.parse(r3.toString());
    expect(parsed.toString()).toBe(r3.toString());
  });
});

describe('Rights.parse', () => {
  it('parses a list of rights', () => {
    const rights = Rights.parse('+r:/, -c+rw:/system, +*:/system/user/*');

    // Root has read
    expect(rights.read('/')).toBe(true);
    expect(rights.write('/')).toBe(false);

    // /system allows rw but denies create/delete
    expect(rights.read('/system/file')).toBe(true);
    expect(rights.write('/system/file')).toBe(true);
    expect(rights.create('/system/file')).toBe(false);
    expect(rights.delete('/system/file')).toBe(false);

    // /system/user/* has ALL
    expect(rights.all('/system/user/42')).toBe(true);
  });

  it('parses multiline lists and formats output', () => {
    const input = `+r:/
-c+rw:/system
+*:/system/user/*`;
    const rights = Rights.parse(input);
    expect(rights.read('/')).toBe(true);
    expect(rights.write('/')).toBe(false);
    expect(rights.write('/system/a')).toBe(true);
    expect(rights.create('/system/a')).toBe(false);
    expect(rights.all('/system/user/abc')).toBe(true);

    expect(rights.format()).toBe('+r:/, -c+rw:/system, +*:/system/user/*');
    expect(rights.format('\n')).toBe(
      '' + '+r:/\n-c+rw:/system\n+*:/system/user/*'
    );
  });
});
