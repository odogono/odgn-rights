import { Flags } from '../constants';
import type { Right } from '../right';
import type { Rights } from '../rights';
import type { Role } from '../role';
import type { RoleRegistry } from '../role-registry';
import type { Subject } from '../subject';

// ============================================================================
// Database Row Types
// ============================================================================

export type RightsRow = {
  allow_mask: number;
  created_at: string;
  deny_mask: number;
  description: string | null;
  id: number;
  path: string;
  priority: number;
  tags: string | null; // JSON array string
  updated_at: string;
  valid_from: string | null; // ISO 8601 timestamp
  valid_until: string | null; // ISO 8601 timestamp
};

export type RoleRow = {
  created_at: string;
  id: number;
  name: string;
  updated_at: string;
};

export type RoleRightRow = {
  right_id: number;
  role_id: number;
};

export type RoleInheritanceRow = {
  child_role_id: number;
  parent_role_id: number;
};

export type SubjectRow = {
  created_at: string;
  id: number;
  identifier: string; // External subject identifier
  updated_at: string;
};

export type SubjectRoleRow = {
  role_id: number;
  subject_id: number;
};

export type SubjectRightRow = {
  right_id: number;
  subject_id: number;
};

// ============================================================================
// Adapter Configuration Types
// ============================================================================

/**
 * Base configuration shared by all adapters
 */
export type BaseAdapterOptions = {
  /**
   * Prefix for all table names. Defaults to 'tbl_'.
   * Set to empty string '' for no prefix.
   */
  tablePrefix?: string;
};

/**
 * Table names with the configured prefix applied
 */
export type TableNames = {
  rights: string;
  roleInheritance: string;
  roleRights: string;
  roles: string;
  subjectRights: string;
  subjectRoles: string;
  subjects: string;
};

// ============================================================================
// Database Adapter Interface
// ============================================================================

/**
 * Common interface for all database adapters.
 * Supports both synchronous (SQLite) and asynchronous (PostgreSQL) patterns
 * by using Promise-based methods throughout.
 */
export type DatabaseAdapter = {
  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Clear all data from the database (useful for testing)
   */
  clear(): Promise<void>;

  /**
   * Connect to the database
   */
  connect(): Promise<void>;

  /**
   * Delete a right by its database ID
   * @returns true if the right was deleted, false if not found
   */
  deleteRight(id: number): Promise<boolean>;

  // -------------------------------------------------------------------------
  // Rights Operations
  // -------------------------------------------------------------------------

  /**
   * Delete a role by name
   * @returns true if the role was deleted, false if not found
   */
  deleteRole(name: string): Promise<boolean>;

  /**
   * Delete a subject by its external identifier
   * @returns true if the subject was deleted, false if not found
   */
  deleteSubject(identifier: string): Promise<boolean>;

  /**
   * Disconnect from the database
   */
  disconnect(): Promise<void>;

  /**
   * Find all subject identifiers that have access to a specific path with given flags
   * @param pathPattern The path pattern to check (supports wildcards)
   * @param flags The flags to check for
   * @returns Array of subject identifiers that have access
   */
  findSubjectsWithAccess(pathPattern: string, flags: Flags): Promise<string[]>;

  /**
   * Load all roles into a new RoleRegistry
   */
  loadRegistry(): Promise<RoleRegistry>;

  /**
   * Load a right by its database ID
   */
  loadRight(id: number): Promise<Right | null>;

  // -------------------------------------------------------------------------
  // Role Operations
  // -------------------------------------------------------------------------

  /**
   * Load all rights from the database
   */
  loadRights(): Promise<Rights>;

  /**
   * Load rights matching a path pattern
   */
  loadRightsByPath(pathPattern: string): Promise<Rights>;

  /**
   * Load a role by name
   */
  loadRole(name: string): Promise<Role | null>;

  /**
   * Load all roles from the database
   */
  loadRoles(): Promise<Role[]>;

  // -------------------------------------------------------------------------
  // RoleRegistry Operations
  // -------------------------------------------------------------------------

  /**
   * Load a subject by its external identifier
   */
  loadSubject(identifier: string): Promise<Subject | null>;

  /**
   * Run database migrations to create or update schema
   */
  migrate(): Promise<void>;

  // -------------------------------------------------------------------------
  // Subject Operations
  // -------------------------------------------------------------------------

  /**
   * Save an entire role registry to the database
   */
  saveRegistry(registry: RoleRegistry): Promise<void>;

  /**
   * Save a single right to the database
   * @returns The database ID of the saved right
   */
  saveRight(right: Right): Promise<number>;

  /**
   * Save multiple rights to the database
   * @returns Array of database IDs for the saved rights
   */
  saveRights(rights: Rights): Promise<number[]>;

  // -------------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------------

  /**
   * Save a role and its rights to the database
   * @returns The database ID of the saved role
   */
  saveRole(role: Role): Promise<number>;

  /**
   * Save a subject with its roles and direct rights
   * @param identifier External identifier for the subject (e.g., user ID)
   * @param subject The subject to save
   * @returns The database ID of the saved subject
   */
  saveSubject(identifier: string, subject: Subject): Promise<number>;

  // -------------------------------------------------------------------------
  // Transaction Support
  // -------------------------------------------------------------------------
  // Transaction Support
  // -------------------------------------------------------------------------

  /**
   * Execute operations within a transaction.
   * The transaction will be committed if the function succeeds,
   * or rolled back if it throws an error.
   */
  transaction<T>(fn: (adapter: DatabaseAdapter) => Promise<T>): Promise<T>;
};
