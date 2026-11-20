package rights

import (
	"encoding/json"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// Context holds the attributes supplied with a check, which conditions read.
type Context = map[string]any

// Condition is a predicate over a check's context. A Right whose condition
// fails is ignored for that check. The context is nil when the check has none.
type Condition = func(ctx Context) bool

// RightOptions configures a new Right. Zero values mean "not set".
type RightOptions struct {
	Allow       Flags
	Deny        Flags
	Description string
	Condition   Condition
	Priority    int
	Tags        []string
	ValidFrom   time.Time
	ValidUntil  time.Time
}

// Right is one rule: a path pattern with the flags it allows and the flags it
// denies, plus optional priority, tags, validity window and condition.
type Right struct {
	path        string
	allow, deny Flags
	description string
	condition   Condition
	priority    int
	tags        map[string]struct{}
	validFrom   time.Time
	validUntil  time.Time
	specificity int
	re          *regexp.Regexp
	sealed      atomic.Bool
}

// NewRight makes a Right for a path pattern. A path starting with "!" swaps
// the allowed and denied flags; a second "!" cancels the first. It returns
// ErrInvalidWindow when the validity window ends before it starts.
func NewRight(path string, opts RightOptions) (*Right, error) {
	p, negated := parsePath(path)
	r := &Right{
		path:        p,
		description: opts.Description,
		condition:   opts.Condition,
		priority:    opts.Priority,
		tags:        make(map[string]struct{}, len(opts.Tags)),
		validFrom:   opts.ValidFrom,
		validUntil:  opts.ValidUntil,
		specificity: specificity(p),
	}
	for _, t := range opts.Tags {
		r.tags[t] = struct{}{}
	}
	if !r.validFrom.IsZero() && !r.validUntil.IsZero() && r.validFrom.After(r.validUntil) {
		return nil, ErrInvalidWindow
	}
	if strings.ContainsAny(p, "*?") {
		r.re = globToRegexp(p)
	}
	allow, deny := opts.Allow, opts.Deny
	if negated {
		allow, deny = deny, allow
	}
	r.setAllow(allow)
	r.setDeny(deny)
	return r, nil
}

// MustRight is like NewRight but panics on error. It suits rights written in
// code.
func MustRight(path string, opts RightOptions) *Right {
	r, err := NewRight(path, opts)
	if err != nil {
		panic(err)
	}
	return r
}

func (r *Right) setAllow(f Flags) {
	r.allow |= f
	r.deny &^= f
}

func (r *Right) setDeny(f Flags) {
	r.deny |= f
	r.allow &^= f
}

func (r *Right) checkSealed() error {
	if r.sealed.Load() {
		return &SealedError{Target: "Right " + r.path}
	}
	return nil
}

// Seal stops further changes to this right's flags and tags.
func (r *Right) Seal() *Right {
	r.sealed.Store(true)
	return r
}

// IsSealed reports whether the right is sealed.
func (r *Right) IsSealed() bool { return r.sealed.Load() }

// Allow allows the flags, clearing them from the denied flags.
func (r *Right) Allow(f Flags) error {
	if err := r.checkSealed(); err != nil {
		return err
	}
	r.setAllow(f)
	return nil
}

// Deny denies the flags, clearing them from the allowed flags.
func (r *Right) Deny(f Flags) error {
	if err := r.checkSealed(); err != nil {
		return err
	}
	r.setDeny(f)
	return nil
}

// Clear removes every allowed and denied flag.
func (r *Right) Clear() error {
	if err := r.checkSealed(); err != nil {
		return err
	}
	r.allow, r.deny = 0, 0
	return nil
}

// AddTag adds a tag.
func (r *Right) AddTag(tag string) error {
	if err := r.checkSealed(); err != nil {
		return err
	}
	r.tags[tag] = struct{}{}
	return nil
}

// RemoveTag removes a tag.
func (r *Right) RemoveTag(tag string) error {
	if err := r.checkSealed(); err != nil {
		return err
	}
	delete(r.tags, tag)
	return nil
}

// Path returns the normalised path pattern.
func (r *Right) Path() string { return r.path }

// Allowed returns the allowed flags.
func (r *Right) Allowed() Flags { return r.allow }

// Denied returns the denied flags.
func (r *Right) Denied() Flags { return r.deny }

// Description returns the description, which never affects a decision.
func (r *Right) Description() string { return r.description }

// Condition returns the condition, or nil.
func (r *Right) Condition() Condition { return r.condition }

// Priority returns the priority; higher wins, and the default is zero.
func (r *Right) Priority() int { return r.priority }

// Specificity returns how narrowly the path pattern targets paths.
func (r *Right) Specificity() int { return r.specificity }

// ValidFrom returns the start of the validity window, or the zero time.
func (r *Right) ValidFrom() time.Time { return r.validFrom }

// ValidUntil returns the end of the validity window, or the zero time.
func (r *Right) ValidUntil() time.Time { return r.validUntil }

// Tags returns the tags, sorted.
func (r *Right) Tags() []string {
	out := make([]string, 0, len(r.tags))
	for t := range r.tags {
		out = append(out, t)
	}
	slices.Sort(out)
	return out
}

// HasTag reports whether the right has the tag.
func (r *Right) HasTag(tag string) bool {
	_, ok := r.tags[tag]
	return ok
}

// HasAllTags reports whether the right has every one of the tags.
func (r *Right) HasAllTags(tags ...string) bool {
	for _, t := range tags {
		if !r.HasTag(t) {
			return false
		}
	}
	return true
}

// HasAnyTag reports whether the right has at least one of the tags.
func (r *Right) HasAnyTag(tags ...string) bool {
	return slices.ContainsFunc(tags, r.HasTag)
}

// IsValidAt reports whether t falls within the validity window. Both ends are
// inclusive.
func (r *Right) IsValidAt(t time.Time) bool {
	if !r.validFrom.IsZero() && t.Before(r.validFrom) {
		return false
	}
	if !r.validUntil.IsZero() && t.After(r.validUntil) {
		return false
	}
	return true
}

// IsExpired reports whether the validity window ended before t.
func (r *Right) IsExpired(t time.Time) bool {
	return !r.validUntil.IsZero() && t.After(r.validUntil)
}

// Has reports whether this right on its own allows every one of the flags at
// time t. It ignores the condition.
func (r *Right) Has(f Flags, t time.Time) bool {
	if !r.IsValidAt(t) {
		return false
	}
	return r.deny&f == 0 && r.allow&f == f
}

// Matches reports whether the path pattern covers the path. A pattern with no
// wildcards also covers everything beneath it.
func (r *Right) Matches(path string) bool {
	return r.matchesNormalized(NormalizePath(path))
}

func (r *Right) matchesNormalized(p string) bool {
	if r.re != nil {
		return r.re.MatchString(p)
	}
	if r.path == "/" {
		return true
	}
	return p == r.path || strings.HasPrefix(p, r.path+"/")
}

// String returns the text form: "-denied+allowed:/path^priority#tags@from/until".
func (r *Right) String() string {
	var b strings.Builder
	if d := r.deny.String(); d != "" {
		b.WriteString("-" + d)
	}
	if a := r.allow.String(); a != "" {
		b.WriteString("+" + a)
	}
	b.WriteString(":" + r.path)
	if r.priority != 0 {
		b.WriteString("^" + strconv.Itoa(r.priority))
	}
	if len(r.tags) > 0 {
		b.WriteString("#" + strings.Join(r.Tags(), ","))
	}
	if !r.validFrom.IsZero() || !r.validUntil.IsZero() {
		from, until := "*", "*"
		if !r.validFrom.IsZero() {
			from = formatTime(r.validFrom)
		}
		if !r.validUntil.IsZero() {
			until = formatTime(r.validUntil)
		}
		b.WriteString("@" + from + "/" + until)
	}
	return b.String()
}

// RightJSON is the JSON form of a Right. Conditions are code, so they never
// appear in it.
type RightJSON struct {
	Path        string   `json:"path"`
	Allow       string   `json:"allow"`
	Deny        string   `json:"deny,omitempty"`
	Description string   `json:"description,omitempty"`
	Priority    int      `json:"priority,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	ValidFrom   string   `json:"validFrom,omitempty"`
	ValidUntil  string   `json:"validUntil,omitempty"`
}

// JSON returns the JSON form of the right.
func (r *Right) JSON() RightJSON {
	out := RightJSON{
		Path:        r.path,
		Allow:       r.allow.String(),
		Deny:        r.deny.String(),
		Description: r.description,
		Priority:    r.priority,
	}
	if len(r.tags) > 0 {
		out.Tags = r.Tags()
	}
	if !r.validFrom.IsZero() {
		out.ValidFrom = formatTime(r.validFrom)
	}
	if !r.validUntil.IsZero() {
		out.ValidUntil = formatTime(r.validUntil)
	}
	return out
}

// MarshalJSON implements json.Marshaler.
func (r *Right) MarshalJSON() ([]byte, error) {
	return json.Marshal(r.JSON())
}

// RightFromJSON makes a Right from its JSON form. Unreadable dates and unknown
// flag letters are ignored. A leading "!" in the path is part of the path, not
// a negation.
func RightFromJSON(j RightJSON) (*Right, error) {
	opts := RightOptions{
		Description: j.Description,
		Priority:    j.Priority,
		Tags:        j.Tags,
	}
	if t, ok := parseTime(j.ValidFrom); ok && j.ValidFrom != "" {
		opts.ValidFrom = t
	}
	if t, ok := parseTime(j.ValidUntil); ok && j.ValidUntil != "" {
		opts.ValidUntil = t
	}
	r, err := NewRight(NormalizePath(j.Path), opts)
	if err != nil {
		return nil, err
	}
	r.setAllow(ParseFlags(j.Allow))
	r.setDeny(ParseFlags(j.Deny))
	return r, nil
}

// ParseRight reads a Right from its text form,
// "-denied+allowed:/path^priority#tags@from/until", where every part but the
// path is optional. Unknown flag letters, an unreadable priority and
// unreadable dates are ignored. A path starting with "!" swaps "+" and "-".
// It returns ErrInvalidWindow when the validity window ends before it starts.
func ParseRight(input string) (*Right, error) {
	s := trimJS(input)
	colon := strings.IndexByte(s, ':')
	hash := strings.LastIndexByte(s, '#')
	at := strings.LastIndexByte(s, '@')

	var flagsStr, pathStr, tagsStr, timeStr, priorityStr string
	pathEnd := len(s)
	if at != -1 {
		timeStr = s[at+1:]
		pathEnd = at
	}
	if hash != -1 && (at == -1 || hash < at) {
		tagsStr = s[hash+1 : pathEnd]
		pathEnd = hash
	}
	pathStart := 0
	if colon != -1 {
		pathStart = colon + 1
	}
	if caret := strings.IndexByte(s[min(pathStart, len(s)):], '^'); caret != -1 {
		caret += pathStart
		if caret < pathEnd {
			priorityStr = s[caret+1 : pathEnd]
			pathEnd = caret
		}
	}
	if colon == -1 {
		pathStr = s[:pathEnd]
	} else {
		flagsStr = s[:colon]
		pathStr = s[colon+1 : max(pathEnd, colon+1)]
	}

	var opts RightOptions
	if timeStr != "" {
		from, until, _ := strings.Cut(timeStr, "/")
		if before, _, found := strings.Cut(until, "/"); found {
			until = before
		}
		if from != "" && from != "*" {
			if t, ok := parseTime(from); ok {
				opts.ValidFrom = t
			}
		}
		if until != "" && until != "*" {
			if t, ok := parseTime(until); ok {
				opts.ValidUntil = t
			}
		}
	}
	if tagsStr != "" {
		for _, t := range strings.Split(tagsStr, ",") {
			opts.Tags = append(opts.Tags, trimJS(t))
		}
	}
	if priorityStr != "" {
		if p, ok := parseLeadingInt(priorityStr); ok {
			opts.Priority = p
		}
	}

	path, negated := parsePath(pathStr)
	r, err := NewRight(path, opts)
	if err != nil {
		return nil, err
	}

	for i := 0; i < len(flagsStr); {
		sign := flagsStr[i]
		i++
		if sign != '+' && sign != '-' {
			continue
		}
		start := i
		for i < len(flagsStr) && flagsStr[i] != '+' && flagsStr[i] != '-' {
			i++
		}
		apply := r.setAllow
		if (sign == '-') != negated {
			apply = r.setDeny
		}
		letters := flagsStr[start:i]
		if letters == "*" {
			apply(All)
			continue
		}
		for j := 0; j < len(letters); j++ {
			if f := flagForLetter(letters[j]); f != 0 {
				apply(f)
			}
		}
	}
	return r, nil
}

// MustParseRight is like ParseRight but panics on error.
func MustParseRight(input string) *Right {
	r, err := ParseRight(input)
	if err != nil {
		panic(err)
	}
	return r
}

// parseLeadingInt reads a base-10 integer prefix as JavaScript's parseInt
// does: leading whitespace, an optional sign, then digits up to the first
// non-digit.
func parseLeadingInt(s string) (int, bool) {
	s = strings.TrimLeftFunc(s, isJSSpace)
	end := 0
	if end < len(s) && (s[end] == '+' || s[end] == '-') {
		end++
	}
	digits := end
	for end < len(s) && s[end] >= '0' && s[end] <= '9' {
		end++
	}
	if end == digits {
		return 0, false
	}
	n, err := strconv.Atoi(s[:end])
	if err != nil {
		return 0, false
	}
	return n, true
}
