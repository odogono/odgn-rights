package rights

import (
	"encoding/json"
	"slices"
	"sync/atomic"
)

// RoleRegistry is the set of all roles known to an application, looked up by
// name. The zero value is an empty, usable registry.
type RoleRegistry struct {
	roles  map[string]*Role
	order  []string
	sealed atomic.Bool
}

// NewRoleRegistry makes an empty registry.
func NewRoleRegistry() *RoleRegistry {
	return &RoleRegistry{}
}

func (rr *RoleRegistry) checkSealed() error {
	if rr.sealed.Load() {
		return &SealedError{Target: "RoleRegistry"}
	}
	return nil
}

// Seal stops further changes to this registry and every role in it. A sealed
// registry still answers Get, All and Define for a role it already has.
func (rr *RoleRegistry) Seal() *RoleRegistry {
	rr.sealed.Store(true)
	for _, role := range rr.All() {
		role.Seal()
	}
	return rr
}

// IsSealed reports whether the registry is sealed.
func (rr *RoleRegistry) IsSealed() bool { return rr.sealed.Load() }

// Define returns the named role, creating it if needed. When rights is not
// nil, its rights are added to the role.
func (rr *RoleRegistry) Define(name string, rights *Rights) (*Role, error) {
	role := rr.roles[name]
	if role != nil && rights == nil {
		return role, nil
	}
	if err := rr.checkSealed(); err != nil {
		return nil, err
	}
	if role == nil {
		role = NewRole(name, rights)
		if rr.roles == nil {
			rr.roles = make(map[string]*Role)
		}
		rr.roles[name] = role
		rr.order = append(rr.order, name)
		return role, nil
	}
	for _, r := range rights.List() {
		if err := role.rights.Add(r); err != nil {
			return nil, err
		}
	}
	return role, nil
}

// Get returns the named role, or nil.
func (rr *RoleRegistry) Get(name string) *Role {
	return rr.roles[name]
}

// All returns every role in the order they were defined.
func (rr *RoleRegistry) All() []*Role {
	out := make([]*Role, len(rr.order))
	for i, name := range rr.order {
		out[i] = rr.roles[name]
	}
	return out
}

// Delete removes the named role and every inheritance link touching it,
// reporting whether it was present.
func (rr *RoleRegistry) Delete(name string) (bool, error) {
	if err := rr.checkSealed(); err != nil {
		return false, err
	}
	removed := rr.roles[name]
	if removed == nil {
		return false, nil
	}
	// Check every role the delete would change before changing any of them.
	if removed.IsSealed() && len(removed.Parents()) > 0 {
		return false, removed.checkSealed()
	}
	for _, role := range rr.roles {
		if role != removed && role.IsSealed() && slices.Contains(role.Parents(), removed) {
			return false, role.checkSealed()
		}
	}
	delete(rr.roles, name)
	rr.order = slices.DeleteFunc(rr.order, func(n string) bool { return n == name })
	for _, role := range rr.roles {
		if err := role.RemoveParent(removed); err != nil {
			return false, err
		}
	}
	return true, removed.ClearParents()
}

// JSON returns the JSON form of every role, in the order they were defined.
func (rr *RoleRegistry) JSON() []RoleJSON {
	roles := rr.All()
	out := make([]RoleJSON, len(roles))
	for i, role := range roles {
		out[i] = role.JSON()
	}
	return out
}

// MarshalJSON implements json.Marshaler.
func (rr *RoleRegistry) MarshalJSON() ([]byte, error) {
	return json.Marshal(rr.JSON())
}

// RoleRegistryFromJSON makes a registry from the JSON form of its roles. A
// role may inherit from one listed after it; a role listed twice gains the
// rights and parents of both entries. It returns an error wrapping
// ErrMissingRole when a role inherits from one not listed.
func RoleRegistryFromJSON(items []RoleJSON) (*RoleRegistry, error) {
	rr := NewRoleRegistry()
	for _, item := range items {
		var rights *Rights
		if item.Rights != nil {
			var err error
			if rights, err = RightsFromJSON(item.Rights); err != nil {
				return nil, err
			}
		}
		if _, err := rr.Define(item.Name, rights); err != nil {
			return nil, err
		}
	}
	for _, item := range items {
		role := rr.Get(item.Name)
		for _, parentName := range item.Inherits {
			parent := rr.Get(parentName)
			if parent == nil {
				return nil, missingRole(item.Name, parentName)
			}
			if err := role.InheritFrom(parent); err != nil {
				return nil, err
			}
		}
	}
	return rr, nil
}
