package job

import (
	"strings"
	"testing"
)

func TestTransitionPath(t *testing.T) {
	cases := []struct {
		from, to string
		want     string // comma-joined; "nil" when unreachable
	}{
		{"not_applied", "applied", "applied"},
		{"not_applied", "rejected", "applied,rejected"},
		{"not_applied", "offer", "applied,interview,offer"},
		{"applied", "interview", "interview"},
		{"interview", "interview", ""},
		{"rejected", "interview", "nil"},
		{"offer", "applied", "nil"},
	}
	for _, c := range cases {
		path := TransitionPath(c.from, c.to)
		got := "nil"
		if path != nil {
			got = strings.Join(path, ",")
		}
		if got != c.want {
			t.Errorf("TransitionPath(%s, %s) = %q, want %q", c.from, c.to, got, c.want)
		}
	}
}
