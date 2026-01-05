// Types
export type {
  BaseAdapterOptions,
  DatabaseAdapter,
  RightsRow,
  RoleInheritanceRow,
  RoleRightRow,
  RoleRow,
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

// SQLite adapter
export { SQLiteAdapter } from './sqlite-adapter';
export type { SQLiteAdapterOptions } from './sqlite-adapter';

// PostgreSQL adapter
export { PostgresAdapter } from './postgres-adapter';
export type { PostgresAdapterOptions } from './postgres-adapter';

// Factory functions
export {
  createPostgresRegistry,
  createPostgresRights,
  createSQLiteRegistry,
  createSQLiteRights
} from './factories';
export type {
  CreatePostgresRegistryOptions,
  CreateSQLiteRightsOptions
} from './factories';
