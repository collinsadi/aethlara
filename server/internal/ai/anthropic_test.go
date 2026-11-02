package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

type staticCreds struct{ cred Credential }

func (s staticCreds) GetCredential(context.Context, string) (*Credential, error) {
	c := s.cred
	return &c, nil
}

type recordedRequest struct {
	path   string
	header http.Header
	body   map[string]any
}

// sseMessage renders a minimal Messages API stream that emits text and ends
// with stopReason.
func sseMessage(model, text, stopReason string) string {
	textJSON, _ := json.Marshal(text)
	return strings.Join([]string{
		"event: message_start",
		fmt.Sprintf(`data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":%q,"content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":12,"output_tokens":1,"cache_read_input_tokens":7}}}`, model),
		"",
		"event: content_block_start",
		`data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
		"",
		"event: content_block_delta",
		fmt.Sprintf(`data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":%s}}`, textJSON),
		"",
		"event: content_block_stop",
		`data: {"type":"content_block_stop","index":0}`,
		"",
		"event: message_delta",
		fmt.Sprintf(`data: {"type":"message_delta","delta":{"stop_reason":%q,"stop_sequence":null},"usage":{"output_tokens":9}}`, stopReason),
		"",
		"event: message_stop",
		`data: {"type":"message_stop"}`,
		"",
		"",
	}, "\n")
}

func newMockAnthropic(t *testing.T, respond func(r recordedRequest) string) (*httptest.Server, *[]recordedRequest) {
	t.Helper()
	var (
		mu   sync.Mutex
		reqs []recordedRequest
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		rec := recordedRequest{path: r.URL.Path, header: r.Header.Clone()}
		_ = json.Unmarshal(raw, &rec.body)
		mu.Lock()
		reqs = append(reqs, rec)
		mu.Unlock()

		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, respond(rec))
	}))
	t.Cleanup(srv.Close)
	return srv, &reqs
}

func newTestClient(baseURL string, cred Credential) *Client {
	c := NewClient(Config{
		AnthropicBaseURL:   baseURL,
		AnthropicModel:     "claude-opus-5-5",
		AnthropicFastModel: "claude-haiku-5-5",
	})
	c.SetCredentialProvider(staticCreds{cred: cred})
	return c
}

func TestAnthropicCompleteStructuredOutput(t *testing.T) {
	srv, reqs := newMockAnthropic(t, func(r recordedRequest) string {
		return sseMessage(r.body["model"].(string), "```json\n{\"score\": 91}\n```", "end_turn")
	})
	c := newTestClient(srv.URL, Credential{Provider: ProviderAnthropic, APIKey: "sk-ant-test"})

	schema := map[string]any{
		"type":                 "object",
		"properties":           map[string]any{"score": map[string]any{"type": "integer"}},
		"required":             []string{"score"},
		"additionalProperties": false,
	}
	resp, err := c.Complete(context.Background(), Request{
		UserID:       "u1",
		SystemPrompt: "Score it.",
		UserMessage:  "job",
		JSONSchema:   schema,
		CacheSystem:  true,
		Stage:        StageLeadScoring,
	})
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if resp.Content != `{"score": 91}` {
		t.Fatalf("content = %q (fences should be stripped)", resp.Content)
	}
	if resp.Provider != ProviderAnthropic || resp.Model != "claude-opus-5-5" {
		t.Fatalf("provider/model = %s/%s", resp.Provider, resp.Model)
	}
	if resp.CacheReadTokens != 7 || resp.TokensOut != 9 {
		t.Fatalf("usage = in %d cache %d out %d", resp.TokensIn, resp.CacheReadTokens, resp.TokensOut)
	}

	if len(*reqs) != 1 {
		t.Fatalf("requests = %d", len(*reqs))
	}
	got := (*reqs)[0]
	if got.path != "/v1/messages" {
		t.Fatalf("path = %s", got.path)
	}
	if auth := got.header.Get("Authorization"); auth != "Bearer sk-ant-test" && got.header.Get("X-Api-Key") != "sk-ant-test" {
		t.Fatalf("user key not sent; Authorization=%q X-Api-Key=%q", auth, got.header.Get("X-Api-Key"))
	}
	if !strings.Contains(got.header.Get("Anthropic-Beta"), "server-side-fallback-2026-07-01") {
		t.Fatalf("missing fallback beta header: %q", got.header.Get("Anthropic-Beta"))
	}
	if got.body["fallbacks"] != "default" {
		t.Fatalf("fallbacks = %v", got.body["fallbacks"])
	}
	if _, ok := got.body["temperature"]; ok {
		t.Fatal("temperature must never be sent to Anthropic")
	}
	if got.body["stream"] != true {
		t.Fatalf("stream = %v", got.body["stream"])
	}
	oc, _ := got.body["output_config"].(map[string]any)
	if oc["effort"] != "medium" {
		t.Fatalf("effort = %v", oc["effort"])
	}
	format, _ := oc["format"].(map[string]any)
	if format["type"] != "json_schema" || format["schema"] == nil {
		t.Fatalf("format = %v", format)
	}
	system, _ := got.body["system"].([]any)
	if len(system) != 1 {
		t.Fatalf("system = %v", got.body["system"])
	}
	if cc, _ := system[0].(map[string]any)["cache_control"].(map[string]any); cc["type"] != "ephemeral" {
		t.Fatalf("system cache_control = %v", system[0])
	}
}

func TestAnthropicFastTierUsesFastModelAndLowEffort(t *testing.T) {
	srv, reqs := newMockAnthropic(t, func(r recordedRequest) string {
		return sseMessage(r.body["model"].(string), `{"ok":true}`, "end_turn")
	})
	c := newTestClient(srv.URL, Credential{Provider: ProviderAnthropic, APIKey: "sk-ant-test", FastModel: "claude-haiku-5-5"})

	if _, err := c.Complete(context.Background(), Request{UserID: "u1", UserMessage: "x", Tier: TierFast, JSON: true}); err != nil {
		t.Fatalf("Complete: %v", err)
	}
	body := (*reqs)[0].body
	if body["model"] != "claude-haiku-5-5" {
		t.Fatalf("model = %v", body["model"])
	}
	if _, ok := body["fallbacks"]; ok {
		t.Fatal("haiku has no server-side fallback; fallbacks must be omitted")
	}
	if oc, _ := body["output_config"].(map[string]any); oc["effort"] != "low" {
		t.Fatalf("effort = %v", body["output_config"])
	}
	if body["max_tokens"].(float64) != defaultFastMaxTokens {
		t.Fatalf("max_tokens = %v", body["max_tokens"])
	}
}

func TestAnthropicStopReasons(t *testing.T) {
	cases := map[string]error{
		"refusal":    ErrRefused,
		"max_tokens": ErrTruncated,
	}
	for stop, want := range cases {
		t.Run(stop, func(t *testing.T) {
			srv, _ := newMockAnthropic(t, func(r recordedRequest) string {
				return sseMessage(r.body["model"].(string), "partial", stop)
			})
			c := newTestClient(srv.URL, Credential{Provider: ProviderAnthropic, APIKey: "sk-ant-test"})
			_, err := c.Complete(context.Background(), Request{UserID: "u1", UserMessage: "x"})
			if !errors.Is(err, want) {
				t.Fatalf("err = %v, want %v", err, want)
			}
		})
	}
}

func TestAnthropicWebSearchContinuesPausedTurns(t *testing.T) {
	calls := 0
	srv, reqs := newMockAnthropic(t, func(r recordedRequest) string {
		calls++
		if calls == 1 {
			return sseMessage(r.body["model"].(string), "searching...", "pause_turn")
		}
		return sseMessage(r.body["model"].(string), `[{"title":"Go Engineer"}]`, "end_turn")
	})
	c := newTestClient(srv.URL, Credential{Provider: ProviderAnthropic, APIKey: "sk-ant-test"})

	resp, err := c.WebSearch(context.Background(), WebSearchRequest{
		UserID: "u1", UserMessage: "find jobs", MaxSearches: 3, BlockedDomains: []string{"linkedin.com"},
	})
	if err != nil {
		t.Fatalf("WebSearch: %v", err)
	}
	if resp.Content != `[{"title":"Go Engineer"}]` {
		t.Fatalf("content = %q", resp.Content)
	}
	if len(*reqs) != 2 {
		t.Fatalf("requests = %d, want 2 (pause_turn continuation)", len(*reqs))
	}
	tools, _ := (*reqs)[0].body["tools"].([]any)
	if len(tools) != 1 {
		t.Fatalf("tools = %v", (*reqs)[0].body["tools"])
	}
	tool := tools[0].(map[string]any)
	if tool["type"] != "web_search_20260209" || tool["max_uses"].(float64) != 3 {
		t.Fatalf("tool = %v", tool)
	}
	// The continuation must replay the paused assistant turn.
	msgs, _ := (*reqs)[1].body["messages"].([]any)
	if len(msgs) != 2 || msgs[1].(map[string]any)["role"] != "assistant" {
		t.Fatalf("continuation messages = %v", msgs)
	}
}

func TestWebSearchUnsupportedOnOpenRouter(t *testing.T) {
	c := newTestClient("http://unused.invalid", Credential{Provider: ProviderOpenRouter, APIKey: "sk-or-test"})
	if _, err := c.WebSearch(context.Background(), WebSearchRequest{UserID: "u1", UserMessage: "x"}); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("err = %v, want ErrUnsupported", err)
	}
}

func TestNoCredentialProviderMeansNoKey(t *testing.T) {
	c := NewClient(Config{})
	if _, err := c.Complete(context.Background(), Request{UserID: "u1", UserMessage: "x"}); !errors.Is(err, ErrNoAPIKey) {
		t.Fatalf("err = %v, want ErrNoAPIKey", err)
	}
}
