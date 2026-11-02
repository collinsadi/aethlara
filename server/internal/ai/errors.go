package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

var (
	// ErrNoAPIKey is the typed sentinel returned whenever a user has no valid
	// key for their active provider. Handlers must translate this to 403
	// API_KEY_REQUIRED.
	ErrNoAPIKey = errors.New("no valid AI provider API key on file")

	// ErrUnsupported is returned when the user's active provider cannot run
	// the requested operation (e.g. web search on OpenRouter).
	ErrUnsupported = errors.New("operation not supported by the active AI provider")

	// ErrRefused is returned when the model declines the request
	// (stop_reason "refusal").
	ErrRefused = errors.New("model declined the request")

	// ErrTruncated is returned when the response hit max_tokens before the
	// model finished, so the content cannot be trusted as complete.
	ErrTruncated = errors.New("model output was truncated")
)

// ProviderError is a non-2xx response from an AI provider.
type ProviderError struct {
	Provider Provider
	Status   int
	Type     string // provider error type when known, e.g. "rate_limit_error"
	Message  string // already truncated; never contains prompt content we sent
}

func (e *ProviderError) Error() string {
	msg := e.Message
	if msg == "" {
		msg = e.Type
	}
	return fmt.Sprintf("%s error: HTTP %d: %s", e.Provider, e.Status, msg)
}

// retryableError marks transient OpenRouter failures for the retry loop.
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

// ClassifyError returns a stable, low-cardinality label describing the
// category of an AI-layer error. The label is safe to emit as a log field
// and to aggregate on dashboards.
//
// Labels:
//   - context_canceled — upstream request context was cancelled
//   - timeout          — context.DeadlineExceeded or similar deadline breach
//   - no_api_key       — user has no usable key
//   - unsupported      — operation not available on the active provider
//   - ai_refused       — model declined the request
//   - ai_truncated     — output hit max_tokens
//   - ai_auth_error    — 401/403 from the provider (bad/expired key)
//   - ai_billing_error — 402 from the provider (out of credits)
//   - ai_rate_limited  — 429 from the provider
//   - ai_overloaded    — 529 from the provider
//   - ai_server_error  — 5xx from the provider
//   - ai_bad_request   — 400/404/422 (bad model id, invalid params)
//   - ai_unknown_error — anything else
func ClassifyError(err error) string {
	if err == nil {
		return ""
	}
	switch {
	case errors.Is(err, context.Canceled):
		return "context_canceled"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case errors.Is(err, ErrNoAPIKey):
		return "no_api_key"
	case errors.Is(err, ErrUnsupported):
		return "unsupported"
	case errors.Is(err, ErrRefused):
		return "ai_refused"
	case errors.Is(err, ErrTruncated):
		return "ai_truncated"
	}

	var pe *ProviderError
	if errors.As(err, &pe) {
		return classifyStatus(pe.Status)
	}
	var re *retryableError
	if errors.As(err, &re) {
		return classifyStatus(re.status)
	}

	msg := err.Error()
	switch {
	case strings.Contains(msg, "HTTP 401"), strings.Contains(msg, "API error 401"):
		return "ai_auth_error"
	case strings.Contains(msg, "HTTP 429"), strings.Contains(msg, "API error 429"):
		return "ai_rate_limited"
	case strings.Contains(msg, "HTTP 500"), strings.Contains(msg, "HTTP 502"),
		strings.Contains(msg, "HTTP 503"), strings.Contains(msg, "HTTP 504"):
		return "ai_server_error"
	default:
		return "ai_unknown_error"
	}
}

func classifyStatus(status int) string {
	switch {
	case status == 401 || status == 403:
		return "ai_auth_error"
	case status == 402:
		return "ai_billing_error"
	case status == 429:
		return "ai_rate_limited"
	case status == 529:
		return "ai_overloaded"
	case status >= 500:
		return "ai_server_error"
	case status == 400 || status == 404 || status == 422:
		return "ai_bad_request"
	default:
		return "ai_unknown_error"
	}
}

// IsAuthError reports whether err means the provider rejected the user's key.
func IsAuthError(err error) bool {
	return ClassifyError(err) == "ai_auth_error"
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
