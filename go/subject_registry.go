package rights

import (
	"bytes"
	"encoding/json"
	"fmt"
	"iter"
	"slices"
)

// SubjectRegistry keeps subjects by identifier, in the order they were first
// registered. The zero value is an empty, usable registry.
type SubjectRegistry struct {
	subjects map[string]*Subject
	order    []string
}

// NewSubjectRegistry makes an empty registry.
func NewSubjectRegistry() *SubjectRegistry {
	return &SubjectRegistry{}
}

// Register stores a subject under an identifier, replacing any subject
// already stored there.
func (sr *SubjectRegistry) Register(id string, s *Subject) {
	if sr.subjects == nil {
		sr.subjects = make(map[string]*Subject)
	}
	if _, ok := sr.subjects[id]; !ok {
		sr.order = append(sr.order, id)
	}
	sr.subjects[id] = s
}

// Get returns the subject with the identifier, or nil.
func (sr *SubjectRegistry) Get(id string) *Subject { return sr.subjects[id] }

// Has reports whether a subject is registered under the identifier.
func (sr *SubjectRegistry) Has(id string) bool {
	_, ok := sr.subjects[id]
	return ok
}

// Delete removes the subject with the identifier, reporting whether it was
// present.
func (sr *SubjectRegistry) Delete(id string) bool {
	if _, ok := sr.subjects[id]; !ok {
		return false
	}
	delete(sr.subjects, id)
	sr.order = slices.DeleteFunc(sr.order, func(o string) bool { return o == id })
	return true
}

// Identifiers returns every identifier, in the order they were registered.
func (sr *SubjectRegistry) Identifiers() []string { return slices.Clone(sr.order) }

// Len returns the number of subjects.
func (sr *SubjectRegistry) Len() int { return len(sr.order) }

// Clear removes every subject.
func (sr *SubjectRegistry) Clear() {
	sr.subjects, sr.order = nil, nil
}

// All yields each identifier and subject, in the order they were registered.
func (sr *SubjectRegistry) All() iter.Seq2[string, *Subject] {
	return func(yield func(string, *Subject) bool) {
		for _, id := range sr.Identifiers() {
			if s, ok := sr.subjects[id]; ok && !yield(id, s) {
				return
			}
		}
	}
}

// FindSubjectsWithAccess returns the identifiers of every subject allowed all
// of the flags on the path.
func (sr *SubjectRegistry) FindSubjectsWithAccess(path string, f Flags, opts ...CheckOption) []string {
	var out []string
	for id, s := range sr.All() {
		if s.Has(path, f, opts...) {
			out = append(out, id)
		}
	}
	return out
}

// MarshalJSON writes the registry as an object from identifier to the
// subject's JSON form, keeping registration order.
func (sr *SubjectRegistry) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, id := range sr.order {
		if i > 0 {
			b.WriteByte(',')
		}
		key, err := json.Marshal(id)
		if err != nil {
			return nil, err
		}
		val, err := json.Marshal(sr.subjects[id].JSON())
		if err != nil {
			return nil, err
		}
		b.Write(key)
		b.WriteByte(':')
		b.Write(val)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

// SubjectRegistryFromJSON reads a registry written by MarshalJSON, keeping the
// order of its keys and finding subjects' roles in roles (which may be nil).
func SubjectRegistryFromJSON(data []byte, roles *RoleRegistry) (*SubjectRegistry, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	if tok, err := dec.Token(); err != nil {
		return nil, err
	} else if tok != json.Delim('{') {
		return nil, fmt.Errorf("rights: subject registry JSON must be an object")
	}
	sr := NewSubjectRegistry()
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		id, _ := tok.(string)
		var sj SubjectJSON
		if err := dec.Decode(&sj); err != nil {
			return nil, err
		}
		s, err := SubjectFromJSON(sj, roles)
		if err != nil {
			return nil, err
		}
		sr.Register(id, s)
	}
	if _, err := dec.Token(); err != nil {
		return nil, err
	}
	return sr, nil
}
