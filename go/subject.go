package rights

import (
	"encoding/json"
	"slices"
	"sync"
)

// Subject is whoever a check is made for: the Rights of its roles, in the
// order it joined them, followed by its direct rights.
type Subject struct {
	mu     sync.RWMutex
	roles  []*Role
	rights *Rights
}

// NewSubject makes a subject with no roles and no direct rights.
func NewSubject() *Subject {
	return &Subject{rights: &Rights{}}
}

// MemberOf adds the subject to a role. Joining a role twice does nothing.
func (s *Subject) MemberOf(role *Role) *Subject {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !slices.Contains(s.roles, role) {
		s.roles = append(s.roles, role)
	}
	return s
}

// Roles returns the subject's roles, in the order it joined them.
func (s *Subject) Roles() []*Role {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return slices.Clone(s.roles)
}

// Rights returns the subject's direct rights.
func (s *Subject) Rights() *Rights { return s.rights }

// AllRights returns every Right that reaches the subject: those of each role
// in turn, including inherited ones, then its direct rights.
func (s *Subject) AllRights() []*Right {
	var out []*Right
	for _, role := range s.Roles() {
		out = append(out, role.AllRights()...)
	}
	return append(out, s.rights.List()...)
}

// Has reports whether every one of the flags is allowed on the path.
func (s *Subject) Has(path string, f Flags, opts ...CheckOption) bool {
	return decide(orderMatches(s.AllRights(), NormalizePath(path)), f, newCheckConfig(opts), untilDenied)
}

// Explain answers a check like Has, naming the deciding Right for each flag
// and the role it came from, or a nil Role for a direct right.
func (s *Subject) Explain(path string, f Flags, opts ...CheckOption) Explanation {
	var all []*Right
	roleOf := make(map[*Right]*Role)
	for _, role := range s.Roles() {
		role.eachRight(func(right *Right, owner *Role) {
			all = append(all, right)
			roleOf[right] = owner
		})
	}
	for _, right := range s.rights.List() {
		all = append(all, right)
		roleOf[right] = nil
	}
	// A Right reached more than once takes its last source, as in TypeScript.
	return explain(orderMatches(all, NormalizePath(path)), f, newCheckConfig(opts),
		func(r *Right) *Role { return roleOf[r] })
}

// CheckMany answers each request, in order, with the same time and context.
func (s *Subject) CheckMany(reqs []Request, opts ...CheckOption) []bool {
	cfg := newCheckConfig(opts)
	all := s.AllRights()
	out := make([]bool, len(reqs))
	for i, req := range reqs {
		out[i] = decide(orderMatches(all, NormalizePath(req.Path)), req.Flags, cfg, untilDenied)
	}
	return out
}

// Read reports whether reading the path is allowed.
func (s *Subject) Read(path string, opts ...CheckOption) bool {
	return s.Has(path, Read, opts...)
}

// Write reports whether writing the path is allowed.
func (s *Subject) Write(path string, opts ...CheckOption) bool {
	return s.Has(path, Write, opts...)
}

// Delete reports whether deleting the path is allowed.
func (s *Subject) Delete(path string, opts ...CheckOption) bool {
	return s.Has(path, Delete, opts...)
}

// Create reports whether creating the path is allowed.
func (s *Subject) Create(path string, opts ...CheckOption) bool {
	return s.Has(path, Create, opts...)
}

// Execute reports whether executing the path is allowed.
func (s *Subject) Execute(path string, opts ...CheckOption) bool {
	return s.Has(path, Execute, opts...)
}

// All reports whether every flag is allowed on the path.
func (s *Subject) All(path string, opts ...CheckOption) bool {
	return s.Has(path, All, opts...)
}

// SubjectJSON is the JSON form of a Subject: its role names and direct rights.
type SubjectJSON struct {
	Roles  []string    `json:"roles,omitempty"`
	Rights []RightJSON `json:"rights,omitempty"`
}

// JSON returns the JSON form of the subject.
func (s *Subject) JSON() SubjectJSON {
	var out SubjectJSON
	for _, role := range s.Roles() {
		out.Roles = append(out.Roles, role.name)
	}
	if rights := s.rights.JSON(); len(rights) > 0 {
		out.Rights = rights
	}
	return out
}

// MarshalJSON implements json.Marshaler.
func (s *Subject) MarshalJSON() ([]byte, error) {
	return json.Marshal(s.JSON())
}

// SubjectFromJSON makes a subject from its JSON form, finding its roles in
// registry. Role names the registry lacks, or every role when registry is nil,
// are ignored.
func SubjectFromJSON(data SubjectJSON, registry *RoleRegistry) (*Subject, error) {
	s := NewSubject()
	if registry != nil {
		for _, name := range data.Roles {
			if role := registry.Get(name); role != nil {
				s.MemberOf(role)
			}
		}
	}
	rights, err := RightsFromJSON(data.Rights)
	if err != nil {
		return nil, err
	}
	s.rights = rights
	return s, nil
}
