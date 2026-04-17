package ai

import (
	"bytes"
	"context"
	"encoding/json"
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

// APIKeyProvider retrieves a decrypted API key for a given user.
// Satisfied by settings.Service — defined here to avoid import cycles.
type APIKeyProvider interface {
	GetDecryptedKey(ctx context.Context, userID string) (string, error)
}

type Client struct {
	fallbackKey string       // used when UserID is empty (e.g. config-level key)
	keyProvider APIKeyProvider
	baseURL     string
	model       string
	http        *http.Client
}

type Request struct {
	UserID        string // set to trigger per-user key lookup
	SystemPrompt  string
	UserMessage   string
	PromptVersion string
}

type Response struct {
	Content   string
	TokensIn  int
	TokensOut int
	LatencyMS int64
}

type openRouterRequest struct {
	Model       string    `json:"model"`
	Messages    []message `json:"messages"`
	Temperature float64   `json:"temperature"`
}

type message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openRouterResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
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

func NewClient(fallbackKey, baseURL, model string) *Client {
	return &Client{
		fallbackKey: fallbackKey,
		baseURL:     baseURL,
		model:       model,
		http:        &http.Client{Timeout: defaultTimeout},
	}
}

// SetKeyProvider injects the per-user key provider after construction.
// Called from main after settings service is wired up.
func (c *Client) SetKeyProvider(p APIKeyProvider) {
	c.keyProvider = p
}

// Complete resolves the API key for the request's UserID (if set),
// then calls OpenRouter.  The decrypted key lives only in this stack frame.
func (c *Client) Complete(ctx context.Context, req Request) (*Response, error) {
	apiKey, err := c.resolveKey(ctx, req.UserID)
	if err != nil {
		return nil, fmt.Errorf("resolve API key: %w", err)
	}
	resp, err := c.execute(ctx, apiKey, req)
	apiKey = "" // zero from this scope
	return resp, err
}

// CompleteWithKey bypasses the key provider and uses the supplied key directly.
// Used only by settings.Service for liveness validation — the key never reaches the DB.
func (c *Client) CompleteWithKey(ctx context.Context, plainKey string, req Request) (*Response, error) {
	return c.execute(ctx, plainKey, req)
}

func (c *Client) resolveKey(ctx context.Context, userID string) (string, error) {
	if userID != "" && c.keyProvider != nil {
		return c.keyProvider.GetDecryptedKey(ctx, userID)
	}
	if c.fallbackKey != "" {
		return c.fallbackKey, nil
	}
	return "", fmt.Errorf("no API key available")
}

func (c *Client) execute(ctx context.Context, apiKey string, req Request) (*Response, error) {
	start := time.Now()

	payload := openRouterRequest{
		Model: c.model,
		Messages: []message{
			{Role: "system", Content: req.SystemPrompt},
			{Role: "user", Content: req.UserMessage},
		},
		Temperature: 0.1,
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
			"prompt_version", req.PromptVersion,
			"error", lastErr,
		)
	}

	if lastErr != nil {
		return nil, lastErr
	}

	latency := time.Since(start).Milliseconds()

	slog.Info("ai request completed",
		"model", c.model,
		"prompt_version", req.PromptVersion,
		"tokens_in", resp.Usage.PromptTokens,
		"tokens_out", resp.Usage.CompletionTokens,
		"latency_ms", latency,
	)

	if len(resp.Choices) == 0 || resp.Choices[0].Message.Content == "" {
		return nil, fmt.Errorf("empty response from AI model")
	}

	return &Response{
		Content:   resp.Choices[0].Message.Content,
		TokensIn:  resp.Usage.PromptTokens,
		TokensOut: resp.Usage.CompletionTokens,
		LatencyMS: latency,
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
	_, ok := err.(*retryableError)
	return ok
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
