// Package postgres loads Rights, Roles and Subjects that the TypeScript
// PostgresAdapter saved, so a Go service can answer checks against the same
// tables. It only reads: saving stays with the TypeScript adapter.
//
// It uses database/sql, so any Postgres driver works; with pgx, open the
// connection through github.com/jackc/pgx/v5/stdlib.
package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"

	"odgn.net/rights"
)

// DefaultTablePrefix starts every table name, as in the TypeScript adapter.
const DefaultTablePrefix = "tbl_"

// Querier runs queries. *sql.DB, *sql.Conn and *sql.Tx all satisfy it, so an
// Adapter can read inside a transaction the caller owns.
type Querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// Tables names the eight tables, as the TypeScript createTableNames does.
type Tables struct {
	Rights            string
	Roles             string
	RoleRights        string
	RoleInheritance   string
	RoleRegistryState string
	Subjects          string
	SubjectRoles      string
	SubjectRights     string
}

var identifier = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// TableNames returns the table names for a prefix. The prefix becomes part of
// SQL identifiers, so it may contain only letters, digits and underscores.
func TableNames(prefix string) (Tables, error) {
	if prefix != "" && !identifier.MatchString(prefix) {
		return Tables{}, fmt.Errorf("postgres: invalid table prefix %q", prefix)
	}
	return Tables{
		Rights:            prefix + "rights",
		Roles:             prefix + "roles",
		RoleRights:        prefix + "role_rights",
		RoleInheritance:   prefix + "role_inheritance",
		RoleRegistryState: prefix + "role_registry_state",
		Subjects:          prefix + "subjects",
		SubjectRoles:      prefix + "subject_roles",
		SubjectRights:     prefix + "subject_rights",
	}, nil
}

// Adapter reads from one set of tables.
type Adapter struct {
	db     Querier
	tables Tables
}

// New returns an Adapter over db for tables named with prefix.
func New(db Querier, prefix string) (*Adapter, error) {
	tables, err := TableNames(prefix)
	if err != nil {
		return nil, err
	}
	return &Adapter{db: db, tables: tables}, nil
}

// Bind returns an Adapter that runs every query on q, such as a transaction
// the caller owns.
func (a *Adapter) Bind(q Querier) *Adapter {
	return &Adapter{db: q, tables: a.tables}
}

// LoadRegistryRevision returns the role registry's current Revision, or 0
// when none has been recorded.
func (a *Adapter) LoadRegistryRevision(ctx context.Context) (int64, error) {
	var revision int64
	err := a.db.QueryRowContext(ctx,
		`SELECT revision FROM `+a.tables.RoleRegistryState+` WHERE singleton = 1`,
	).Scan(&revision)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("postgres: load registry revision: %w", err)
	}
	return revision, nil
}

// Snapshot is a role registry with the Revision it was read at.
type Snapshot struct {
	Registry *rights.RoleRegistry
	Revision int64
}

// LoadRegistrySnapshot reads the registry and its Revision from one
// committed state, in a read-only repeatable-read transaction of its own on
// db, which must be a *sql.DB. The TypeScript adapter instead takes a shared
// lock on the revision row; a repeatable-read snapshot gives the same pairing
// without waiting on a registry change still in progress.
func LoadRegistrySnapshot(ctx context.Context, db *sql.DB, prefix string) (Snapshot, error) {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return Snapshot{}, fmt.Errorf("postgres: begin snapshot: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	adapter, err := New(tx, prefix)
	if err != nil {
		return Snapshot{}, err
	}
	revision, err := adapter.LoadRegistryRevision(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	if afterSnapshotRevision != nil {
		afterSnapshotRevision()
	}
	registry, err := adapter.LoadRegistry(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	return Snapshot{Registry: registry, Revision: revision}, tx.Commit()
}

// afterSnapshotRevision runs between a snapshot's revision and role reads.
// Tests use it to commit a change there.
var afterSnapshotRevision func()

// rightColumns are a rights row's columns, from the table aliased r, in the
// order nullableRightRow.scanTargets lists them.
const rightColumns = `r.id, r.path, r.allow_mask, r.deny_mask, r.priority, r.description, r.tags, r.valid_from, r.valid_until`

// LoadRegistry reads every role with its rights and inheritance. Roles are
// defined in id order and each role's rights added in right-id order, as the
// TypeScript adapter does.
func (a *Adapter) LoadRegistry(ctx context.Context) (*rights.RoleRegistry, error) {
	t := a.tables
	rows, err := a.db.QueryContext(ctx, `
		SELECT role.id, role.name, `+rightColumns+`
		FROM `+t.Roles+` role
		LEFT JOIN `+t.RoleRights+` role_right ON role_right.role_id = role.id
		LEFT JOIN `+t.Rights+` r ON r.id = role_right.right_id
		ORDER BY role.id, r.id`)
	if err != nil {
		return nil, fmt.Errorf("postgres: load roles: %w", err)
	}
	defer rows.Close()

	registry := rights.NewRoleRegistry()
	byID := map[int64]*rights.Role{}
	for rows.Next() {
		var roleID int64
		var roleName string
		var row nullableRightRow
		if err := rows.Scan(append([]any{&roleID, &roleName}, row.scanTargets()...)...); err != nil {
			return nil, fmt.Errorf("postgres: read role: %w", err)
		}
		role := byID[roleID]
		if role == nil {
			role, err = registry.Define(roleName, nil)
			if err != nil {
				return nil, fmt.Errorf("postgres: define role %q: %w", roleName, err)
			}
			byID[roleID] = role
		}
		if !row.id.Valid {
			continue // a role with no rights
		}
		right, err := row.right()
		if err != nil {
			return nil, fmt.Errorf("postgres: role %q: %w", roleName, err)
		}
		if err := role.Rights().Add(right); err != nil {
			return nil, fmt.Errorf("postgres: role %q: %w", roleName, err)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("postgres: load roles: %w", err)
	}

	inherit, err := a.db.QueryContext(ctx,
		`SELECT child_role_id, parent_role_id FROM `+t.RoleInheritance+` ORDER BY child_role_id, parent_role_id`)
	if err != nil {
		return nil, fmt.Errorf("postgres: load inheritance: %w", err)
	}
	defer inherit.Close()
	for inherit.Next() {
		var childID, parentID int64
		if err := inherit.Scan(&childID, &parentID); err != nil {
			return nil, fmt.Errorf("postgres: read inheritance: %w", err)
		}
		child, parent := byID[childID], byID[parentID]
		if child == nil || parent == nil {
			continue // a link to a role that no longer exists, as TypeScript skips it
		}
		if err := child.InheritFrom(parent); err != nil {
			return nil, fmt.Errorf("postgres: role %q inherits %q: %w", child.Name(), parent.Name(), err)
		}
	}
	if err := inherit.Err(); err != nil {
		return nil, fmt.Errorf("postgres: load inheritance: %w", err)
	}
	return registry, nil
}

// LoadSubject reads the Subject saved under identifier, finding its roles in
// registry; a role the registry doesn't have is skipped, as in TypeScript.
// It returns nil and no error when no Subject is saved under identifier.
// Pass a registry from LoadRegistry or LoadRegistrySnapshot, sealed if it is
// shared between goroutines.
func (a *Adapter) LoadSubject(ctx context.Context, identifier string, registry *rights.RoleRegistry) (*rights.Subject, error) {
	t := a.tables
	rows, err := a.db.QueryContext(ctx, `
		SELECT subject.id, role.name
		FROM `+t.Subjects+` subject
		LEFT JOIN `+t.SubjectRoles+` subject_role ON subject_role.subject_id = subject.id
		LEFT JOIN `+t.Roles+` role ON role.id = subject_role.role_id
		WHERE subject.identifier = $1
		ORDER BY role.id`, identifier)
	if err != nil {
		return nil, fmt.Errorf("postgres: load subject: %w", err)
	}
	defer rows.Close()

	var subjectID int64
	found := false
	var roleNames []string
	for rows.Next() {
		var roleName sql.NullString
		if err := rows.Scan(&subjectID, &roleName); err != nil {
			return nil, fmt.Errorf("postgres: read subject: %w", err)
		}
		found = true
		if roleName.Valid {
			roleNames = append(roleNames, roleName.String)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("postgres: load subject: %w", err)
	}
	if !found {
		return nil, nil
	}

	subject := rights.NewSubject()
	for _, name := range roleNames {
		if role := registry.Get(name); role != nil {
			subject.MemberOf(role)
		}
	}

	direct, err := a.db.QueryContext(ctx, `
		SELECT `+rightColumns+`
		FROM `+t.SubjectRights+` subject_right
		JOIN `+t.Rights+` r ON r.id = subject_right.right_id
		WHERE subject_right.subject_id = $1
		ORDER BY r.id`, subjectID)
	if err != nil {
		return nil, fmt.Errorf("postgres: load subject rights: %w", err)
	}
	defer direct.Close()
	for direct.Next() {
		var row nullableRightRow
		if err := direct.Scan(row.scanTargets()...); err != nil {
			return nil, fmt.Errorf("postgres: read subject right: %w", err)
		}
		right, err := row.right()
		if err != nil {
			return nil, fmt.Errorf("postgres: subject %q: %w", identifier, err)
		}
		if err := subject.Rights().Add(right); err != nil {
			return nil, fmt.Errorf("postgres: subject %q: %w", identifier, err)
		}
	}
	if err := direct.Err(); err != nil {
		return nil, fmt.Errorf("postgres: load subject rights: %w", err)
	}
	return subject, nil
}

// nullableRightRow is one rights row; the id is null when a LEFT JOIN found no
// right.
type nullableRightRow struct {
	id          sql.NullInt64
	path        sql.NullString
	allowMask   sql.NullInt64
	denyMask    sql.NullInt64
	priority    sql.NullInt64
	description sql.NullString
	tags        sql.NullString
	validFrom   sql.NullTime
	validUntil  sql.NullTime
}

func (row *nullableRightRow) scanTargets() []any {
	return []any{&row.id, &row.path, &row.allowMask, &row.denyMask, &row.priority,
		&row.description, &row.tags, &row.validFrom, &row.validUntil}
}

// right builds the Right for a row, as the TypeScript rowToRight does.
func (row nullableRightRow) right() (*rights.Right, error) {
	opts := rights.RightOptions{
		Allow:       rights.Flags(row.allowMask.Int64) & rights.All,
		Deny:        rights.Flags(row.denyMask.Int64) & rights.All,
		Description: row.description.String,
		Priority:    int(row.priority.Int64),
		Tags:        tags(row.tags),
	}
	if row.validFrom.Valid {
		opts.ValidFrom = row.validFrom.Time
	}
	if row.validUntil.Valid {
		opts.ValidUntil = row.validUntil.Time
	}
	right, err := rights.NewRight(row.path.String, opts)
	if err != nil {
		return nil, fmt.Errorf("right %d (%s): %w", row.id.Int64, row.path.String, err)
	}
	return right, nil
}

// tags reads the JSON array the TypeScript adapter stores. Unreadable tags
// are treated as none, as TypeScript's deserializeTags does.
func tags(value sql.NullString) []string {
	if !value.Valid || value.String == "" {
		return nil
	}
	var out []string
	if err := json.Unmarshal([]byte(value.String), &out); err != nil {
		return nil
	}
	return out
}

// Compile-time checks that the standard handles satisfy Querier.
var (
	_ Querier = (*sql.DB)(nil)
	_ Querier = (*sql.Tx)(nil)
	_ Querier = (*sql.Conn)(nil)
)
