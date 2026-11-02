package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/collinsadi/aethlara/internal/logger"
	"github.com/collinsadi/aethlara/pkg/sanitise"
)

const (
	openRouterTimeout        = 120 * time.Second
	openRouterMaxRetries     = 3
	openRouterRetryBaseDelay = time.Second
)

// openRouterBackend talks to OpenRouter's OpenAI-compatible chat completions
// endpoint over raw HTTP.
type openRouterBackend struct {
	baseURL string
	http    *http.Client
}

func newOpenRouterBackend(baseURL string) *openRouterBackend {
	return &openRouterBackend{
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{Timeout: openRouterTimeout},
	}
}

type openRouterRequest struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	MaxTokens   int       `json:"max_tokens,omitempty"`
	Temperature *float64  `json:"temperature,omitempty"`
}

type openRouterResponse struct {
	Model   string `json:"model"`
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
		Code    int    `json:"code"`
	} `json:"error,omitempty"`
}

func (b *openRouterBackend) complete(ctx context.Context, c call) (*Response, error) {
	messages := make([]Message, 0, len(c.messages)+1)
	if c.system != "" {
		messages = append(messages, Message{Role: RoleSystem, Content: c.system})
	}
	messages = append(messages, c.messages...)

	payload := openRouterRequest{
		Model:     c.model,
		Messages:  messages,
		MaxTokens: c.maxTokens,
	}
	// Anthropic models reject sampling parameters on current API versions;
	// only forward temperature to other model families, and only on request.
	if c.temperature != nil && !strings.HasPrefix(c.model, "anthropic/") {
		payload.Temperature = c.temperature
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	var (
		resp    *openRouterResponse
		lastErr error
	)
	for attempt := 0; attempt < openRouterMaxRetries; attempt++ {
		if attempt > 0 {
			delay := time.Duration(math.Pow(2, float64(attempt-1))) * openRouterRetryBaseDelay
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(delay):
			}
		}

		resp, lastErr = b.doRequest(ctx, c.apiKey, body)
		if lastErr == nil || !isRetryableError(lastErr) {
			break
		}
		if c.log != nil {
			c.log.Warn("ai request retrying",
				"attempt", attempt+1,
				"error", logger.TruncateError(lastErr, errMessageMaxRunes),
				"error_type", ClassifyError(lastErr),
			)
		}
	}
	if lastErr != nil {
		return nil, lastErr
	}
	if len(resp.Choices) == 0 {
		return nil, fmt.Errorf("empty response from AI model")
	}

	choice := resp.Choices[0]
	if choice.FinishReason == "length" {
		return nil, ErrTruncated
	}

	return &Response{
		Content:      choice.Message.Content,
		TokensIn:     resp.Usage.PromptTokens,
		TokensOut:    resp.Usage.CompletionTokens,
		Model:        resp.Model,
		FinishReason: choice.FinishReason,
	}, nil
}

func (b *openRouterBackend) webSearch(context.Context, call) (*Response, error) {
	return nil, ErrUnsupported
}

// validateKey runs a minimal completion on the fast model so a stored key is
// known to be live (not just well-formed) before we persist it.
func (b *openRouterBackend) validateKey(ctx context.Context, apiKey, model string) error {
	testCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	_, err := b.complete(testCtx, call{
		apiKey:    apiKey,
		model:     model,
		system:    "Respond with the single word: OK",
		messages:  []Message{{Role: RoleUser, Content: "OK"}},
		maxTokens: 16,
	})
	if err == ErrTruncated {
		// A truncated answer still proves the key works.
		return nil
	}
	return err
}

func (b *openRouterBackend) doRequest(ctx context.Context, apiKey string, body []byte) (*openRouterResponse, error) {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		b.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Content-Type", "application/json; charset=utf-8")
	httpReq.Header.Set("Accept", "application/json; charset=utf-8")
	httpReq.Header.Set("HTTP-Referer", "https://github.com/collinsadi/aethlara")
	httpReq.Header.Set("X-Title", "Aethlara")

	httpResp, err := b.http.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("http request: %w", err)
	}
	defer httpResp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(httpResp.Body, 4<<20))
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	respBody = sanitise.StripBOM(respBody)

	switch httpResp.StatusCode {
	case http.StatusTooManyRequests, http.StatusBadGateway, http.StatusServiceUnavailable:
		return nil, &retryableError{status: httpResp.StatusCode}
	}
	if httpResp.StatusCode >= 300 {
		return nil, &ProviderError{
			Provider: ProviderOpenRouter,
			Status:   httpResp.StatusCode,
			Message:  truncate(string(respBody), 200),
		}
	}

	var result openRouterResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	if result.Error != nil {
		return nil, &ProviderError{
			Provider: ProviderOpenRouter,
			Status:   result.Error.Code,
			Message:  truncate(result.Error.Message, 200),
		}
	}
	return &result, nil
}
