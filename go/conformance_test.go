package rights

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"
)

// The language-neutral cases in /conformance, which the TypeScript
// implementation runs too. See conformance/schema.json for the case format.

const conformanceDir = "../conformance"

// conformanceCheck is one step of a check case: a check, or a change made
// between checks when Change is set.
type conformanceCheck struct {
	Change  *conformanceChange           `json:"change"`
	Path    string                       `json:"path"`
	Flags   string                       `json:"flags"`
	Now     string                       `json:"now"`
	Context map[string]any               `json:"context"`
	Expect  bool                         `json:"expect"`
	Explain []conformanceFlagExplanation `json:"explain"`
}

// conformanceChange changes a role of the case's registry, or the subject's
// direct rights when Role is absent. Names are pointers so an empty name is
// still a role, as in TypeScript.
type conformanceChange struct {
	Role         *string     `json:"role"`
	AddRights    []RightJSON `json:"addRights"`
	RemoveRights []string    `json:"removeRights"`
	InheritFrom  *string     `json:"inheritFrom"`
	RemoveParent *string     `json:"removeParent"`
}

type conformanceSource struct {
	Type string `json:"type"`
	Name string `json:"name,omitempty"`
}

type conformanceFlagExplanation struct {
	Flag    string             `json:"flag"`
	Allowed bool               `json:"allowed"`
	Right   *string            `json:"right"`
	Source  *conformanceSource `json:"source,omitempty"`
}

type conformanceCase struct {
	Kind string `json:"kind"`
	Name string `json:"name"`

	Rights     []string          `json:"rights"`
	RightsJSON []RightJSON       `json:"rightsJSON"`
	Conditions map[string]string `json:"conditions"`
	Roles      []RoleJSON        `json:"roles"`
	Subject    *SubjectJSON      `json:"subject"`
	Checks     []conformanceCheck

	Input  json.RawMessage `json:"input"`
	Expect json.RawMessage `json:"expect"`
}

var conformanceConditions = map[string]Condition{
	"always": func(Context) bool { return true },
	"never":  func(Context) bool { return false },
	"owner": func(ctx Context) bool {
		user, hasUser := ctx["userId"]
		owner, hasOwner := ctx["ownerId"]
		return hasUser && hasOwner && sameScalar(user, owner)
	},
	"internal":    func(ctx Context) bool { return ctx["isInternal"] == true },
	"notInternal": func(ctx Context) bool { return ctx["isInternal"] != true },
}

// sameScalar compares decoded JSON values as JavaScript's === does for the
// types a context holds: arrays and objects are never equal to each other.
func sameScalar(a, b any) bool {
	switch a.(type) {
	case []any, map[string]any:
		return false
	}
	switch b.(type) {
	case []any, map[string]any:
		return false
	}
	return a == b
}

type checker interface {
	Has(path string, f Flags, opts ...CheckOption) bool
	Explain(path string, f Flags, opts ...CheckOption) Explanation
}

func TestConformance(t *testing.T) {
	files, err := filepath.Glob(filepath.Join(conformanceDir, "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Fatalf("no conformance cases found in %s", conformanceDir)
	}
	for _, file := range files {
		if filepath.Base(file) == "schema.json" {
			continue
		}
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		var doc struct {
			Cases []conformanceCase `json:"cases"`
		}
		if err := json.Unmarshal(data, &doc); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		t.Run(filepath.Base(file), func(t *testing.T) {
			for _, c := range doc.Cases {
				t.Run(c.Name, func(t *testing.T) { runConformanceCase(t, c) })
			}
		})
	}
}

func runConformanceCase(t *testing.T, c conformanceCase) {
	t.Helper()
	switch c.Kind {
	case "check":
		ch, rr := buildChecker(t, c)
		for _, check := range c.Checks {
			if check.Change != nil {
				applyChange(t, ch, rr, *check.Change)
				continue
			}
			var opts []CheckOption
			if check.Now != "" {
				now, ok := parseTime(check.Now)
				if !ok {
					t.Fatalf("unreadable now %q", check.Now)
				}
				opts = append(opts, At(now))
			}
			if check.Context != nil {
				opts = append(opts, WithContext(check.Context))
			}
			if got := ch.Has(check.Path, ParseFlags(check.Flags), opts...); got != check.Expect {
				t.Errorf("Has(%q, %q, now=%q, ctx=%v) = %v, want %v",
					check.Path, check.Flags, check.Now, check.Context, got, check.Expect)
			}
			if check.Explain != nil {
				assertExplanation(t, ch.Explain(check.Path, ParseFlags(check.Flags), opts...),
					check, c.Subject != nil)
			}
		}

	case "parseRight":
		var input string
		mustUnmarshal(t, c.Input, &input)
		r, err := ParseRight(input)
		var want struct {
			Error bool
			Text  string
			JSON  RightJSON
		}
		mustUnmarshal(t, c.Expect, &want)
		if want.Error {
			if err == nil {
				t.Fatalf("ParseRight(%q) = %q, want an error", input, r)
			}
			return
		}
		if err != nil {
			t.Fatalf("ParseRight(%q): %v", input, err)
		}
		if got := r.String(); got != want.Text {
			t.Errorf("String() = %q, want %q", got, want.Text)
		}
		assertSameJSON(t, r, c.Expect, "json")

	case "parseRights":
		var input string
		mustUnmarshal(t, c.Input, &input)
		rs, err := ParseRights(input)
		if err != nil {
			t.Fatalf("ParseRights(%q): %v", input, err)
		}
		var want struct {
			Texts []string
			Text  string
		}
		mustUnmarshal(t, c.Expect, &want)
		assertTexts(t, rs, want.Texts)
		if got := rs.String(); got != want.Text {
			t.Errorf("String() = %q, want %q", got, want.Text)
		}

	case "rightsFromJSON":
		var input []RightJSON
		mustUnmarshal(t, c.Input, &input)
		rs, err := RightsFromJSON(input)
		var want struct {
			Error bool
			Texts []string
		}
		mustUnmarshal(t, c.Expect, &want)
		if want.Error {
			if err == nil {
				t.Fatalf("RightsFromJSON = %q, want an error", rs)
			}
			return
		}
		if err != nil {
			t.Fatalf("RightsFromJSON: %v", err)
		}
		assertTexts(t, rs, want.Texts)
		assertSameJSON(t, rs, c.Expect, "json")

	case "registryFromJSON":
		var input []RoleJSON
		mustUnmarshal(t, c.Input, &input)
		rr, err := RoleRegistryFromJSON(input)
		var want struct{ Error bool }
		mustUnmarshal(t, c.Expect, &want)
		if want.Error {
			if err == nil {
				t.Fatal("RoleRegistryFromJSON succeeded, want an error")
			}
			return
		}
		if err != nil {
			t.Fatalf("RoleRegistryFromJSON: %v", err)
		}
		assertSameJSON(t, rr, c.Expect, "json")

	default:
		t.Fatalf("unknown case kind %q", c.Kind)
	}
}

func buildChecker(t *testing.T, c conformanceCase) (checker, *RoleRegistry) {
	t.Helper()
	if c.Subject != nil {
		if len(c.Conditions) > 0 {
			t.Fatal("conditions apply only to rights or rightsJSON, not to a subject")
		}
		rr, err := RoleRegistryFromJSON(c.Roles)
		if err != nil {
			t.Fatal(err)
		}
		s, err := SubjectFromJSON(*c.Subject, rr)
		if err != nil {
			t.Fatal(err)
		}
		return s, rr
	}
	var list []*Right
	if c.RightsJSON != nil {
		rs, err := RightsFromJSON(c.RightsJSON)
		if err != nil {
			t.Fatal(err)
		}
		list = rs.List()
	} else {
		for _, text := range c.Rights {
			r, err := ParseRight(text)
			if err != nil {
				t.Fatal(err)
			}
			list = append(list, r)
		}
	}
	for key, name := range c.Conditions {
		i, err := strconv.Atoi(key)
		if err != nil || i < 0 || i >= len(list) {
			t.Fatalf("condition index %q is out of range", key)
		}
		cond, ok := conformanceConditions[name]
		if !ok {
			t.Fatalf("unknown condition %q", name)
		}
		list[i].condition = cond
	}
	return NewRights(list...), nil
}

func applyChange(t *testing.T, ch checker, rr *RoleRegistry, change conformanceChange) {
	t.Helper()
	s, ok := ch.(*Subject)
	if !ok || rr == nil {
		t.Fatal("a change needs a case with a subject")
	}
	mustGet := func(name string) *Role {
		role := rr.Get(name)
		if role == nil {
			t.Fatalf("unknown role %q", name)
		}
		return role
	}
	var role *Role
	rs := s.Rights()
	if change.Role != nil {
		role = mustGet(*change.Role)
		rs = role.Rights()
	}
	for _, path := range change.RemoveRights {
		p := NormalizePath(path)
		for _, r := range rs.List() {
			if r.Path() == p {
				if _, err := rs.Remove(r); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	added, err := RightsFromJSON(change.AddRights)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range added.List() {
		if err := rs.Add(r); err != nil {
			t.Fatal(err)
		}
	}
	if (change.RemoveParent != nil || change.InheritFrom != nil) && role == nil {
		t.Fatal("inheritFrom and removeParent need a role")
	}
	if change.RemoveParent != nil {
		if err := role.RemoveParent(mustGet(*change.RemoveParent)); err != nil {
			t.Fatal(err)
		}
	}
	if change.InheritFrom != nil {
		if err := role.InheritFrom(mustGet(*change.InheritFrom)); err != nil {
			t.Fatal(err)
		}
	}
}

func mustUnmarshal(t *testing.T, data json.RawMessage, v any) {
	t.Helper()
	if err := json.Unmarshal(data, v); err != nil {
		t.Fatalf("decoding %s: %v", data, err)
	}
}

func assertTexts(t *testing.T, rs *Rights, want []string) {
	t.Helper()
	got := []string{}
	for _, r := range rs.List() {
		got = append(got, r.String())
	}
	if want == nil {
		want = []string{}
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("texts = %q, want %q", got, want)
	}
}

// assertSameJSON compares v's JSON with the expect object's field, as
// decoded values so key order does not matter.
func assertSameJSON(t *testing.T, v any, expect json.RawMessage, field string) {
	t.Helper()
	var fields map[string]json.RawMessage
	mustUnmarshal(t, expect, &fields)
	var want, got any
	mustUnmarshal(t, fields[field], &want)
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	mustUnmarshal(t, data, &got)
	if !reflect.DeepEqual(got, want) {
		t.Errorf("JSON = %s, want %s", data, fields[field])
	}
}

// assertExplanation compares an Explanation with a check's expected one, in
// the conformance form: flag letters, Rights by text form and, for a subject,
// where each deciding Right came from.
func assertExplanation(t *testing.T, e Explanation, check conformanceCheck, subject bool) {
	t.Helper()
	if e.Allowed != check.Expect {
		t.Errorf("Explain(%q, %q).Allowed = %v, want %v", check.Path, check.Flags, e.Allowed, check.Expect)
	}
	got := []conformanceFlagExplanation{}
	for _, fe := range e.Flags {
		g := conformanceFlagExplanation{Flag: fe.Flag.String(), Allowed: fe.Allowed}
		if fe.Right != nil {
			text := fe.Right.String()
			g.Right = &text
			if subject {
				g.Source = &conformanceSource{Type: "direct"}
				if fe.Role != nil {
					g.Source = &conformanceSource{Type: "role", Name: fe.Role.Name()}
				}
			}
		} else if fe.Role != nil {
			t.Errorf("Explain(%q, %q): flag %s has a Role but no Right", check.Path, check.Flags, fe.Flag)
		}
		got = append(got, g)
	}
	gotJSON, _ := json.Marshal(got)
	wantJSON, _ := json.Marshal(check.Explain)
	if string(gotJSON) != string(wantJSON) {
		t.Errorf("Explain(%q, %q) = %s, want %s", check.Path, check.Flags, gotJSON, wantJSON)
	}
}
