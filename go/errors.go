package rights

import (
	"errors"
	"fmt"
)

// SealedError is returned when code changes a sealed role registry, role,
// Rights or Right. A value is sealed when it is shared, for example by a
// cache, so a change there would silently reach every reader of it.
type SealedError struct {
	// Target names what was sealed, such as "Rights" or "Role admin".
	Target string
}

func (e *SealedError) Error() string {
	return e.Target + " is sealed and cannot be changed"
}

// ErrInvalidWindow is returned for a validity window that ends before it
// starts.
var ErrInvalidWindow = errors.New("rights: validFrom must be before validUntil")

// ErrMissingRole is returned when a role inherits from a role the registry
// does not have.
var ErrMissingRole = errors.New("rights: role inherits from a missing role")

// ErrInheritanceCycle is returned when a role would inherit from itself,
// directly or through other roles.
var ErrInheritanceCycle = errors.New("rights: role cannot inherit from itself")

func missingRole(role, parent string) error {
	return fmt.Errorf("%w: %s inherits from %s", ErrMissingRole, role, parent)
}
