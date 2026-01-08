import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { SQLiteAdapter } from '@/adapters/sqlite-adapter';
import { Flags, Role, RoleRegistry } from '@/index';

describe('Phase 4: Integration with Core Classes', () => {
  let adapter: SQLiteAdapter;

  beforeEach(async () => {
    adapter = new SQLiteAdapter({ filename: ':memory:' });
    await adapter.connect();
    await adapter.migrate();
    adapter.prepareStatementsAfterMigration();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  describe('RoleRegistry convenience methods', () => {
    test('loadFrom creates RoleRegistry from adapter', async () => {
      const viewer = new Role('viewer');
      viewer.rights.allow('/read/*', Flags.READ);

      const editor = new Role('editor');
      editor.rights.allow('/write/*', Flags.WRITE);
      editor.inheritsFrom(viewer);

      await adapter.saveRole(viewer);
      await adapter.saveRole(editor);

      const registry = await RoleRegistry.loadFrom(adapter);

      expect(registry.get('viewer')).not.toBeUndefined();
      expect(registry.get('editor')).not.toBeUndefined();

      const loadedEditor = registry.get('editor');
      expect(loadedEditor).not.toBeUndefined();
      const editorRights = loadedEditor!.allRights();
      expect(editorRights.length).toBeGreaterThan(0);
    });

    test('saveTo persists RoleRegistry to adapter', async () => {
      const registry = new RoleRegistry();
      const viewer = registry.define('viewer');
      viewer.rights.allow('/read/*', Flags.READ);

      const editor = registry.define('editor');
      editor.rights.allow('/write/*', Flags.WRITE);
      editor.inheritsFrom(viewer);

      await registry.saveTo(adapter);

      const loaded = await adapter.loadRegistry();
      expect(loaded.get('viewer')).not.toBeUndefined();
      expect(loaded.get('editor')).not.toBeUndefined();

      const loadedEditor = loaded.get('editor');
      expect(loadedEditor).not.toBeUndefined();
      const editorRights = loadedEditor!.allRights();
      expect(editorRights.length).toBeGreaterThan(0);
    });

    test('loadFrom and saveTo round-trip', async () => {
      const original = new RoleRegistry();
      const viewer = original.define('viewer');
      viewer.rights.allow('/read/*', Flags.READ);

      const editor = original.define('editor');
      editor.rights.allow('/write/*', Flags.WRITE);
      editor.inheritsFrom(viewer);

      await original.saveTo(adapter);
      const loaded = await RoleRegistry.loadFrom(adapter);

      expect(loaded.get('viewer')).not.toBeUndefined();
      expect(loaded.get('editor')).not.toBeUndefined();

      const loadedViewer = loaded.get('viewer');
      expect(loadedViewer).not.toBeUndefined();
      expect(loadedViewer!.rights.has('/read/file.txt', Flags.READ)).toBe(true);

      const loadedEditor = loaded.get('editor');
      expect(loadedEditor).not.toBeUndefined();
      expect(loadedEditor!.rights.has('/write/file.txt', Flags.WRITE)).toBe(
        true
      );
      expect(loadedEditor!.rights.has('/read/file.txt', Flags.READ)).toBe(
        false
      );
      expect(loadedEditor!.parents.length).toBe(1);
      expect(loadedEditor!.parents[0]?.name).toBe('viewer');

      const editorAllRights = loadedEditor!.allRights();
      const hasReadRight = editorAllRights.some(
        entry =>
          entry.right.path === '/read/*' &&
          entry.right.has(Flags.READ) &&
          entry.source?.name === 'viewer'
      );
      const hasWriteRight = editorAllRights.some(
        entry =>
          entry.right.path === '/write/*' &&
          entry.right.has(Flags.WRITE) &&
          entry.source?.name === 'editor'
      );
      expect(hasReadRight).toBe(true);
      expect(hasWriteRight).toBe(true);
    });
  });

  describe('Right persistence metadata', () => {
    test('Right has dbId property', async () => {
      const { Right } = await import('../../index');
      const right = new Right('/test', { allow: [Flags.READ] });

      expect(right.dbId).toBeUndefined();

      await adapter.saveRight(right);

      expect(right.dbId).toBeGreaterThan(0);
    });

    test('dbId can be set via _setDbId', async () => {
      const { Right } = await import('../../index');
      const right = new Right('/test', { allow: [Flags.READ] });

      right._setDbId(123);

      expect(right.dbId).toBe(123);
    });
  });

  describe('Factory functions', () => {
    test('createSQLiteRegistry returns adapter and registry', async () => {
      const { createSQLiteRegistry } = await import('@/adapters');

      const { adapter, registry } = await createSQLiteRegistry({
        filename: ':memory:'
      });

      expect(adapter).not.toBeNull();
      expect(registry).not.toBeNull();

      await adapter.disconnect();
    });

    test('createSQLiteRegistry creates empty registry by default', async () => {
      const { createSQLiteRegistry } = await import('@/adapters');

      const { adapter, registry } = await createSQLiteRegistry({
        filename: ':memory:'
      });

      expect(registry.toJSON()).toHaveLength(0);

      await adapter.disconnect();
    });

    test('createPostgresRegistry and createPostgresRights exist', async () => {
      const { createPostgresRegistry, createPostgresRights } = await import(
        '@/adapters'
      );

      expect(typeof createPostgresRegistry).toBe('function');
      expect(typeof createPostgresRights).toBe('function');
    });
  });
});
