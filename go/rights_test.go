package rights

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sync"
	"testing"
	"time"
)

// Behaviour the conformance cases cannot express: sealing, concurrency and the
// Go API itself.

func TestSealedValuesRejectChanges(t *testing.T) {
	rr := NewRoleRegistry()
	viewer, _ := rr.Define("viewer", NewRights(MustParseRight("+r:/")))
	editor, _ := rr.Define("editor", nil)
	if err := editor.InheritFrom(viewer); err != nil {
		t.Fatal(err)
	}
	rr.Seal()

	var sealed *SealedError
	steps := map[string]error{
		"define new role":       func() error { _, err := rr.Define("x", nil); return err }(),
		"add right to role":     viewer.Rights().Add(MustParseRight("+w:/")),
		"allow on rights":       viewer.Rights().Allow("/a", Write),
		"change a right":        viewer.Rights().List()[0].Allow(Write),
		"inherit":               editor.InheritFrom(NewRole("other", nil)),
		"remove parent":         editor.RemoveParent(viewer),
		"delete role":           func() error { _, err := rr.Delete("viewer"); return err }(),
		"unmarshal into rights": json.Unmarshal([]byte(`[]`), viewer.Rights()),
	}
	for name, err := range steps {
		if !errors.As(err, &sealed) {
			t.Errorf("%s: got %v, want a *SealedError", name, err)
		}
	}

	// Reads still work, and defining an existing role returns it.
	if got, err := rr.Define("viewer", nil); err != nil || got != viewer {
		t.Errorf("Define existing = %v, %v", got, err)
	}
	if !NewSubject().MemberOf(editor).Read("/x") {
		t.Error("sealed roles should still answer checks")
	}
}

func TestSealingARoleSealsItsParents(t *testing.T) {
	parent := NewRole("parent", nil)
	child := NewRole("child", nil)
	if err := child.InheritFrom(parent); err != nil {
		t.Fatal(err)
	}
	child.Seal()
	if !parent.IsSealed() || !parent.Rights().IsSealed() {
		t.Error("sealing a role should seal the roles it inherits from")
	}
}

func TestInheritanceCyclesAreRejected(t *testing.T) {
	a, b, c := NewRole("a", nil), NewRole("b", nil), NewRole("c", nil)
	if err := a.InheritFrom(a); !errors.Is(err, ErrInheritanceCycle) {
		t.Errorf("self: got %v", err)
	}
	_ = a.InheritFrom(b)
	_ = b.InheritFrom(c)
	if err := c.InheritFrom(a); !errors.Is(err, ErrInheritanceCycle) {
		t.Errorf("indirect: got %v", err)
	}
	_, err := RoleRegistryFromJSON([]RoleJSON{
		{Name: "x", Inherits: []string{"y"}},
		{Name: "y", Inherits: []string{"x"}},
	})
	if !errors.Is(err, ErrInheritanceCycle) {
		t.Errorf("from JSON: got %v", err)
	}
}

func TestRoleRegistryDeleteRemovesLinks(t *testing.T) {
	rr := NewRoleRegistry()
	base, _ := rr.Define("base", nil)
	mid, _ := rr.Define("mid", nil)
	top, _ := rr.Define("top", nil)
	_ = mid.InheritFrom(base)
	_ = top.InheritFrom(mid)

	if ok, err := rr.Delete("mid"); !ok || err != nil {
		t.Fatalf("Delete = %v, %v", ok, err)
	}
	if rr.Get("mid") != nil || len(top.Parents()) != 0 || len(mid.Parents()) != 0 {
		t.Error("delete should remove the role and its links in both directions")
	}
	if names := rr.JSON(); len(names) != 2 || names[0].Name != "base" || names[1].Name != "top" {
		t.Errorf("remaining roles = %v", names)
	}
	if ok, _ := rr.Delete("ghost"); ok {
		t.Error("deleting an unknown role should report false")
	}
}

func TestRightsEditing(t *testing.T) {
	rs := NewRights()
	_ = rs.Allow("/files/**", All)
	_ = rs.Exclude("!/files/system/**", Delete, Write)
	if !rs.Write("/files/a") || rs.Write("/files/system/a") || !rs.Read("/files/system/a") {
		t.Errorf("exclude: %s", rs)
	}
	if got := rs.String(); got != "+*:/files/**, -wd:/files/system/**" {
		t.Errorf("String() = %q", got)
	}

	r := MustRight("/tmp", RightOptions{Allow: Read, Tags: []string{"temp"},
		ValidUntil: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)})
	_ = rs.Add(r)
	_ = rs.AllowByTag("temp", Write)
	if !r.Has(Read|Write, time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)) {
		t.Error("AllowByTag should allow write")
	}
	_ = rs.Prune(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	if slices.Contains(rs.List(), r) {
		t.Error("Prune should drop expired rights")
	}
	if ok, _ := rs.Remove(r); ok {
		t.Error("removing an absent right should report false")
	}
	_ = rs.RevokeByTag("none")
	if rs.Len() != 2 {
		t.Errorf("Len() = %d", rs.Len())
	}
}

func TestCheckMany(t *testing.T) {
	rs, _ := ParseRights("+r:/users/*, +w:/posts/*, -*:/admin")
	got := rs.CheckMany([]Request{
		{"/users/1", Read}, {"/posts/1", Write}, {"/admin", All}, {"/users/1", Read | Write},
	})
	if want := []bool{true, true, false, false}; !slices.Equal(got, want) {
		t.Errorf("CheckMany = %v, want %v", got, want)
	}
}

func TestMatchCacheSeesChanges(t *testing.T) {
	rs := NewRights()
	_ = rs.Allow("/", Read)
	if !rs.Read("/a") {
		t.Fatal("want read")
	}
	_ = rs.Deny("/a", Read)
	if rs.Read("/a") {
		t.Error("a check after a change should see the new right")
	}
}

func TestConcurrentChecks(t *testing.T) {
	rr, err := RoleRegistryFromJSON([]RoleJSON{
		{Name: "viewer", Rights: []RightJSON{{Path: "/", Allow: "r"}}},
		{Name: "editor", Rights: []RightJSON{{Path: "/posts/*", Allow: "w"}}, Inherits: []string{"viewer"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	unsealed, _ := ParseRights("+r:/, -r:/secret/**")
	rr.Seal()
	s := NewSubject().MemberOf(rr.Get("editor"))

	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 200; i++ {
				path := fmt.Sprintf("/posts/%d", i%50)
				if !s.Write(path) || !unsealed.Read(path) || unsealed.Read("/secret/"+path) {
					t.Error("wrong answer under concurrency")
					return
				}
			}
		}()
	}
	wg.Wait()
}

func TestSubjectRegistryKeepsOrder(t *testing.T) {
	rr, _ := RoleRegistryFromJSON([]RoleJSON{{Name: "reader", Rights: []RightJSON{{Path: "/docs", Allow: "r"}}}})
	data := []byte(`{"zed":{"roles":["reader"]},"amy":{"rights":[{"path":"/docs","allow":"w"}]},"bob":{}}`)
	sr, err := SubjectRegistryFromJSON(data, rr)
	if err != nil {
		t.Fatal(err)
	}
	if got := sr.Identifiers(); !slices.Equal(got, []string{"zed", "amy", "bob"}) {
		t.Errorf("Identifiers() = %v", got)
	}
	if got := sr.FindSubjectsWithAccess("/docs/1", Read); !slices.Equal(got, []string{"zed"}) {
		t.Errorf("FindSubjectsWithAccess = %v", got)
	}
	out, _ := json.Marshal(sr)
	if want := `{"zed":{"roles":["reader"]},"amy":{"rights":[{"path":"/docs","allow":"w"}]},"bob":{}}`; string(out) != want {
		t.Errorf("MarshalJSON = %s", out)
	}
	sr.Delete("zed")
	if sr.Has("zed") || sr.Len() != 2 {
		t.Error("Delete should remove the subject")
	}
}

func TestTimeWithoutOffsetIsLocal(t *testing.T) {
	loc := time.FixedZone("test", -5*3600)
	old := time.Local
	time.Local = loc
	defer func() { time.Local = old }()

	got, ok := parseTime("2025-01-01T10:00")
	if !ok || !got.Equal(time.Date(2025, 1, 1, 15, 0, 0, 0, time.UTC)) {
		t.Errorf("parseTime = %v, %v", got, ok)
	}
	if got, _ := parseTime("2025-01-01"); !got.Equal(time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("a date alone should be UTC, got %v", got)
	}
	for _, bad := range []string{"2025-13-01", "2025-01-01T10:00:60Z", "Jan 1 2025", ""} {
		if _, ok := parseTime(bad); ok {
			t.Errorf("parseTime(%q) should fail", bad)
		}
	}
}
