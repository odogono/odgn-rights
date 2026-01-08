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
    expect(right.toString()).toBe('-d+rw:/');
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

    expect(rights.toString()).toBe('+r:/, -r+c:/*/device/**');
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
        deny: 'r',
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

    // Round-trip with deny
    const json = rights.toJSON();
    const restored = Rights.fromJSON(json);
    expect(restored.has('/system/user/admin', Flags.ALL)).toBe(false);
    expect(restored.has('/system/user/1', Flags.ALL)).toBe(true);
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

  it('uniquely identifies create and delete', () => {
    const rights = new Rights();
    rights.allow('/', Flags.ALL);
    rights.deny('/protected', Flags.DELETE);

    expect(rights.delete('/protected/file')).toBe(false);
    expect(rights.create('/protected/file')).toBe(true);

    const serialized = rights.format();
    expect(serialized).toBe('+*:/, -d:/protected');

    const parsed = Rights.parse(serialized);
    expect(parsed.delete('/protected/file')).toBe(false);
    expect(parsed.create('/protected/file')).toBe(true);
  });
});

describe('Right priority', () => {
  it('constructs with priority', () => {
    const r = new Right('/x', { priority: 100 });
    expect(r.priority).toBe(100);
  });

  it('defaults priority to 0', () => {
    const r = new Right('/x');
    expect(r.priority).toBe(0);
  });

  it('supports negative priority', () => {
    const r = new Right('/x', { priority: -10 });
    expect(r.priority).toBe(-10);
  });

  it('parses positive priority from text', () => {
    const r = Right.parse('+rw:/path^50');
    expect(r.priority).toBe(50);
    expect(r.has(Flags.READ)).toBe(true);
    expect(r.has(Flags.WRITE)).toBe(true);
    expect(r.path).toBe('/path');
  });

  it('parses negative priority from text', () => {
    const r = Right.parse('+rw:/path^-10');
    expect(r.priority).toBe(-10);
  });

  it('parses priority with tags', () => {
    const r = Right.parse('+rw:/path^100#admin');
    expect(r.priority).toBe(100);
    expect(r.tags).toEqual(['admin']);
  });

  it('parses priority with time range', () => {
    const r = Right.parse('+rw:/path^100@2025-01-01T00:00:00.000Z/*');
    expect(r.priority).toBe(100);
    expect(r.validFrom?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });

  it('parses priority with tags and time range', () => {
    const r = Right.parse(
      '+rw:/path^100#admin,user@2025-01-01T00:00:00.000Z/2025-12-31T23:59:59.999Z'
    );
    expect(r.priority).toBe(100);
    expect(r.tags).toEqual(['admin', 'user']);
    expect(r.validFrom?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(r.validUntil?.toISOString()).toBe('2025-12-31T23:59:59.999Z');
  });

  it('serializes non-zero priority to string', () => {
    const r = new Right('/x', { allow: [Flags.READ], priority: 50 });
    expect(r.toString()).toBe('+r:/x^50');
  });

  it('omits zero priority from string', () => {
    const r = new Right('/x', { allow: [Flags.READ], priority: 0 });
    expect(r.toString()).toBe('+r:/x');
    expect(r.toString()).not.toContain('^');
  });

  it('omits priority from string when not set', () => {
    const r = new Right('/x', { allow: [Flags.READ] });
    expect(r.toString()).toBe('+r:/x');
    expect(r.toString()).not.toContain('^');
  });

  it('serializes priority to JSON', () => {
    const r = new Right('/x', { allow: [Flags.READ], priority: 100 });
    expect(r.toJSON()).toEqual({
      allow: 'r',
      path: '/x',
      priority: 100
    });
  });

  it('omits zero priority from JSON', () => {
    const r = new Right('/x', { allow: [Flags.READ], priority: 0 });
    const json = r.toJSON();
    expect(json.priority).toBeUndefined();
  });

  it('round-trips priority through JSON', () => {
    const rights = Rights.fromJSON([{ allow: 'r', path: '/x', priority: 100 }]);
    const json = rights.toJSON();
    expect(json[0]?.priority).toBe(100);
  });

  it('round-trips priority through text', () => {
    const r = Right.parse('+rw:/path^50#tag');
    expect(r.toString()).toBe('+rw:/path^50#tag');
  });
});

describe('Rights priority resolution', () => {
  it('priority overrides specificity', () => {
    const rights = new Rights();
    // More specific path but lower priority
    rights.add(
      new Right('/posts/123', { allow: [Flags.READ], deny: [Flags.WRITE] })
    );
    // Less specific path but higher priority
    rights.add(
      new Right('/posts/*', {
        allow: [Flags.READ, Flags.WRITE],
        priority: 100
      })
    );

    // Higher priority wildcard rule should win
    expect(rights.read('/posts/123')).toBe(true);
    expect(rights.write('/posts/123')).toBe(true);
  });

  it('equal priority falls back to specificity', () => {
    const rights = new Rights();
    // More specific path, same priority
    rights.add(
      new Right('/posts/123', {
        allow: [Flags.READ],
        deny: [Flags.WRITE],
        priority: 50
      })
    );
    // Less specific path, same priority
    rights.add(
      new Right('/posts/*', {
        allow: [Flags.READ, Flags.WRITE],
        priority: 50
      })
    );

    // Equal priority, more specific rule should win
    expect(rights.read('/posts/123')).toBe(true);
    expect(rights.write('/posts/123')).toBe(false);
  });

  it('negative priority deprioritizes rules', () => {
    const rights = new Rights();
    // More specific path but negative priority
    rights.add(
      new Right('/posts/123', {
        allow: [Flags.READ],
        deny: [Flags.WRITE],
        priority: -10
      })
    );
    // Less specific path, default priority (0)
    rights.add(new Right('/posts/*', { allow: [Flags.READ, Flags.WRITE] }));

    // Default priority (0) beats negative priority (-10)
    expect(rights.read('/posts/123')).toBe(true);
    expect(rights.write('/posts/123')).toBe(true);
  });

  it('explains which rule matched with priority', () => {
    const rights = new Rights();
    const lowPriorityRule = new Right('/posts/123', {
      deny: [Flags.WRITE],
      priority: -10
    });
    const highPriorityRule = new Right('/posts/*', {
      allow: [Flags.WRITE],
      priority: 100
    });
    rights.add(lowPriorityRule);
    rights.add(highPriorityRule);

    const explanation = rights.explain('/posts/123', Flags.WRITE);
    expect(explanation.allowed).toBe(true);
    expect(explanation.details[0]?.right).toBe(highPriorityRule);
  });
});

describe('Batch permission checks', () => {
  it('checks multiple permissions at once', () => {
    const rights = new Rights();
    rights.allow('/users/*', Flags.READ);
    rights.allow('/posts/*', Flags.WRITE);
    rights.deny('/admin', Flags.ALL);

    const results = rights.checkMany([
      { flags: Flags.READ, path: '/users/1' },
      { flags: Flags.WRITE, path: '/posts/1' },
      { flags: Flags.ALL, path: '/admin' }
    ]);

    expect(results).toEqual([true, true, false]);
  });

  it('returns empty array for empty input', () => {
    const rights = new Rights();
    rights.allow('/users/*', Flags.READ);

    const results = rights.checkMany([]);

    expect(results).toEqual([]);
  });

  it('handles single item array', () => {
    const rights = new Rights();
    rights.allow('/users/*', Flags.READ);

    const results = rights.checkMany([{ flags: Flags.READ, path: '/users/1' }]);

    expect(results).toEqual([true]);
  });

  it('handles all allowed permissions', () => {
    const rights = new Rights();
    rights.allow('/', Flags.ALL);

    const results = rights.checkMany([
      { flags: Flags.READ, path: '/users' },
      { flags: Flags.WRITE, path: '/posts' },
      { flags: Flags.DELETE, path: '/admin' },
      { flags: Flags.CREATE, path: '/files' },
      { flags: Flags.EXECUTE, path: '/scripts' }
    ]);

    expect(results).toEqual([true, true, true, true, true]);
  });

  it('handles all denied permissions', () => {
    const rights = new Rights();
    rights.deny('/**', Flags.ALL);

    const results = rights.checkMany([
      { flags: Flags.READ, path: '/users' },
      { flags: Flags.WRITE, path: '/posts' },
      { flags: Flags.DELETE, path: '/admin' }
    ]);

    expect(results).toEqual([false, false, false]);
  });

  it('handles mixed results', () => {
    const rights = new Rights();
    rights.allow('/users/*', Flags.READ);
    rights.deny('/admin/*', Flags.ALL);

    const results = rights.checkMany([
      { flags: Flags.READ, path: '/users/1' },
      { flags: Flags.WRITE, path: '/users/2' },
      { flags: Flags.READ, path: '/admin' },
      { flags: Flags.READ, path: '/posts' }
    ]);

    expect(results).toEqual([true, false, false, false]);
  });

  it('handles composite flags', () => {
    const rights = new Rights();
    rights.allow('/full-access', Flags.READ, Flags.WRITE);

    const results = rights.checkMany([
      { flags: (Flags.READ | Flags.WRITE) as Flags, path: '/full-access' },
      { flags: Flags.READ, path: '/full-access' },
      { flags: Flags.WRITE, path: '/full-access' },
      { flags: Flags.DELETE, path: '/full-access' }
    ]);

    expect(results).toEqual([true, true, true, false]);
  });

  it('handles Flags.ALL', () => {
    const rights = new Rights();
    rights.allow('/admin', Flags.ALL);
    rights.deny('/user', Flags.DELETE);

    const results = rights.checkMany([
      { flags: Flags.ALL, path: '/admin' },
      { flags: Flags.ALL, path: '/user' },
      { flags: Flags.READ, path: '/user' }
    ]);

    expect(results).toEqual([true, false, false]);
  });

  it('respects shared context', () => {
    const rights = new Rights();
    rights.add(
      new Right('/posts/*', {
        allow: [Flags.WRITE],
        condition: ctx =>
          (ctx as { userId: string }).userId ===
          (ctx as { ownerId: string }).ownerId
      })
    );

    const results = rights.checkMany(
      [
        { flags: Flags.WRITE, path: '/posts/1' },
        { flags: Flags.WRITE, path: '/posts/2' }
      ],
      { ownerId: 'user1', userId: 'user1' }
    );

    expect(results).toEqual([true, true]);
  });

  it('normalizes paths correctly', () => {
    const rights = new Rights();
    rights.allow('/users/*', Flags.READ);

    const results = rights.checkMany([
      { flags: Flags.READ, path: 'users/1' },
      { flags: Flags.READ, path: 'users/2/' },
      { flags: Flags.READ, path: '/users/3' }
    ]);

    expect(results).toEqual([true, true, true]);
  });

  it('maintains order with results matching input order', () => {
    const rights = new Rights();
    rights.allow('/allowed', Flags.READ);
    rights.deny('/denied', Flags.READ);

    const results = rights.checkMany([
      { flags: Flags.READ, path: '/denied' },
      { flags: Flags.READ, path: '/allowed' },
      { flags: Flags.READ, path: '/denied' },
      { flags: Flags.READ, path: '/allowed' }
    ]);

    expect(results).toEqual([false, true, false, true]);
  });

  it('is consistent with individual has() calls', () => {
    const rights = new Rights();
    rights.allow('/users/*', Flags.READ);
    rights.allow('/posts/*', Flags.WRITE);
    rights.deny('/admin', Flags.ALL);

    const requests = [
      { flags: Flags.READ, path: '/users/1' },
      { flags: Flags.WRITE, path: '/posts/1' },
      { flags: Flags.ALL, path: '/admin' },
      { flags: Flags.READ, path: '/other' }
    ];

    const batchResults = rights.checkMany(requests);
    const individualResults = requests.map(req =>
      rights.has(req.path, req.flags)
    );

    expect(batchResults).toEqual(individualResults);
  });

  it('handles wildcard patterns correctly', () => {
    const rights = new Rights();
    rights.allow('/api/**', Flags.READ);

    const results = rights.checkMany([
      { flags: Flags.READ, path: '/api/users' },
      { flags: Flags.READ, path: '/api/posts/1' },
      { flags: Flags.READ, path: '/api/v1/users/123/posts/456' },
      { flags: Flags.READ, path: '/external/users' }
    ]);

    expect(results).toEqual([true, true, true, false]);
  });

  it('handles priority correctly', () => {
    const rights = new Rights();
    rights.add(
      new Right('/posts/123', { allow: [Flags.READ], deny: [Flags.WRITE] })
    );
    rights.add(
      new Right('/posts/*', {
        allow: [Flags.READ, Flags.WRITE],
        priority: 100
      })
    );

    const results = rights.checkMany([
      { flags: Flags.READ, path: '/posts/123' },
      { flags: Flags.WRITE, path: '/posts/123' },
      { flags: Flags.WRITE, path: '/posts/456' }
    ]);

    expect(results).toEqual([true, true, true]);
  });
});

describe('Rights.remove', () => {
  it('removes an existing right and returns true', () => {
    const rights = new Rights();
    const right = new Right('/users', { allow: [Flags.READ] });
    rights.add(right);

    expect(rights.allRights()).toHaveLength(1);

    const result = rights.remove(right);

    expect(result).toBe(true);
    expect(rights.allRights()).toHaveLength(0);
  });

  it('returns false when removing a non-existent right', () => {
    const rights = new Rights();
    const right1 = new Right('/users', { allow: [Flags.READ] });
    const right2 = new Right('/posts', { allow: [Flags.WRITE] });
    rights.add(right1);

    const result = rights.remove(right2);

    expect(result).toBe(false);
    expect(rights.allRights()).toHaveLength(1);
  });

  it('clears match cache after removal', () => {
    const rights = new Rights();
    const generalRight = new Right('/', { allow: [Flags.READ] });
    const specificRight = new Right('/users', {
      deny: [Flags.READ],
      priority: 100
    });
    rights.add(generalRight);
    rights.add(specificRight);

    // Before removal: specific deny should block read
    expect(rights.read('/users')).toBe(false);

    // Remove the deny rule
    rights.remove(specificRight);

    // After removal: general allow should permit read
    expect(rights.read('/users')).toBe(true);
  });

  it('triggers onChange notification', () => {
    const rights = new Rights();
    const right = new Right('/users', { allow: [Flags.READ] });
    rights.add(right);

    let notified = false;
    rights.onChange = () => {
      notified = true;
    };

    rights.remove(right);

    expect(notified).toBe(true);
  });

  it('does not trigger onChange when removing non-existent right', () => {
    const rights = new Rights();
    const right1 = new Right('/users', { allow: [Flags.READ] });
    const right2 = new Right('/posts', { allow: [Flags.WRITE] });
    rights.add(right1);

    let notified = false;
    rights.onChange = () => {
      notified = true;
    };

    rights.remove(right2);

    expect(notified).toBe(false);
  });

  it('removes the correct right when multiple rights exist', () => {
    const rights = new Rights();
    const right1 = new Right('/users', { allow: [Flags.READ] });
    const right2 = new Right('/posts', { allow: [Flags.WRITE] });
    const right3 = new Right('/admin', { allow: [Flags.ALL] });
    rights.add(right1);
    rights.add(right2);
    rights.add(right3);

    rights.remove(right2);

    const remaining = rights.allRights();
    expect(remaining).toHaveLength(2);
    expect(remaining).toContain(right1);
    expect(remaining).not.toContain(right2);
    expect(remaining).toContain(right3);
  });
});
