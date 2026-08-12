import type { TableNames } from './types';

/**
 * Default table prefix for all adapter tables
 */
export const DEFAULT_TABLE_PREFIX = 'tbl_';

/**
 * Generate table names with the given prefix
 */
export const createTableNames = (
  prefix: string = DEFAULT_TABLE_PREFIX
): TableNames => ({
  rights: `${prefix}rights`,
  roleInheritance: `${prefix}role_inheritance`,
  roleRegistryState: `${prefix}role_registry_state`,
  roleRights: `${prefix}role_rights`,
  roles: `${prefix}roles`,
  subjectRights: `${prefix}subject_rights`,
  subjectRoles: `${prefix}subject_roles`,
  subjects: `${prefix}subjects`
});

/**
 * Generate SQLite schema with the given table names
 */
export const generateSQLiteSchema = (tables: TableNames): string => `
-- Rights table
CREATE TABLE IF NOT EXISTS ${tables.rights} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  allow_mask INTEGER NOT NULL DEFAULT 0,
  deny_mask INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  tags TEXT,
  valid_from TEXT,
  valid_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(path, allow_mask, deny_mask, priority, valid_from, valid_until)
);

-- Roles table
CREATE TABLE IF NOT EXISTS ${tables.roles} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ${tables.roleRegistryState} (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO ${tables.roleRegistryState} (singleton, revision) VALUES (1, 0);

-- Role-Rights junction table
CREATE TABLE IF NOT EXISTS ${tables.roleRights} (
  role_id INTEGER NOT NULL,
  right_id INTEGER NOT NULL,
  PRIMARY KEY (role_id, right_id),
  FOREIGN KEY (role_id) REFERENCES ${tables.roles}(id) ON DELETE CASCADE,
  FOREIGN KEY (right_id) REFERENCES ${tables.rights}(id) ON DELETE CASCADE
);

-- Role inheritance table
CREATE TABLE IF NOT EXISTS ${tables.roleInheritance} (
  child_role_id INTEGER NOT NULL,
  parent_role_id INTEGER NOT NULL,
  PRIMARY KEY (child_role_id, parent_role_id),
  FOREIGN KEY (child_role_id) REFERENCES ${tables.roles}(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_role_id) REFERENCES ${tables.roles}(id) ON DELETE CASCADE
);

-- Subjects table
CREATE TABLE IF NOT EXISTS ${tables.subjects} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Subject-Roles junction table
CREATE TABLE IF NOT EXISTS ${tables.subjectRoles} (
  subject_id INTEGER NOT NULL,
  role_id INTEGER NOT NULL,
  PRIMARY KEY (subject_id, role_id),
  FOREIGN KEY (subject_id) REFERENCES ${tables.subjects}(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES ${tables.roles}(id) ON DELETE CASCADE
);

-- Subject-Rights junction table (direct rights)
CREATE TABLE IF NOT EXISTS ${tables.subjectRights} (
  subject_id INTEGER NOT NULL,
  right_id INTEGER NOT NULL,
  PRIMARY KEY (subject_id, right_id),
  FOREIGN KEY (subject_id) REFERENCES ${tables.subjects}(id) ON DELETE CASCADE,
  FOREIGN KEY (right_id) REFERENCES ${tables.rights}(id) ON DELETE CASCADE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_${tables.rights}_path ON ${tables.rights}(path);
CREATE INDEX IF NOT EXISTS idx_${tables.rights}_valid_dates ON ${tables.rights}(valid_from, valid_until);
CREATE INDEX IF NOT EXISTS idx_${tables.roles}_name ON ${tables.roles}(name);
`;

/**
 * Generate PostgreSQL schema with the given table names
 */
export const generatePostgresSchema = (tables: TableNames): string => `
-- Rights table
CREATE TABLE IF NOT EXISTS ${tables.rights} (
  id SERIAL PRIMARY KEY,
  path TEXT NOT NULL,
  allow_mask INTEGER NOT NULL DEFAULT 0,
  deny_mask INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  tags TEXT,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(path, allow_mask, deny_mask, priority, valid_from, valid_until)
);

-- Roles table
CREATE TABLE IF NOT EXISTS ${tables.roles} (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ${tables.roleRegistryState} (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision BIGINT NOT NULL DEFAULT 0
);
INSERT INTO ${tables.roleRegistryState} (singleton, revision) VALUES (1, 0)
ON CONFLICT (singleton) DO NOTHING;

-- Role-Rights junction table
CREATE TABLE IF NOT EXISTS ${tables.roleRights} (
  role_id INTEGER NOT NULL REFERENCES ${tables.roles}(id) ON DELETE CASCADE,
  right_id INTEGER NOT NULL REFERENCES ${tables.rights}(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, right_id)
);

-- Role inheritance table
CREATE TABLE IF NOT EXISTS ${tables.roleInheritance} (
  child_role_id INTEGER NOT NULL REFERENCES ${tables.roles}(id) ON DELETE CASCADE,
  parent_role_id INTEGER NOT NULL REFERENCES ${tables.roles}(id) ON DELETE CASCADE,
  PRIMARY KEY (child_role_id, parent_role_id)
);

-- Subjects table
CREATE TABLE IF NOT EXISTS ${tables.subjects} (
  id SERIAL PRIMARY KEY,
  identifier TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Subject-Roles junction table
CREATE TABLE IF NOT EXISTS ${tables.subjectRoles} (
  subject_id INTEGER NOT NULL REFERENCES ${tables.subjects}(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES ${tables.roles}(id) ON DELETE CASCADE,
  PRIMARY KEY (subject_id, role_id)
);

-- Subject-Rights junction table (direct rights)
CREATE TABLE IF NOT EXISTS ${tables.subjectRights} (
  subject_id INTEGER NOT NULL REFERENCES ${tables.subjects}(id) ON DELETE CASCADE,
  right_id INTEGER NOT NULL REFERENCES ${tables.rights}(id) ON DELETE CASCADE,
  PRIMARY KEY (subject_id, right_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_${tables.rights}_path ON ${tables.rights}(path);
CREATE INDEX IF NOT EXISTS idx_${tables.rights}_valid_dates ON ${tables.rights}(valid_from, valid_until);
CREATE INDEX IF NOT EXISTS idx_${tables.roles}_name ON ${tables.roles}(name);
`;

/**
 * Generate SQLite statements to drop all tables (useful for testing)
 */
export const generateSQLiteDropSchema = (tables: TableNames): string => `
DROP TABLE IF EXISTS ${tables.subjectRights};
DROP TABLE IF EXISTS ${tables.subjectRoles};
DROP TABLE IF EXISTS ${tables.subjects};
DROP TABLE IF EXISTS ${tables.roleInheritance};
DROP TABLE IF EXISTS ${tables.roleRights};
DROP TABLE IF EXISTS ${tables.roleRegistryState};
DROP TABLE IF EXISTS ${tables.roles};
DROP TABLE IF EXISTS ${tables.rights};
`;

/**
 * Generate PostgreSQL statements to drop all tables (useful for testing)
 */
export const generatePostgresDropSchema = (tables: TableNames): string => `
DROP TABLE IF EXISTS ${tables.subjectRights} CASCADE;
DROP TABLE IF EXISTS ${tables.subjectRoles} CASCADE;
DROP TABLE IF EXISTS ${tables.subjects} CASCADE;
DROP TABLE IF EXISTS ${tables.roleInheritance} CASCADE;
DROP TABLE IF EXISTS ${tables.roleRights} CASCADE;
DROP TABLE IF EXISTS ${tables.roleRegistryState} CASCADE;
DROP TABLE IF EXISTS ${tables.roles} CASCADE;
DROP TABLE IF EXISTS ${tables.rights} CASCADE;
`;
