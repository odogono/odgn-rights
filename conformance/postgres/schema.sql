
-- Rights table
CREATE TABLE IF NOT EXISTS {{prefix}}rights (
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
CREATE TABLE IF NOT EXISTS {{prefix}}roles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS {{prefix}}role_registry_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision BIGINT NOT NULL DEFAULT 0
);
INSERT INTO {{prefix}}role_registry_state (singleton, revision) VALUES (1, 0)
ON CONFLICT (singleton) DO NOTHING;

-- Role-Rights junction table
CREATE TABLE IF NOT EXISTS {{prefix}}role_rights (
  role_id INTEGER NOT NULL REFERENCES {{prefix}}roles(id) ON DELETE CASCADE,
  right_id INTEGER NOT NULL REFERENCES {{prefix}}rights(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, right_id)
);

-- Role inheritance table
CREATE TABLE IF NOT EXISTS {{prefix}}role_inheritance (
  child_role_id INTEGER NOT NULL REFERENCES {{prefix}}roles(id) ON DELETE CASCADE,
  parent_role_id INTEGER NOT NULL REFERENCES {{prefix}}roles(id) ON DELETE CASCADE,
  PRIMARY KEY (child_role_id, parent_role_id)
);

-- Subjects table
CREATE TABLE IF NOT EXISTS {{prefix}}subjects (
  id SERIAL PRIMARY KEY,
  identifier TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Subject-Roles junction table
CREATE TABLE IF NOT EXISTS {{prefix}}subject_roles (
  subject_id INTEGER NOT NULL REFERENCES {{prefix}}subjects(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES {{prefix}}roles(id) ON DELETE CASCADE,
  PRIMARY KEY (subject_id, role_id)
);

-- Subject-Rights junction table (direct rights)
CREATE TABLE IF NOT EXISTS {{prefix}}subject_rights (
  subject_id INTEGER NOT NULL REFERENCES {{prefix}}subjects(id) ON DELETE CASCADE,
  right_id INTEGER NOT NULL REFERENCES {{prefix}}rights(id) ON DELETE CASCADE,
  PRIMARY KEY (subject_id, right_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_{{prefix}}rights_path ON {{prefix}}rights(path);
CREATE INDEX IF NOT EXISTS idx_{{prefix}}rights_valid_dates ON {{prefix}}rights(valid_from, valid_until);
CREATE INDEX IF NOT EXISTS idx_{{prefix}}roles_name ON {{prefix}}roles(name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_{{prefix}}rights_identity ON {{prefix}}rights (path, allow_mask, deny_mask, priority,
  (COALESCE(valid_from, '-infinity'::timestamptz)),
  (COALESCE(valid_until, 'infinity'::timestamptz)));
