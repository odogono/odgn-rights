import { Rights, RoleRegistry } from '../index';
import {
  PostgresAdapter,
  type PostgresAdapterOptions
} from './postgres-adapter';
import { RedisAdapter, type RedisAdapterOptions } from './redis-adapter';
import { SQLiteAdapter, type SQLiteAdapterOptions } from './sqlite-adapter';

export type CreateSQLiteRightsOptions = SQLiteAdapterOptions;

export type CreatePostgresRegistryOptions = PostgresAdapterOptions;

export const createSQLiteRights = async (
  options: CreateSQLiteRightsOptions = {}
): Promise<{ adapter: SQLiteAdapter; rights: Rights }> => {
  const adapter = new SQLiteAdapter(options);
  await adapter.connect();
  await adapter.migrate();
  adapter.prepareStatementsAfterMigration();
  const rights = await adapter.loadRights();
  return { adapter, rights };
};

export const createPostgresRegistry = async (
  options: CreatePostgresRegistryOptions
): Promise<{ adapter: PostgresAdapter; registry: RoleRegistry }> => {
  const adapter = new PostgresAdapter(options);
  await adapter.connect();
  await adapter.migrate();
  const registry = await adapter.loadRegistry();
  return { adapter, registry };
};

export const createSQLiteRegistry = async (
  options: CreateSQLiteRightsOptions = {}
): Promise<{ adapter: SQLiteAdapter; registry: RoleRegistry }> => {
  const adapter = new SQLiteAdapter(options);
  await adapter.connect();
  await adapter.migrate();
  adapter.prepareStatementsAfterMigration();
  const registry = await adapter.loadRegistry();
  return { adapter, registry };
};

export const createPostgresRights = async (
  options: CreatePostgresRegistryOptions
): Promise<{ adapter: PostgresAdapter; rights: Rights }> => {
  const adapter = new PostgresAdapter(options);
  await adapter.connect();
  await adapter.migrate();
  const rights = await adapter.loadRights();
  return { adapter, rights };
};

// ===========================================================================
// Redis Factory Functions
// ===========================================================================

export type CreateRedisRightsOptions = RedisAdapterOptions;

export const createRedisRights = async (
  options: CreateRedisRightsOptions
): Promise<{ adapter: RedisAdapter; rights: Rights }> => {
  const adapter = new RedisAdapter(options);
  await adapter.connect();
  await adapter.migrate();
  const rights = await adapter.loadRights();
  return { adapter, rights };
};

export const createRedisRegistry = async (
  options: CreateRedisRightsOptions
): Promise<{ adapter: RedisAdapter; registry: RoleRegistry }> => {
  const adapter = new RedisAdapter(options);
  await adapter.connect();
  await adapter.migrate();
  const registry = await adapter.loadRegistry();
  return { adapter, registry };
};
