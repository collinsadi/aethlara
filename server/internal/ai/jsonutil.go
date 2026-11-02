package ai

import (
	"encoding/json"
	"strings"
)

// ExtractJSON returns the JSON document contained in s. Models occasionally
// wrap JSON in ``` fences or add a sentence before/after it even when told
// not to; this recovers the value in those cases. Returns ok=false when no
// valid JSON object or array can be found.
func ExtractJSON(s string) (string, bool) {
	t := strings.TrimSpace(s)
	if t == "" {
		return s, false
	}
	if json.Valid([]byte(t)) {
		return t, true
	}

	// Strip a leading ```json / ``` fence and its closing fence.
	if strings.HasPrefix(t, "```") {
		inner := strings.TrimPrefix(t, "```")
		if nl := strings.IndexByte(inner, '\n'); nl >= 0 {
			inner = inner[nl+1:]
		}
		if end := strings.LastIndex(inner, "```"); end >= 0 {
			inner = inner[:end]
		}
		inner = strings.TrimSpace(inner)
		if json.Valid([]byte(inner)) {
			return inner, true
		}
		t = inner
	}

	// Fall back to the outermost {...} or [...] span that parses.
	for _, pair := range [][2]byte{{'{', '}'}, {'[', ']'}} {
		start := strings.IndexByte(t, pair[0])
		end := strings.LastIndexByte(t, pair[1])
		if start >= 0 && end > start {
			candidate := t[start : end+1]
			if json.Valid([]byte(candidate)) {
				return candidate, true
			}
		}
	}
	return s, false
}
