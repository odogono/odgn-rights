// Types
export type {
  BaseAdapterOptions,
  DatabaseAdapter,
  RegistryCommitResult,
  RevisionedRoleSummaries,
  RightsRow,
  RoleInheritanceRow,
  RoleRightRow,
  RoleRow,
  RoleRegistrySnapshot,
  RoleSummary,
  RoleSummaryQuery,
  SubjectRightRow,
  SubjectRoleRow,
  SubjectRow,
  TableNames
} from './types';

// Schema utilities
export {
  createTableNames,
  DEFAULT_TABLE_PREFIX,
  generatePostgresDropSchema,
  generatePostgresSchema,
  generateSQLiteDropSchema,
  generateSQLiteSchema
} from './schema';

// Base adapter
export { BaseAdapter } from './base-adapter';
export { RoleRegistryRevisionError } from './errors';

// SQLite adapter
export { SQLiteAdapter } from './sqlite-adapter';
export type { SQLiteAdapterOptions } from './sqlite-adapter';

// PostgreSQL adapter
export { PostgresAdapter } from './postgres-adapter';
export type { PostgresAdapterOptions } from './postgres-adapter';

// Redis adapter
export { RedisAdapter } from './redis-adapter';
export type { RedisAdapterOptions } from './redis-adapter';

// Factory functions
export {
  createPostgresRegistry,
  createPostgresRights,
  createRedisRegistry,
  createRedisRights,
  createSQLiteRegistry,
  createSQLiteRights
} from './factories';
export type {
  CreatePostgresRegistryOptions,
  CreateRedisRightsOptions,
  CreateSQLiteRightsOptions
} from './factories';
