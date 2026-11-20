package rights

import "strings"

// Flags is a set of kinds of access. A check may ask for several flags at once
// and passes only if every one is allowed.
type Flags uint8

const (
	Read    Flags = 1
	Write   Flags = 2
	Delete  Flags = 4
	Create  Flags = 8
	Execute Flags = 16

	// All is every flag.
	All Flags = Read | Write | Delete | Create | Execute
)

// bits lists the single flags in the order checks consider them.
var bits = [...]Flags{Read, Write, Delete, Create, Execute}

// String returns the flags as letters in the order r, w, c, d, x, or "*" when
// every flag is set. No flags gives "".
func (f Flags) String() string {
	f &= All
	if f == All {
		return "*"
	}
	var b strings.Builder
	for _, l := range [...]struct {
		flag   Flags
		letter byte
	}{{Read, 'r'}, {Write, 'w'}, {Create, 'c'}, {Delete, 'd'}, {Execute, 'x'}} {
		if f&l.flag != 0 {
			b.WriteByte(l.letter)
		}
	}
	return b.String()
}

// ParseFlags reads flag letters (r, w, c, d, x), or "*" for every flag.
// Unknown letters are ignored.
func ParseFlags(letters string) Flags {
	if letters == "*" {
		return All
	}
	var f Flags
	for i := 0; i < len(letters); i++ {
		f |= flagForLetter(letters[i])
	}
	return f
}

func flagForLetter(c byte) Flags {
	switch c {
	case 'r':
		return Read
	case 'w':
		return Write
	case 'c':
		return Create
	case 'd':
		return Delete
	case 'x':
		return Execute
	}
	return 0
}
