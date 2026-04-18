package sanitise_test

import (
	"testing"

	"github.com/collinsadi/aethlara/pkg/sanitise"
)

func TestResumeText(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "empty string unchanged",
			input:    "",
			expected: "",
		},
		{
			name:     "plain ASCII unchanged",
			input:    "Jane Doe, Software Engineer",
			expected: "Jane Doe, Software Engineer",
		},
		{
			name:     "bullet mojibake",
			input:    "â\x80¢ Developed REST APIs",
			expected: "- Developed REST APIs",
		},
		{
			name:     "em dash mojibake",
			input:    "Senior Engineer â\x80\x94 5 years",
			expected: "Senior Engineer -- 5 years",
		},
		{
			name:     "en dash mojibake",
			input:    "2020â\x80\x932024",
			expected: "2020-2024",
		},
		{
			name:     "left double quote mojibake",
			input:    "â\x80\x9cSenior Engineerâ\x80\x9d",
			expected: "\"Senior Engineer\"",
		},
		{
			name:     "smart quotes mojibake",
			input:    "â\x80\x98it's fastâ\x80\x99",
			expected: "'it's fast'",
		},
		{
			name:     "ellipsis mojibake",
			input:    "Experience with Goâ\x80¦",
			expected: "Experience with Go...",
		},
		{
			name:     "middle dot mojibake",
			input:    "Go\xc2\xb7PostgreSQL",
			expected: "Go-PostgreSQL",
		},
		{
			name:     "non-breaking space mojibake",
			input:    "Go\xc2\xa0Developer",
			expected: "Go Developer",
		},
		{
			name:     "unicode bullet direct",
			input:    "\u2022 Built microservices",
			expected: "- Built microservices",
		},
		{
			name:     "unicode em dash direct",
			input:    "Go \u2014 PostgreSQL \u2014 Docker",
			expected: "Go -- PostgreSQL -- Docker",
		},
		{
			name:     "unicode en dash direct",
			input:    "2020\u20132024",
			expected: "2020-2024",
		},
		{
			name:     "unicode smart quotes direct",
			input:    "\u201CSenior Engineer\u201D",
			expected: "\"Senior Engineer\"",
		},
		{
			name:     "unicode ellipsis direct",
			input:    "Experience with Go\u2026",
			expected: "Experience with Go...",
		},
		{
			name:     "unicode non-breaking space direct",
			input:    "Go\u00A0Developer",
			expected: "Go Developer",
		},
		{
			name:     "BOM stripped",
			input:    "\uFEFFresume content",
			expected: "resume content",
		},
		{
			name:     "mixed mojibake in a bullet list",
			input:    "â\x80¢ Go â\x80\x94 PostgreSQL â\x80¢ Docker",
			expected: "- Go -- PostgreSQL - Docker",
		},
		{
			name:     "invalid utf-8 bytes stripped",
			input:    "Hello\x80World",
			expected: "HelloWorld",
		},
		{
			name:     "trade mark mojibake",
			input:    "Goâ\x84¢",
			expected: "GoTM",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sanitise.ResumeText(tt.input)
			if result != tt.expected {
				t.Errorf("ResumeText(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestResumeJSON(t *testing.T) {
	input := map[string]any{
		"name":    "Jane Doe",
		"summary": "Experienced â\x80\x94 developer",
		"skills":  []any{"Go", "\u2022 PostgreSQL", "Docker"},
		"meta":    map[string]any{"note": "â\x80¢ key insight"},
		"score":   87, // non-string should pass through unchanged
	}

	result := sanitise.ResumeJSON(input).(map[string]any)

	if result["name"] != "Jane Doe" {
		t.Errorf("name: got %q, want %q", result["name"], "Jane Doe")
	}
	if result["summary"] != "Experienced -- developer" {
		t.Errorf("summary: got %q, want %q", result["summary"], "Experienced -- developer")
	}

	skills := result["skills"].([]any)
	if skills[1] != "- PostgreSQL" {
		t.Errorf("skills[1]: got %q, want %q", skills[1], "- PostgreSQL")
	}

	meta := result["meta"].(map[string]any)
	if meta["note"] != "- key insight" {
		t.Errorf("meta.note: got %q, want %q", meta["note"], "- key insight")
	}

	if result["score"] != 87 {
		t.Errorf("score (non-string): got %v, want 87", result["score"])
	}
}

func TestStripBOM(t *testing.T) {
	withBOM := []byte{0xEF, 0xBB, 0xBF, 'h', 'e', 'l', 'l', 'o'}
	result := sanitise.StripBOM(withBOM)
	if string(result) != "hello" {
		t.Errorf("StripBOM with BOM: got %q, want %q", result, "hello")
	}

	noBOM := []byte("hello")
	result = sanitise.StripBOM(noBOM)
	if string(result) != "hello" {
		t.Errorf("StripBOM without BOM: got %q, want %q", result, "hello")
	}
}
