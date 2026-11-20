package rights_test

import (
	"fmt"

	"odgn.net/rights"
)

func ExampleRights_Explain() {
	rs, _ := rights.ParseRights("+rw:/, -w:/locked")

	e := rs.Explain("/locked/a", rights.Read|rights.Write|rights.Create)
	fmt.Println("allowed:", e.Allowed)
	for _, f := range e.Flags {
		fmt.Println(f.Flag, f.Allowed, f.Right)
	}
	// Output:
	// allowed: false
	// r true +rw:/
	// w false -w:/locked
	// c false <nil>
}

func ExampleSubject_Explain() {
	reg, _ := rights.RoleRegistryFromJSON([]rights.RoleJSON{
		{Name: "viewer", Rights: []rights.RightJSON{{Path: "/", Allow: "r"}}},
		{Name: "editor", Rights: []rights.RightJSON{{Path: "/posts", Allow: "w"}}, Inherits: []string{"viewer"}},
	})
	user := rights.NewSubject().MemberOf(reg.Get("editor"))
	_ = user.Rights().Add(rights.MustParseRight("-w:/posts/drafts"))

	for _, path := range []string{"/posts/1", "/posts/drafts/2"} {
		for _, f := range user.Explain(path, rights.Read|rights.Write).Flags {
			source := "direct"
			if f.Role != nil {
				source = "role " + f.Role.Name()
			}
			fmt.Println(path, f.Flag, f.Allowed, f.Right, source)
		}
	}
	// Output:
	// /posts/1 r true +r:/ role viewer
	// /posts/1 w true +w:/posts role editor
	// /posts/drafts/2 r true +r:/ role viewer
	// /posts/drafts/2 w false -w:/posts/drafts direct
}
