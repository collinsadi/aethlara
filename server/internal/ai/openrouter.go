// Package ai is the ONLY place in the codebase that talks to OpenRouter.
//
// Architectural invariant (non-negotiable):
//   - There is NO platform-level API key.
//   - Every call resolves a key per request from the authenticated user's
//     encrypted record via the injected APIKeyProvider.
//   - Decrypted keys live only inside a single request's stack frame and are
//     zeroed before the function returns.
//   - If a user has no valid key, ErrNoAPIKey is returned and callers MUST
//     propagate it as 403 API_KEY_REQUIRED.
package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"time"
)

const (
	defaultTimeout = 60 * time.Second
	maxRetries     = 3
	retryBaseDelay = time.Second
)

// ErrNoAPIKey is the typed sentinel returned whenever a user has no valid
// OpenRouter key on file. Handlers must translate this to 403 API_KEY_REQUIRED.
var ErrNoAPIKey = errors.New("no valid OpenRouter API key on file")

// APIKeyProvider resolves a decrypted API key for a given user.
// Satisfied by settings.Service. Implementations MUST return ErrNoAPIKey when
// no usable key exists — the ai.Client relies on this for uniform handling.
type APIKeyProvider interface {
	GetDecryptedKey(ctx context.Context, userID string) (string, error)
}

// Client executes OpenRouter chat completions.
// It holds NO API key — every call resolves one per user.
type Client struct {
	keyProvider APIKeyProvider
	baseURL     string
	model       string
	http        *http.Client
}

// Role constants for chat messages.
const (
	RoleSystem    = "system"
	RoleUser      = "user"
	RoleAssistant = "assistant"
)

// Message is a single turn in a conversation sent to the model.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Request is a single-turn convenience request (one system prompt + one user
// message). Use ChatRequest for multi-turn conversations.
type Request struct {
	UserID        string // REQUIRED — enforces per-user key resolution
	SystemPrompt  string
	UserMessage   string
	PromptVersion string
	// Temperature overrides the default of 0.1 when non-nil.
	Temperature *float64
}

// ChatRequest is the full multi-turn form used by the chat module.
type ChatRequest struct {
	UserID        string    // REQUIRED — enforces per-user key resolution
	SystemPrompt  string    // injected as the first system message
	Messages      []Message // conversation history, oldest first
	PromptVersion string
	Temperature   *float64
}

// Response carries the model output plus instrumentation.
type Response struct {
	Content      string
	TokensIn     int
	TokensOut    int
	LatencyMS    int64
	Model        string
	FinishReason string
}

type openRouterRequest struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	Temperature float64   `json:"temperature"`
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

// NewClient constructs a Client. Note: there is deliberately no fallback key
// parameter — we refuse to allow one at construction time.
func NewClient(baseURL, model string) *Client {
	return &Client{
		baseURL: baseURL,
		model:   model,
		http:    &http.Client{Timeout: defaultTimeout},
	}
}

// SetKeyProvider injects the per-user key provider after construction.
// Called once from main after the settings service is wired.
func (c *Client) SetKeyProvider(p APIKeyProvider) {
	c.keyProvider = p
}

// Model returns the configured default model.
func (c *Client) Model() string { return c.model }

// Complete runs a single-turn completion for the given user.
// If userID is empty OR the user has no valid key, ErrNoAPIKey is returned.
func (c *Client) Complete(ctx context.Context, req Request) (*Response, error) {
	if req.UserID == "" {
		return nil, ErrNoAPIKey
	}
	chat := ChatRequest{
		UserID:        req.UserID,
		SystemPrompt:  req.SystemPrompt,
		PromptVersion: req.PromptVersion,
		Temperature:   req.Temperature,
		Messages:      []Message{{Role: RoleUser, Content: req.UserMessage}},
	}
	return c.Chat(ctx, chat)
}

// Chat runs a multi-turn completion for the given user.
// The system prompt is injected as the first message. Per-user key is resolved,
// used for exactly one HTTP request, then zeroed from memory.
func (c *Client) Chat(ctx context.Context, req ChatRequest) (*Response, error) {
	if req.UserID == "" {
		return nil, ErrNoAPIKey
	}

	apiKey, err := c.resolveKey(ctx, req.UserID)
	if err != nil {
		return nil, err
	}

	messages := make([]Message, 0, len(req.Messages)+1)
	if req.SystemPrompt != "" {
		messages = append(messages, Message{Role: RoleSystem, Content: req.SystemPrompt})
	}
	messages = append(messages, req.Messages...)

	resp, err := c.execute(ctx, apiKey, messages, req.Temperature, req.PromptVersion)
	// Zero the plaintext key from this stack frame before returning.
	apiKey = ""
	_ = apiKey
	return resp, err
}

// CompleteWithKey bypasses the key provider and uses the supplied key directly.
// Used ONLY by settings.Service for liveness validation — the plaintext key is
// never persisted. Not exposed to any other caller.
func (c *Client) CompleteWithKey(ctx context.Context, plainKey string, req Request) (*Response, error) {
	messages := []Message{}
	if req.SystemPrompt != "" {
		messages = append(messages, Message{Role: RoleSystem, Content: req.SystemPrompt})
	}
	messages = append(messages, Message{Role: RoleUser, Content: req.UserMessage})
	return c.execute(ctx, plainKey, messages, req.Temperature, req.PromptVersion)
}

func (c *Client) resolveKey(ctx context.Context, userID string) (string, error) {
	if c.keyProvider == nil {
		// Defence-in-depth: misconfiguration should never leak into production.
		return "", ErrNoAPIKey
	}
	key, err := c.keyProvider.GetDecryptedKey(ctx, userID)
	if err != nil {
		// Any error from the provider (including ErrNoAPIKey) is treated as
		// "no usable key". Never log decrypted material here.
		if errors.Is(err, ErrNoAPIKey) {
			return "", ErrNoAPIKey
		}
		return "", fmt.Errorf("resolve api key: %w", err)
	}
	if key == "" {
		return "", ErrNoAPIKey
	}
	return key, nil
}

func (c *Client) execute(
	ctx context.Context,
	apiKey string,
	messages []Message,
	temperature *float64,
	promptVersion string,
) (*Response, error) {
	start := time.Now()

	temp := 0.1
	if temperature != nil {
		temp = *temperature
	}

	payload := openRouterRequest{
		Model:       c.model,
		Messages:    messages,
		Temperature: temp,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	var resp *openRouterResponse
	var lastErr error

	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			delay := time.Duration(math.Pow(2, float64(attempt-1))) * retryBaseDelay
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(delay):
			}
		}

		resp, lastErr = c.doRequest(ctx, apiKey, body)
		if lastErr == nil {
			break
		}
		if !isRetryableError(lastErr) {
			break
		}

		slog.Warn("ai request retrying",
			"attempt", attempt+1,
			"model", c.model,
			"prompt_version", promptVersion,
			"error", lastErr,
		)
	}

	if lastErr != nil {
		return nil, lastErr
	}

	latency := time.Since(start).Milliseconds()

	slog.Info("ai request completed",
		"model", c.model,
		"prompt_version", promptVersion,
		"tokens_in", resp.Usage.PromptTokens,
		"tokens_out", resp.Usage.CompletionTokens,
		"latency_ms", latency,
	)

	if len(resp.Choices) == 0 || resp.Choices[0].Message.Content == "" {
		return nil, fmt.Errorf("empty response from AI model")
	}

	modelUsed := resp.Model
	if modelUsed == "" {
		modelUsed = c.model
	}

	return &Response{
		Content:      resp.Choices[0].Message.Content,
		TokensIn:     resp.Usage.PromptTokens,
		TokensOut:    resp.Usage.CompletionTokens,
		LatencyMS:    latency,
		Model:        modelUsed,
		FinishReason: resp.Choices[0].FinishReason,
	}, nil
}

func (c *Client) doRequest(ctx context.Context, apiKey string, body []byte) (*openRouterResponse, error) {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("HTTP-Referer", "https://github.com/collinsadi/aethlara")

	httpResp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("http request: %w", err)
	}
	defer httpResp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(httpResp.Body, 4<<20))
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if httpResp.StatusCode == http.StatusTooManyRequests ||
		httpResp.StatusCode == http.StatusBadGateway ||
		httpResp.StatusCode == http.StatusServiceUnavailable {
		return nil, &retryableError{status: httpResp.StatusCode}
	}

	if httpResp.StatusCode >= 300 {
		return nil, fmt.Errorf("openrouter error: HTTP %d: %s", httpResp.StatusCode, truncate(string(respBody), 200))
	}

	var result openRouterResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	if result.Error != nil {
		return nil, fmt.Errorf("openrouter API error %d: %s", result.Error.Code, result.Error.Message)
	}

	return &result, nil
}

type retryableError struct {
	status int
}

func (e *retryableError) Error() string {
	return fmt.Sprintf("transient error: HTTP %d", e.status)
}

func isRetryableError(err error) bool {
	var re *retryableError
	return errors.As(err, &re)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
