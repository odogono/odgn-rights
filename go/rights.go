package rights

import (
	"cmp"
	"encoding/json"
	"regexp"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// maxCachedPaths bounds the per-path cache of matching rights, so a service
// checking many distinct paths does not grow it without limit.
const maxCachedPaths = 4096

// Rights is an ordered collection of Rights that answers checks as one unit.
// The zero value is an empty, usable collection; a Rights must not be copied
// after first use.
type Rights struct {
	mu     sync.RWMutex
	list   []*Right
	sealed atomic.Bool

	cacheMu sync.Mutex
	cache   map[string][]*Right
}

// NewRights makes a collection holding the given rights, in order.
func NewRights(rights ...*Right) *Rights {
	return &Rights{list: slices.Clone(rights)}
}

func (rs *Rights) checkSealed() error {
	if rs.sealed.Load() {
		return &SealedError{Target: "Rights"}
	}
	return nil
}

// changed drops cached matches. Callers hold rs.mu for writing.
func (rs *Rights) changed() {
	rs.cacheMu.Lock()
	rs.cache = nil
	rs.cacheMu.Unlock()
}

// Seal stops further changes to this collection and every right in it.
func (rs *Rights) Seal() *Rights {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	rs.sealed.Store(true)
	for _, r := range rs.list {
		r.Seal()
	}
	return rs
}

// IsSealed reports whether the collection is sealed.
func (rs *Rights) IsSealed() bool { return rs.sealed.Load() }

// Len returns the number of rights.
func (rs *Rights) Len() int {
	rs.mu.RLock()
	defer rs.mu.RUnlock()
	return len(rs.list)
}

// List returns the rights in the order they were added.
func (rs *Rights) List() []*Right {
	rs.mu.RLock()
	defer rs.mu.RUnlock()
	return slices.Clone(rs.list)
}

// Add appends a right.
func (rs *Rights) Add(r *Right) error {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if err := rs.checkSealed(); err != nil {
		return err
	}
	rs.list = append(rs.list, r)
	rs.changed()
	return nil
}

// Remove removes a right, reporting whether it was present.
func (rs *Rights) Remove(r *Right) (bool, error) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if err := rs.checkSealed(); err != nil {
		return false, err
	}
	i := slices.Index(rs.list, r)
	if i == -1 {
		return false, nil
	}
	rs.list = slices.Delete(rs.list, i, i+1)
	rs.changed()
	return true, nil
}

// FindByTag returns the rights with the tag.
func (rs *Rights) FindByTag(tag string) []*Right {
	return rs.filter(func(r *Right) bool { return r.HasTag(tag) })
}

// FindByAllTags returns the rights with every one of the tags.
func (rs *Rights) FindByAllTags(tags ...string) []*Right {
	return rs.filter(func(r *Right) bool { return r.HasAllTags(tags...) })
}

// FindByAnyTag returns the rights with at least one of the tags.
func (rs *Rights) FindByAnyTag(tags ...string) []*Right {
	return rs.filter(func(r *Right) bool { return r.HasAnyTag(tags...) })
}

func (rs *Rights) filter(keep func(*Right) bool) []*Right {
	rs.mu.RLock()
	defer rs.mu.RUnlock()
	var out []*Right
	for _, r := range rs.list {
		if keep(r) {
			out = append(out, r)
		}
	}
	return out
}

// RevokeByTag removes every right with the tag.
func (rs *Rights) RevokeByTag(tag string) error {
	return rs.removeWhere(func(r *Right) bool { return r.HasTag(tag) })
}

// Prune removes every right whose validity window ended before t.
func (rs *Rights) Prune(t time.Time) error {
	return rs.removeWhere(func(r *Right) bool { return r.IsExpired(t) })
}

func (rs *Rights) removeWhere(drop func(*Right) bool) error {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if err := rs.checkSealed(); err != nil {
		return err
	}
	n := len(rs.list)
	rs.list = slices.DeleteFunc(rs.list, drop)
	if len(rs.list) != n {
		rs.changed()
	}
	return nil
}

// AllowByTag allows the flags on every right with the tag.
func (rs *Rights) AllowByTag(tag string, flags ...Flags) error {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if err := rs.checkSealed(); err != nil {
		return err
	}
	var tagged []*Right
	for _, r := range rs.list {
		if r.HasTag(tag) {
			if err := r.checkSealed(); err != nil {
				return err
			}
			tagged = append(tagged, r)
		}
	}
	for _, r := range tagged {
		for _, f := range flags {
			r.setAllow(f)
		}
	}
	return nil
}

// Allow allows the flags on the path, changing the first right with exactly
// that path or adding a new one.
func (rs *Rights) Allow(path string, flags ...Flags) error {
	return rs.upsert(NormalizePath(path), flags, (*Right).setAllow)
}

// Deny denies the flags on the path, changing the first right with exactly
// that path or adding a new one.
func (rs *Rights) Deny(path string, flags ...Flags) error {
	return rs.upsert(NormalizePath(path), flags, (*Right).setDeny)
}

// Exclude denies the flags on the path, like Deny, ignoring one leading "!".
func (rs *Rights) Exclude(path string, flags ...Flags) error {
	return rs.Deny(strings.TrimPrefix(path, "!"), flags...)
}

func (rs *Rights) upsert(p string, flags []Flags, apply func(*Right, Flags)) error {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if err := rs.checkSealed(); err != nil {
		return err
	}
	i := slices.IndexFunc(rs.list, func(r *Right) bool { return r.path == p })
	var r *Right
	if i == -1 {
		r = newRightAt(p)
		rs.list = append(rs.list, r)
		rs.changed()
	} else {
		r = rs.list[i]
		if err := r.checkSealed(); err != nil {
			return err
		}
	}
	for _, f := range flags {
		apply(r, f)
	}
	return nil
}

// matching returns the rights matching the normalised path, in decision order.
func (rs *Rights) matching(p string) []*Right {
	rs.cacheMu.Lock()
	cached, ok := rs.cache[p]
	rs.cacheMu.Unlock()
	if ok {
		return cached
	}

	rs.mu.RLock()
	ordered := orderMatches(rs.list, p)
	rs.cacheMu.Lock()
	if rs.cache == nil || len(rs.cache) >= maxCachedPaths {
		rs.cache = make(map[string][]*Right)
	}
	rs.cache[p] = ordered
	rs.cacheMu.Unlock()
	rs.mu.RUnlock()
	return ordered
}

// orderMatches keeps the rights matching p and ranks them by priority, then
// specificity, then the order they appear in list.
func orderMatches(list []*Right, p string) []*Right {
	var out []*Right
	for _, r := range list {
		if r.matchesNormalized(p) {
			out = append(out, r)
		}
	}
	slices.SortStableFunc(out, func(a, b *Right) int {
		if c := cmp.Compare(b.priority, a.priority); c != 0 {
			return c
		}
		return cmp.Compare(b.specificity, a.specificity)
	})
	return out
}

// decide reports whether every flag in f is allowed by the ordered rights.
func decide(ordered []*Right, f Flags, cfg checkConfig) bool {
	for _, bit := range bits {
		if f&bit != 0 && !decideBit(ordered, bit, cfg) {
			return false
		}
	}
	return true
}

func decideBit(ordered []*Right, bit Flags, cfg checkConfig) bool {
	for _, r := range ordered {
		if !r.IsValidAt(cfg.now) {
			continue
		}
		if r.condition != nil && !r.condition(cfg.ctx) {
			continue
		}
		if r.deny&bit != 0 {
			return false
		}
		if r.allow&bit != 0 {
			return true
		}
	}
	return false
}

// CheckOption sets the time or context of a check.
type CheckOption func(*checkConfig)

type checkConfig struct {
	now time.Time
	ctx Context
}

// At makes a check use t as the current time for validity windows.
func At(t time.Time) CheckOption {
	return func(c *checkConfig) { c.now = t }
}

// WithContext supplies the attributes that conditions read.
func WithContext(ctx Context) CheckOption {
	return func(c *checkConfig) { c.ctx = ctx }
}

func newCheckConfig(opts []CheckOption) checkConfig {
	var cfg checkConfig
	for _, o := range opts {
		o(&cfg)
	}
	if cfg.now.IsZero() {
		cfg.now = time.Now()
	}
	return cfg
}

// Request is one check in a batch.
type Request struct {
	Path  string
	Flags Flags
}

// Has reports whether every one of the flags is allowed on the path.
func (rs *Rights) Has(path string, f Flags, opts ...CheckOption) bool {
	return decide(rs.matching(NormalizePath(path)), f, newCheckConfig(opts))
}

// CheckMany answers each request, in order, with the same time and context.
func (rs *Rights) CheckMany(reqs []Request, opts ...CheckOption) []bool {
	cfg := newCheckConfig(opts)
	out := make([]bool, len(reqs))
	for i, req := range reqs {
		out[i] = decide(rs.matching(NormalizePath(req.Path)), req.Flags, cfg)
	}
	return out
}

// Read reports whether reading the path is allowed.
func (rs *Rights) Read(path string, opts ...CheckOption) bool {
	return rs.Has(path, Read, opts...)
}

// Write reports whether writing the path is allowed.
func (rs *Rights) Write(path string, opts ...CheckOption) bool {
	return rs.Has(path, Write, opts...)
}

// Delete reports whether deleting the path is allowed.
func (rs *Rights) Delete(path string, opts ...CheckOption) bool {
	return rs.Has(path, Delete, opts...)
}

// Create reports whether creating the path is allowed.
func (rs *Rights) Create(path string, opts ...CheckOption) bool {
	return rs.Has(path, Create, opts...)
}

// Execute reports whether executing the path is allowed.
func (rs *Rights) Execute(path string, opts ...CheckOption) bool {
	return rs.Has(path, Execute, opts...)
}

// All reports whether every flag is allowed on the path.
func (rs *Rights) All(path string, opts ...CheckOption) bool {
	return rs.Has(path, All, opts...)
}

// String returns the text form of every right, separated by ", ".
func (rs *Rights) String() string { return rs.Format(", ") }

// Format returns the text form of every right, separated by sep.
func (rs *Rights) Format(sep string) string {
	list := rs.List()
	parts := make([]string, len(list))
	for i, r := range list {
		parts[i] = r.String()
	}
	return strings.Join(parts, sep)
}

// JSON returns the JSON form of every right.
func (rs *Rights) JSON() []RightJSON {
	list := rs.List()
	out := make([]RightJSON, len(list))
	for i, r := range list {
		out[i] = r.JSON()
	}
	return out
}

// MarshalJSON implements json.Marshaler.
func (rs *Rights) MarshalJSON() ([]byte, error) {
	return json.Marshal(rs.JSON())
}

// UnmarshalJSON implements json.Unmarshaler, replacing the collection's rights.
func (rs *Rights) UnmarshalJSON(data []byte) error {
	var items []RightJSON
	if err := json.Unmarshal(data, &items); err != nil {
		return err
	}
	loaded, err := RightsFromJSON(items)
	if err != nil {
		return err
	}
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if err := rs.checkSealed(); err != nil {
		return err
	}
	rs.list = loaded.list
	rs.changed()
	return nil
}

// RightsFromJSON makes a collection from the JSON form of its rights.
func RightsFromJSON(items []RightJSON) (*Rights, error) {
	rs := &Rights{list: make([]*Right, 0, len(items))}
	for _, item := range items {
		r, err := RightFromJSON(item)
		if err != nil {
			return nil, err
		}
		rs.list = append(rs.list, r)
	}
	return rs, nil
}

var listSeparators = regexp.MustCompile(`[\n\r,?]+`)

// ParseRights reads rights in text form, one per line or separated by commas.
// Blank entries are skipped.
//
// The input is also split at every "?" and at commas inside tags, so a list
// cannot hold a pattern with "?" or a right with more than one tag. This
// matches the TypeScript implementation.
func ParseRights(input string) (*Rights, error) {
	rs := &Rights{}
	if input == "" {
		return rs, nil
	}
	for _, part := range listSeparators.Split(input, -1) {
		part = trimJS(part)
		if part == "" {
			continue
		}
		r, err := ParseRight(part)
		if err != nil {
			return nil, err
		}
		rs.list = append(rs.list, r)
	}
	return rs, nil
}
