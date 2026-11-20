package rights

import (
	"encoding/json"
	"slices"
	"sync"
	"sync/atomic"
)

// Role is a named Rights that subjects can belong to and other roles can
// inherit from.
type Role struct {
	name    string
	rights  *Rights
	mu      sync.RWMutex
	parents []*Role
	sealed  atomic.Bool
}

// NewRole makes a role. A nil rights gives the role an empty collection.
func NewRole(name string, rights *Rights) *Role {
	if rights == nil {
		rights = &Rights{}
	}
	return &Role{name: name, rights: rights}
}

// Name returns the role's name.
func (r *Role) Name() string { return r.name }

// Rights returns the role's own rights, without inherited ones.
func (r *Role) Rights() *Rights { return r.rights }

// Parents returns the roles this role inherits from, in order.
func (r *Role) Parents() []*Role {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return slices.Clone(r.parents)
}

func (r *Role) checkSealed() error {
	if r.sealed.Load() {
		return &SealedError{Target: "Role " + r.name}
	}
	return nil
}

// Seal stops further changes to this role's rights and parents, and seals
// every role it inherits from, since their rights reach it.
func (r *Role) Seal() *Role {
	if r.sealed.Swap(true) {
		return r
	}
	r.rights.Seal()
	for _, p := range r.Parents() {
		p.Seal()
	}
	return r
}

// IsSealed reports whether the role is sealed.
func (r *Role) IsSealed() bool { return r.sealed.Load() }

// InheritFrom makes this role inherit every Right of parent, after its own and
// those of earlier parents. Inheriting from a parent already inherited from
// does nothing. It returns ErrInheritanceCycle when parent is this role or
// already inherits from it, and a *SealedError when either role is sealed.
func (r *Role) InheritFrom(parent *Role) error {
	if err := r.checkSealed(); err != nil {
		return err
	}
	if err := parent.checkSealed(); err != nil {
		return err
	}
	if parent == r || parent.inheritsFrom(r) {
		return ErrInheritanceCycle
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !slices.Contains(r.parents, parent) {
		r.parents = append(r.parents, parent)
	}
	return nil
}

// inheritsFrom reports whether r inherits from target, directly or not.
func (r *Role) inheritsFrom(target *Role) bool {
	for _, p := range r.Parents() {
		if p == target || p.inheritsFrom(target) {
			return true
		}
	}
	return false
}

// RemoveParent stops this role inheriting from parent. Removing a role that is
// not a parent does nothing.
func (r *Role) RemoveParent(parent *Role) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	i := slices.Index(r.parents, parent)
	if i == -1 {
		return nil
	}
	if err := r.checkSealed(); err != nil {
		return err
	}
	r.parents = slices.Delete(r.parents, i, i+1)
	return nil
}

// ClearParents stops this role inheriting from any role.
func (r *Role) ClearParents() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.parents) == 0 {
		return nil
	}
	if err := r.checkSealed(); err != nil {
		return err
	}
	r.parents = nil
	return nil
}

// AllRights returns the role's own rights followed by those of each parent in
// order, recursively. A Right reached through two parents appears twice.
func (r *Role) AllRights() []*Right {
	out := r.rights.List()
	for _, p := range r.Parents() {
		out = append(out, p.AllRights()...)
	}
	return out
}

// FindRightsByTag returns the role's rights, including inherited ones, with
// the tag.
func (r *Role) FindRightsByTag(tag string) []*Right {
	var out []*Right
	for _, right := range r.AllRights() {
		if right.HasTag(tag) {
			out = append(out, right)
		}
	}
	return out
}

// RoleJSON is the JSON form of a Role.
type RoleJSON struct {
	Name     string      `json:"name"`
	Rights   []RightJSON `json:"rights"`
	Inherits []string    `json:"inherits,omitempty"`
}

// JSON returns the JSON form of the role.
func (r *Role) JSON() RoleJSON {
	out := RoleJSON{Name: r.name, Rights: r.rights.JSON()}
	for _, p := range r.Parents() {
		out.Inherits = append(out.Inherits, p.name)
	}
	return out
}

// MarshalJSON implements json.Marshaler.
func (r *Role) MarshalJSON() ([]byte, error) {
	return json.Marshal(r.JSON())
}
