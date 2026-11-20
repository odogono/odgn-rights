package rights

import (
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf16"
)

// isJSSpace reports whether r is whitespace to JavaScript's String.trim, so
// paths and text trim the same way in both implementations.
func isJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xA0, 0xFEFF, 0x2028, 0x2029:
		return true
	}
	return unicode.Is(unicode.Zs, r)
}

func trimJS(s string) string {
	return strings.TrimFunc(s, isJSSpace)
}

// NormalizePath trims the path, gives it a leading slash, collapses repeated
// slashes and drops a trailing slash. An empty path is the root, "/".
func NormalizePath(p string) string {
	if p == "" {
		return "/"
	}
	out := trimJS(p)
	if !strings.HasPrefix(out, "/") {
		out = "/" + out
	}
	if strings.Contains(out, "//") {
		var b strings.Builder
		b.Grow(len(out))
		for i := 0; i < len(out); i++ {
			if out[i] == '/' && i > 0 && out[i-1] == '/' {
				continue
			}
			b.WriteByte(out[i])
		}
		out = b.String()
	}
	if len(out) > 1 && strings.HasSuffix(out, "/") {
		out = out[:len(out)-1]
	}
	return out
}

// parsePath strips leading "!" marks from p and normalises the rest. An odd
// number of marks makes the path negated.
func parsePath(p string) (path string, negated bool) {
	s := trimJS(p)
	for strings.HasPrefix(s, "!") {
		negated = !negated
		s = strings.TrimLeftFunc(s[1:], isJSSpace)
	}
	return NormalizePath(s), negated
}

// specificity ranks a path pattern by its count of segments without "*", then
// their total length in UTF-16 code units.
func specificity(path string) int {
	count, length := 0, 0
	for _, seg := range strings.Split(path, "/") {
		if seg == "" || strings.Contains(seg, "*") {
			continue
		}
		count++
		length += utf16Len(seg)
	}
	return count*1000 + length
}

func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		n += utf16.RuneLen(r)
	}
	return n
}

// globToRegexp turns a path pattern into an anchored expression: "**" (or more
// stars) matches across segments, "*" within one segment and "?" one
// character other than a slash.
func globToRegexp(pattern string) *regexp.Regexp {
	var b strings.Builder
	b.WriteByte('^')
	for i := 0; i < len(pattern); {
		switch pattern[i] {
		case '*':
			stars := 0
			for i < len(pattern) && pattern[i] == '*' {
				stars++
				i++
			}
			if stars >= 2 {
				// JavaScript's "." does not match line terminators.
				b.WriteString("[^\\n\\r\\x{2028}\\x{2029}]*")
			} else {
				b.WriteString("[^/]*")
			}
			continue
		case '?':
			b.WriteString("[^/]")
			i++
			continue
		}
		j := i + 1
		for j < len(pattern) && pattern[j] != '*' && pattern[j] != '?' {
			j++
		}
		b.WriteString(regexp.QuoteMeta(pattern[i:j]))
		i = j
	}
	b.WriteByte('$')
	return regexp.MustCompile(b.String())
}

// compareUTF16 orders strings by UTF-16 code units, as JavaScript's default
// sort does.
func compareUTF16(a, b string) int {
	return slices.Compare(utf16.Encode([]rune(a)), utf16.Encode([]rune(b)))
}
