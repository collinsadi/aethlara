package ai

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2"
	"github.com/anthropics/anthropic-sdk-go/v2/option"
)

// anthropicMaxContinuations bounds how many times a server-tool turn that
// stops with "pause_turn" is resumed before we give up.
const anthropicMaxContinuations = 4

// anthropicBackend calls the Anthropic Messages API through the official Go
// SDK. One SDK client is shared; the user's key is supplied per request.
type anthropicBackend struct {
	client anthropic.Client
}

func newAnthropicBackend(baseURL string, httpClient *http.Client) *anthropicBackend {
	opts := []option.RequestOption{
		// Never pick up ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or a CLI
		// profile from the server environment: every call must run on the
		// user's own key (see the package invariants).
		option.WithoutEnvironmentDefaults(),
		option.WithHTTPClient(httpClient),
		option.WithMaxRetries(2),
	}
	if baseURL != "" {
		opts = append(opts, option.WithBaseURL(baseURL))
	}
	return &anthropicBackend{client: anthropic.NewClient(opts...)}
}

func (b *anthropicBackend) complete(ctx context.Context, c call) (*Response, error) {
	params := b.baseParams(c)
	msg, err := b.stream(ctx, params, c.apiKey)
	if err != nil {
		return nil, err
	}
	if err := checkStop(msg); err != nil {
		return nil, err
	}
	return toResponse(msg, msg.Usage), nil
}

func (b *anthropicBackend) webSearch(ctx context.Context, c call) (*Response, error) {
	params := b.baseParams(c)
	if supportsDynamicWebSearch(c.model) {
		tool := anthropic.BetaWebSearchTool20260209Param{
			MaxUses:        anthropic.Int(int64(c.maxSearches)),
			BlockedDomains: c.blockedDomains,
		}
		params.Tools = []anthropic.BetaToolUnionParam{{OfWebSearchTool20260209: &tool}}
	} else {
		tool := anthropic.BetaWebSearchTool20250305Param{
			MaxUses:        anthropic.Int(int64(c.maxSearches)),
			BlockedDomains: c.blockedDomains,
		}
		params.Tools = []anthropic.BetaToolUnionParam{{OfWebSearchTool20250305: &tool}}
	}

	var (
		msg   *anthropic.BetaMessage
		usage anthropic.BetaUsage
	)
	for i := 0; i < anthropicMaxContinuations; i++ {
		m, err := b.stream(ctx, params, c.apiKey)
		if err != nil {
			return nil, err
		}
		usage.InputTokens += m.Usage.InputTokens
		usage.OutputTokens += m.Usage.OutputTokens
		usage.CacheReadInputTokens += m.Usage.CacheReadInputTokens
		msg = m
		if m.StopReason != anthropic.BetaStopReasonPauseTurn {
			break
		}
		// The server-side tool loop hit its iteration limit: send the
		// assistant turn back unchanged so the model can continue.
		params.Messages = append(params.Messages, m.ToParam())
	}
	if msg.StopReason == anthropic.BetaStopReasonPauseTurn {
		return nil, fmt.Errorf("%w: web search did not finish", ErrTruncated)
	}
	if err := checkStop(msg); err != nil {
		return nil, err
	}
	return toResponse(msg, usage), nil
}

// validateKey lists one model: free, and proves the key authenticates.
func (b *anthropicBackend) validateKey(ctx context.Context, apiKey, _ string) error {
	testCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	_, err := b.client.Models.List(testCtx, anthropic.ModelListParams{Limit: anthropic.Int(1)},
		option.WithAPIKey(apiKey))
	if err != nil {
		return mapAnthropicError(err)
	}
	return nil
}

func (b *anthropicBackend) baseParams(c call) anthropic.BetaMessageNewParams {
	system, messages := splitSystem(c.system, c.messages)

	params := anthropic.BetaMessageNewParams{
		Model:     c.model,
		MaxTokens: int64(c.maxTokens),
		Messages:  toBetaMessages(messages),
	}
	if system != "" {
		block := anthropic.BetaTextBlockParam{Text: system}
		if c.cacheSystem {
			block.CacheControl = anthropic.NewBetaCacheControlEphemeralParam()
		}
		params.System = []anthropic.BetaTextBlockParam{block}
	}
	if c.effort != "" && supportsEffort(c.model) {
		params.OutputConfig.Effort = anthropic.BetaOutputConfigEffort(c.effort)
	}
	if c.schema != nil && supportsStructuredOutputs(c.model) {
		params.OutputConfig.Format = anthropic.BetaJSONOutputFormatParam{Schema: c.schema}
	}
	if supportsDefaultFallbacks(c.model) {
		// If a safety classifier declines a request, let the API re-serve it
		// on a fallback model inside the same call instead of failing.
		params.Fallbacks = anthropic.BetaFallbacksParamOfDefault()
		params.Betas = append(params.Betas, anthropic.AnthropicBetaServerSideFallback2026_07_01)
	}
	return params
}

// stream runs the request as a stream (long thinking + long outputs never
// hit HTTP timeouts) and accumulates the final message.
func (b *anthropicBackend) stream(ctx context.Context, params anthropic.BetaMessageNewParams, apiKey string) (*anthropic.BetaMessage, error) {
	s := b.client.Beta.Messages.NewStreaming(ctx, params, option.WithAPIKey(apiKey))
	defer s.Close()

	msg := anthropic.BetaMessage{}
	for s.Next() {
		if err := msg.Accumulate(s.Current()); err != nil {
			return nil, fmt.Errorf("accumulate stream: %w", err)
		}
	}
	if err := s.Err(); err != nil {
		return nil, mapAnthropicError(err)
	}
	return &msg, nil
}

func checkStop(msg *anthropic.BetaMessage) error {
	switch msg.StopReason {
	case anthropic.BetaStopReasonRefusal:
		category := string(msg.StopDetails.Category)
		if category == "" {
			category = "unspecified"
		}
		return fmt.Errorf("%w (category: %s)", ErrRefused, category)
	case anthropic.BetaStopReasonMaxTokens:
		return ErrTruncated
	}
	return nil
}

func toResponse(msg *anthropic.BetaMessage, usage anthropic.BetaUsage) *Response {
	var sb strings.Builder
	for _, block := range msg.Content {
		if t, ok := block.AsAny().(anthropic.BetaTextBlock); ok {
			sb.WriteString(t.Text)
		}
	}
	return &Response{
		Content:         sb.String(),
		TokensIn:        int(usage.InputTokens + usage.CacheReadInputTokens + usage.CacheCreationInputTokens),
		TokensOut:       int(usage.OutputTokens),
		CacheReadTokens: int(usage.CacheReadInputTokens),
		Model:           msg.Model,
		FinishReason:    string(msg.StopReason),
	}
}

// splitSystem folds any "system" turns into the system prompt; the Messages
// API takes the system prompt as a top-level field.
func splitSystem(system string, msgs []Message) (string, []Message) {
	out := make([]Message, 0, len(msgs))
	parts := []string{}
	if system != "" {
		parts = append(parts, system)
	}
	for _, m := range msgs {
		if m.Role == RoleSystem {
			parts = append(parts, m.Content)
			continue
		}
		out = append(out, m)
	}
	return strings.Join(parts, "\n\n"), out
}

// toBetaMessages converts our role/content turns to SDK params. A history
// window can start on an assistant turn; the conversation must open with a
// user turn, so leading assistant turns are dropped.
func toBetaMessages(msgs []Message) []anthropic.BetaMessageParam {
	out := make([]anthropic.BetaMessageParam, 0, len(msgs))
	for _, m := range msgs {
		if len(out) == 0 && m.Role != RoleUser {
			continue
		}
		block := anthropic.NewBetaTextBlock(m.Content)
		if m.Role == RoleAssistant {
			out = append(out, anthropic.BetaMessageParam{
				OfAssistant: &anthropic.BetaAssistantMessageParam{
					Content: []anthropic.BetaContentBlockParamUnion{block},
				},
			})
			continue
		}
		out = append(out, anthropic.NewBetaUserMessage(block))
	}
	return out
}

func mapAnthropicError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	var apierr *anthropic.Error
	if errors.As(err, &apierr) {
		return &ProviderError{
			Provider: ProviderAnthropic,
			Status:   apierr.StatusCode,
			Type:     string(apierr.Type()),
			Message:  truncate(apierr.Error(), 200),
		}
	}
	return fmt.Errorf("anthropic request: %w", err)
}
