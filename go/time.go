package rights

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// isoTime matches the ISO 8601 forms that JavaScript's Date reads the same way
// on every engine: a date, optionally followed by a time and an offset.
var isoTime = regexp.MustCompile(
	`^([+-]\d{6}|\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?` +
		`(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?` +
		`(Z|z|[+-]\d{2}:?\d{2})?$`)

// parseTime reads an instant the way the TypeScript implementation does. A
// date alone, or a time with an offset, is exact; a time without an offset is
// local time, as in JavaScript. It reports false for anything else, which
// callers ignore rather than reject.
func parseTime(s string) (time.Time, bool) {
	m := isoTime.FindStringSubmatch(trimJS(s))
	if m == nil {
		return time.Time{}, false
	}
	num := func(v string, def int) int {
		if v == "" {
			return def
		}
		n, _ := strconv.Atoi(v)
		return n
	}
	year := num(m[1], 0)
	month, day := num(m[2], 1), num(m[3], 1)
	hour, minute, second := num(m[4], 0), num(m[5], 0), num(m[6], 0)
	if month < 1 || month > 12 || day < 1 || day > 31 ||
		hour > 24 || minute > 59 || second > 59 {
		return time.Time{}, false
	}
	if hour == 24 && (minute != 0 || second != 0 || strings.Trim(m[7], "0") != "") {
		return time.Time{}, false
	}
	ms := 0
	if frac := m[7]; frac != "" {
		frac = (frac + "00")[:3]
		ms = num(frac, 0)
	}

	loc := time.UTC
	switch offset := m[8]; {
	case offset == "Z" || offset == "z":
	case offset != "":
		sign := 1
		if offset[0] == '-' {
			sign = -1
		}
		digits := strings.ReplaceAll(offset[1:], ":", "")
		offHours, offMinutes := num(digits[:2], 0), num(digits[2:], 0)
		if offHours > 23 || offMinutes > 59 {
			return time.Time{}, false
		}
		secs := sign * (offHours*3600 + offMinutes*60)
		loc = time.FixedZone("", secs)
	case m[4] != "":
		loc = time.Local
	}
	t := time.Date(year, time.Month(month), day, hour, minute, second, ms*1e6, loc)
	return t.UTC(), true
}

// formatTime writes an instant as JavaScript's Date.toISOString does: UTC with
// milliseconds.
func formatTime(t time.Time) string {
	t = t.UTC()
	year := t.Year()
	var y string
	switch {
	case year < 0:
		y = fmt.Sprintf("-%06d", -year)
	case year > 9999:
		y = fmt.Sprintf("+%06d", year)
	default:
		y = fmt.Sprintf("%04d", year)
	}
	return y + t.Format("-01-02T15:04:05.000Z")
}
