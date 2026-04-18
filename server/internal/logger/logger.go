// Package logger provides a structured slog logger with request-scoped
// context propagation and defence-in-depth redaction of sensitive fields.
//
// Security invariants:
//   - Known sensitive field names (email, password, api_key, token, secret,
//     resume_text, job_text, otp, etc.) are always replaced with "[REDACTED]"
//     by ReplaceAttr, even if a caller forgets and passes them through.
//   - Error messages are expected to be sanitised by the caller; this package
//     provides TruncateError as a last-line-of-defence helper.
//   - Request bodies, response bodies, Authorization headers, and URL query
//     strings MUST NEVER be logged — this is enforced by code review and
//     policy, not by this package.
package logger

import (
	"context"
	"log/slog"
	"os"
	"strings"
)

// contextKey is an unexported type used to stash scoped values on
// context.Context without colliding with other packages.
type contextKey string

const (
	// RequestIDKey is the context key under which the per-request trace ID
	// is stored by the RequestID middleware.
	RequestIDKey contextKey = "request_id"

	// UserIDKey is the context key under which the authenticated user's UUID
	// is stored by the RequireAuth middleware.
	UserIDKey contextKey = "user_id"
)

// forbiddenFields lists attribute keys that must never survive into a log
// sink. If a caller accidentally passes one of these, ReplaceAttr rewrites
// the value to "[REDACTED]" regardless of level or handler.
var forbiddenFields = map[string]struct{}{
	"email":         {},
	"password":      {},
	"api_key":       {},
	"apikey":        {},
	"token":         {},
	"access_token":  {},
	"refresh_token": {},
	"secret":        {},
	"resume_text":   {},
	"job_text":      {},
	"page_text":     {},
	"raw_content":   {},
	"full_name":     {},
	"phone":         {},
	"otp":           {},
	"otp_hash":      {},
	"authorization": {},
}

// New returns a JSON-formatted structured logger suitable for production.
// In development, level is lowered to Debug.
func New(env string) *slog.Logger {
	level := slog.LevelInfo
	if env != "production" {
		level = slog.LevelDebug
	}

	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level:       level,
		ReplaceAttr: redactAttr,
	})
	return slog.New(handler)
}

// redactAttr is invoked for every attribute written by the handler and
// rewrites any forbidden key to a safe placeholder. It preserves structure
// so grepping for "[REDACTED]" surfaces accidental leaks during review.
func redactAttr(groups []string, a slog.Attr) slog.Attr {
	if _, forbidden := forbiddenFields[strings.ToLower(a.Key)]; forbidden {
		return slog.String(a.Key, "[REDACTED]")
	}
	return a
}

// FromContext returns slog.Default() enriched with any request-scoped
// identifiers found on ctx. It never returns nil.
//
// This is the canonical way for services and handlers to emit logs: pass
// ctx through and every log entry automatically carries request_id and
// user_id without the caller having to remember.
func FromContext(ctx context.Context) *slog.Logger {
	return With(slog.Default(), ctx)
}

// With returns a derived logger carrying request_id and user_id (when
// present on ctx). Prefer FromContext unless you need a non-default base.
func With(l *slog.Logger, ctx context.Context) *slog.Logger {
	if l == nil {
		l = slog.Default()
	}
	if ctx == nil {
		return l
	}
	args := make([]any, 0, 4)
	if rid, ok := ctx.Value(RequestIDKey).(string); ok && rid != "" {
		args = append(args, "request_id", rid)
	}
	if uid, ok := ctx.Value(UserIDKey).(string); ok && uid != "" {
		args = append(args, "user_id", uid)
	}
	if len(args) == 0 {
		return l
	}
	return l.With(args...)
}

// RequestIDFromContext extracts the request trace ID from ctx, or "" if
// none is set.
func RequestIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	v, _ := ctx.Value(RequestIDKey).(string)
	return v
}

// UserIDFromContext extracts the authenticated user's UUID from ctx, or
// "" if the request is unauthenticated.
func UserIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	v, _ := ctx.Value(UserIDKey).(string)
	return v
}

// TruncateError clamps an error's message to at most n runes. AI providers
// sometimes echo portions of the prompt back in errors, so this is the last
// line of defence before the string hits the log sink.
func TruncateError(err error, n int) string {
	if err == nil {
		return ""
	}
	return Truncate(err.Error(), n)
}

// Truncate clamps s to at most n runes and appends an ellipsis marker when
// truncation occurs.
func Truncate(s string, n int) string {
	if n <= 0 {
		return ""
	}
	if len(s) <= n {
		return s
	}
	return s[:n] + "…[truncated]"
}
