package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"odgn.net/rights"
)

func TestTablePrefixMustBeAnIdentifier(t *testing.T) {
	for _, prefix := range []string{"", "tbl_", "App2_"} {
		if _, err := TableNames(prefix); err != nil {
			t.Errorf("%q: %v", prefix, err)
		}
	}
	for _, prefix := range []string{"tbl-", "x; DROP TABLE y; --", "2tbl_", `"q"`} {
		if _, err := TableNames(prefix); err == nil {
			t.Errorf("%q was accepted", prefix)
		}
	}
}

// Behaviour that the shared cases can't express, because it differs from
// TypeScript or needs a broken database.

func TestAMissingRevisionRowReadsAsZero(t *testing.T) {
	db := testDB(t)
	tables := createTables(t, db, "gorev_")
	if _, err := db.Exec(`DELETE FROM ` + tables.RoleRegistryState); err != nil {
		t.Fatal(err)
	}
	adapter, err := New(db, "gorev_")
	if err != nil {
		t.Fatal(err)
	}
	revision, err := adapter.LoadRegistryRevision(context.Background())
	if err != nil || revision != 0 {
		t.Errorf("revision %d, err %v", revision, err)
	}
}

func TestBindReadsInsideTheCallersTransaction(t *testing.T) {
	db := testDB(t)
	tables := createTables(t, db, "gobind_")
	adapter, err := New(db, "gobind_")
	if err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`INSERT INTO ` + tables.Roles + ` (id, name) VALUES (1, 'uncommitted')`); err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	inside, err := adapter.Bind(tx).LoadRegistry(ctx)
	if err != nil {
		t.Fatal(err)
	}
	outside, err := adapter.LoadRegistry(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if inside.Get("uncommitted") == nil || outside.Get("uncommitted") != nil {
		t.Errorf("bound sees the role: %v; unbound sees it: %v",
			inside.Get("uncommitted") != nil, outside.Get("uncommitted") != nil)
	}
}

// TypeScript accepts an inheritance cycle and then overflows its stack on the
// first check; Go refuses to load it.
func TestAnInheritanceCycleIsAnError(t *testing.T) {
	db := testDB(t)
	tables := createTables(t, db, "gocycle_")
	for _, statement := range []string{
		`INSERT INTO ` + tables.Roles + ` (id, name) VALUES (1, 'a'), (2, 'b')`,
		`INSERT INTO ` + tables.RoleInheritance + ` (child_role_id, parent_role_id) VALUES (1, 2), (2, 1)`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	adapter, err := New(db, "gocycle_")
	if err != nil {
		t.Fatal(err)
	}
	_, err = adapter.LoadRegistry(context.Background())
	if !errors.Is(err, rights.ErrInheritanceCycle) {
		t.Errorf("err = %v, want ErrInheritanceCycle", err)
	}
}

// A change committed between the snapshot's revision read and its role read
// must not appear: the snapshot pairs roles with the revision they were read
// at. Under read committed, the new role would appear at the old revision.
func TestASnapshotNeverMixesTwoRegistryVersions(t *testing.T) {
	db := testDB(t)
	tables := createTables(t, db, "gosnap_")
	if _, err := db.Exec(`INSERT INTO ` + tables.Roles + ` (id, name) VALUES (1, 'before')`); err != nil {
		t.Fatal(err)
	}
	afterSnapshotRevision = func() {
		for _, statement := range []string{
			`INSERT INTO ` + tables.Roles + ` (id, name) VALUES (2, 'after')`,
			`UPDATE ` + tables.RoleRegistryState + ` SET revision = revision + 1 WHERE singleton = 1`,
		} {
			if _, err := db.Exec(statement); err != nil {
				t.Error(err)
			}
		}
	}
	t.Cleanup(func() { afterSnapshotRevision = nil })

	snapshot, err := LoadRegistrySnapshot(context.Background(), db, "gosnap_")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Revision != 0 || snapshot.Registry.Get("after") != nil || snapshot.Registry.Get("before") == nil {
		t.Errorf("revision %d with roles before=%v after=%v; want revision 0 with only 'before'",
			snapshot.Revision, snapshot.Registry.Get("before") != nil, snapshot.Registry.Get("after") != nil)
	}
}

// A registry change holding the revision row's lock doesn't block a snapshot.
func TestASnapshotDoesNotWaitForARegistryChange(t *testing.T) {
	db := testDB(t)
	tables := createTables(t, db, "gowait_")
	writer, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = writer.Rollback() }()
	if _, err := writer.Exec(`SELECT revision FROM ` + tables.RoleRegistryState + ` WHERE singleton = 1 FOR UPDATE`); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if _, err := LoadRegistrySnapshot(ctx, db, "gowait_"); err != nil {
		t.Fatalf("snapshot while a writer holds the revision row: %v", err)
	}
}
