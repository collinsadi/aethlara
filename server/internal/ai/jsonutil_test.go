package ai

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

func TestExtractJSON(t *testing.T) {
	tests := []struct {
		name   string
		in     string
		want   string
		wantOK bool
	}{
		{"plain object", `{"a":1}`, `{"a":1}`, true},
		{"whitespace", "  \n{\"a\":1}\n ", `{"a":1}`, true},
		{"json fence", "```json\n{\"a\":1}\n```", `{"a":1}`, true},
		{"bare fence", "```\n[1,2]\n```", `[1,2]`, true},
		{"prose around", "Here you go:\n{\"a\":{\"b\":2}}\nThanks!", `{"a":{"b":2}}`, true},
		{"array with prose", "Result: [1, 2, 3].", `[1, 2, 3]`, true},
		{"no json", "sorry, I can't", "sorry, I can't", false},
		{"empty", "", "", false},
		{"broken json", `{"a":`, `{"a":`, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := ExtractJSON(tt.in)
			if ok != tt.wantOK || got != tt.want {
				t.Fatalf("ExtractJSON(%q) = (%q, %v), want (%q, %v)", tt.in, got, ok, tt.want, tt.wantOK)
			}
		})
	}
}

func TestModelCapabilities(t *testing.T) {
	cases := []struct {
		model                                           string
		effort, structured, fallbacks, dynamicWebSearch bool
	}{
		{"claude-opus-5-5", true, true, true, true},
		{"claude-sonnet-5-5", true, true, true, true},
		{"claude-haiku-5-5", true, true, false, false},
		{"claude-fable-5-1", true, true, true, false},
		{"claude-haiku-4-5", false, true, false, false},
		{"claude-opus-4-6", true, false, false, true},
		{"claude-3-5-sonnet-latest", false, false, false, false},
	}
	for _, c := range cases {
		if got := supportsEffort(c.model); got != c.effort {
			t.Errorf("supportsEffort(%s) = %v", c.model, got)
		}
		if got := supportsStructuredOutputs(c.model); got != c.structured {
			t.Errorf("supportsStructuredOutputs(%s) = %v", c.model, got)
		}
		if got := supportsDefaultFallbacks(c.model); got != c.fallbacks {
			t.Errorf("supportsDefaultFallbacks(%s) = %v", c.model, got)
		}
		if got := supportsDynamicWebSearch(c.model); got != c.dynamicWebSearch {
			t.Errorf("supportsDynamicWebSearch(%s) = %v", c.model, got)
		}
	}
}

func TestClassifyError(t *testing.T) {
	cases := []struct {
		err  error
		want string
	}{
		{context.DeadlineExceeded, "timeout"},
		{fmt.Errorf("wrap: %w", ErrNoAPIKey), "no_api_key"},
		{&ProviderError{Provider: ProviderAnthropic, Status: 401}, "ai_auth_error"},
		{&ProviderError{Provider: ProviderAnthropic, Status: 529}, "ai_overloaded"},
		{&ProviderError{Provider: ProviderOpenRouter, Status: 402}, "ai_billing_error"},
		{&retryableError{status: 429}, "ai_rate_limited"},
		{fmt.Errorf("%w (category: cyber)", ErrRefused), "ai_refused"},
		{errors.New("something else"), "ai_unknown_error"},
	}
	for _, c := range cases {
		if got := ClassifyError(c.err); got != c.want {
			t.Errorf("ClassifyError(%v) = %q, want %q", c.err, got, c.want)
		}
	}
}

func TestToBetaMessagesDropsLeadingAssistant(t *testing.T) {
	msgs := toBetaMessages([]Message{
		{Role: RoleAssistant, Content: "earlier answer"},
		{Role: RoleUser, Content: "question"},
		{Role: RoleAssistant, Content: "answer"},
	})
	if len(msgs) != 2 {
		t.Fatalf("got %d messages, want 2", len(msgs))
	}
	if msgs[0].OfUser == nil || msgs[1].OfAssistant == nil {
		t.Fatalf("unexpected roles: %+v", msgs)
	}
}

func TestSplitSystemFoldsSystemTurns(t *testing.T) {
	sys, rest := splitSystem("base", []Message{
		{Role: RoleSystem, Content: "extra"},
		{Role: RoleUser, Content: "hi"},
	})
	if sys != "base\n\nextra" || len(rest) != 1 || rest[0].Role != RoleUser {
		t.Fatalf("splitSystem = %q, %+v", sys, rest)
	}
}
