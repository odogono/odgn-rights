package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"

	"odgn.net/rights"
)

// The language-neutral cases in /conformance/postgres, which the TypeScript
// PostgresAdapter runs too. They need a Postgres: set
// ODGN_RIGHTS_TEST_POSTGRES_URL to run them.

const conformanceDir = "../../conformance/postgres"

type conformanceCase struct {
	Name string                     `json:"name"`
	Rows map[string]json.RawMessage `json:"rows"`

	// Registry and Subject stay raw, so a field TypeScript emits and Go's
	// JSON types lack still fails the comparison.
	Expect struct {
		Revision int64           `json:"revision"`
		Registry json.RawMessage `json:"registry"`
		Subjects []struct {
			Identifier string          `json:"identifier"`
			Subject    json.RawMessage `json:"subject"`
			Checks     []struct {
				Path   string `json:"path"`
				Flags  string `json:"flags"`
				Now    string `json:"now"`
				Expect bool   `json:"expect"`
			} `json:"checks"`
		} `json:"subjects"`
	} `json:"expect"`
}

// Insertion order, so foreign keys resolve.
var conformanceTables = []string{
	"rights", "roles", "role_rights", "role_inheritance",
	"subjects", "subject_roles", "subject_rights",
}

func testDB(t *testing.T) *sql.DB {
	t.Helper()
	url := os.Getenv("ODGN_RIGHTS_TEST_POSTGRES_URL")
	if url == "" {
		t.Skip("set ODGN_RIGHTS_TEST_POSTGRES_URL to run the Postgres adapter tests")
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// createTables makes the tables for prefix from the shared schema.sql, which
// the TypeScript tests check against that adapter's migrate.
func createTables(t *testing.T, db *sql.DB, prefix string) Tables {
	t.Helper()
	schema, err := os.ReadFile(conformanceDir + "/schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	tables, err := TableNames(prefix)
	if err != nil {
		t.Fatal(err)
	}
	drop := func() {
		_, _ = db.Exec(`DROP TABLE IF EXISTS ` + strings.Join([]string{
			tables.SubjectRights, tables.SubjectRoles, tables.Subjects, tables.RoleInheritance,
			tables.RoleRights, tables.RoleRegistryState, tables.Roles, tables.Rights,
		}, ", ") + ` CASCADE`)
	}
	drop()
	if _, err := db.Exec(strings.ReplaceAll(string(schema), "{{prefix}}", prefix)); err != nil {
		t.Fatalf("create tables: %v", err)
	}
	t.Cleanup(drop)
	return tables
}

func insertRows(t *testing.T, db *sql.DB, prefix string, rows map[string]json.RawMessage) {
	t.Helper()
	for _, table := range conformanceTables {
		raw, ok := rows[table]
		if !ok {
			continue
		}
		var list []map[string]any
		if err := json.Unmarshal(raw, &list); err != nil {
			t.Fatalf("rows.%s: %v", table, err)
		}
		for _, row := range list {
			columns := make([]string, 0, len(row))
			for column := range row {
				columns = append(columns, column)
			}
			slices.Sort(columns)
			placeholders := make([]string, len(columns))
			values := make([]any, len(columns))
			for i, column := range columns {
				placeholders[i] = fmt.Sprintf("$%d", i+1)
				values[i] = row[column]
			}
			query := fmt.Sprintf("INSERT INTO %s%s (%s) VALUES (%s)",
				prefix, table, strings.Join(columns, ", "), strings.Join(placeholders, ", "))
			if _, err := db.Exec(query, values...); err != nil {
				t.Fatalf("insert into %s: %v", table, err)
			}
		}
	}
	if raw, ok := rows["registry_revision"]; ok {
		var revision int64
		if err := json.Unmarshal(raw, &revision); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`UPDATE `+prefix+`role_registry_state SET revision = $1 WHERE singleton = 1`, revision); err != nil {
			t.Fatal(err)
		}
	}
}

func TestConformance(t *testing.T) {
	raw, err := os.ReadFile(conformanceDir + "/cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Cases []conformanceCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	if len(file.Cases) == 0 {
		t.Fatal("no cases")
	}
	db := testDB(t)
	ctx := context.Background()

	for index, c := range file.Cases {
		t.Run(c.Name, func(t *testing.T) {
			// Distinct from the TypeScript runner's prefixes, so both can share
			// one database.
			prefix := fmt.Sprintf("goconf%d_", index)
			createTables(t, db, prefix)
			insertRows(t, db, prefix, c.Rows)

			snapshot, err := LoadRegistrySnapshot(ctx, db, prefix)
			if err != nil {
				t.Fatal(err)
			}
			if snapshot.Revision != c.Expect.Revision {
				t.Errorf("revision %d, want %d", snapshot.Revision, c.Expect.Revision)
			}
			assertJSONEqual(t, "registry", snapshot.Registry.JSON(), c.Expect.Registry)

			adapter, err := New(db, prefix)
			if err != nil {
				t.Fatal(err)
			}
			for _, want := range c.Expect.Subjects {
				subject, err := adapter.LoadSubject(ctx, want.Identifier, snapshot.Registry)
				if err != nil {
					t.Fatal(err)
				}
				var got *rights.SubjectJSON
				if subject != nil {
					j := subject.JSON()
					got = &j
				}
				assertJSONEqual(t, "subject "+want.Identifier, got, want.Subject)
				for _, check := range want.Checks {
					var opts []rights.CheckOption
					if check.Now != "" {
						at, err := time.Parse(time.RFC3339, check.Now)
						if err != nil {
							t.Fatal(err)
						}
						opts = append(opts, rights.At(at))
					}
					if got := subject.Has(check.Path, rights.ParseFlags(check.Flags), opts...); got != check.Expect {
						t.Errorf("%s: %s on %s = %v, want %v", want.Identifier, check.Flags, check.Path, got, check.Expect)
					}
				}
			}
		})
	}
}

// assertJSONEqual compares two values by their JSON, so an empty slice and
// a missing one are the same, as they are in the cases.
func assertJSONEqual(t *testing.T, what string, got, want any) {
	t.Helper()
	normalise := func(v any) any {
		data, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		var out any
		if err := json.Unmarshal(data, &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	g, w := normalise(got), normalise(want)
	if !reflect.DeepEqual(g, w) {
		gj, _ := json.Marshal(g)
		wj, _ := json.Marshal(w)
		t.Errorf("%s:\n got %s\nwant %s", what, gj, wj)
	}
}
