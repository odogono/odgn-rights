import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { SQLiteAdapter } from '@/adapters/sqlite-adapter';
import { Flags, Right } from '@/index';

describe('SQLiteAdapter with custom table prefix', () => {
  let adapter: SQLiteAdapter;

  beforeEach(async () => {
    adapter = new SQLiteAdapter({
      filename: ':memory:',
      tablePrefix: 'auth_'
    });
    await adapter.connect();
    await adapter.migrate();
    adapter.prepareStatementsAfterMigration();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  test('creates tables with custom prefix', async () => {
    await adapter.saveRight(new Right('/users', { allow: [Flags.READ] }));

    const rights = await adapter.loadRights();
    expect(rights.allRights()).toHaveLength(1);
  });
});

describe('SQLiteAdapter with no prefix', () => {
  let adapter: SQLiteAdapter;

  beforeEach(async () => {
    adapter = new SQLiteAdapter({
      filename: ':memory:',
      tablePrefix: ''
    });
    await adapter.connect();
    await adapter.migrate();
    adapter.prepareStatementsAfterMigration();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  test('creates tables without prefix', async () => {
    await adapter.saveRight(new Right('/users', { allow: [Flags.READ] }));

    const rights = await adapter.loadRights();
    expect(rights.allRights()).toHaveLength(1);
  });
});
