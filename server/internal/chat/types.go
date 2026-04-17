package chat

import (
	"errors"
	"time"
)

// Sentinel errors returned by Service. Handlers map these to HTTP responses.
var (
	ErrNotFound        = errors.New("chat session not found")
	ErrForbidden       = errors.New("access denied")
	ErrInvalidInput    = errors.New("invalid input")
	ErrJobNotReady     = errors.New("job alignment is not complete")
	ErrJobNotFound     = errors.New("job not found")
	ErrRateLimited     = errors.New("rate limit exceeded")
	ErrContextAssembly = errors.New("failed to assemble chat context")
	ErrAIUnavailable   = errors.New("ai model unavailable")
	ErrInternal        = errors.New("internal error")
)

// Role constants used in DB + API. Values match chat_messages.role CHECK.
const (
	RoleUser      = "user"
	RoleAssistant = "assistant"
	RoleSystem    = "system"
)

// Session is the DB representation of chat_sessions.
type Session struct {
	ID        string
	UserID    string
	JobID     string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// SessionSummary is the client-facing representation of a session, enriched
// with minimal job context for the UI.
type SessionSummary struct {
	ID            string     `json:"id"`
	JobID         string     `json:"job_id"`
	JobTitle      string     `json:"job_title"`
	Company       string     `json:"company"`
	MatchScore    *int       `json:"match_score"`
	MessageCount  int        `json:"message_count"`
	LastMessageAt *time.Time `json:"last_message_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

// Message is the DB representation of chat_messages.
type Message struct {
	ID            string
	SessionID     string
	UserID        string
	Role          string
	Content       string
	TokenCount    *int
	ModelUsed     *string
	PromptVersion *string
	IsError       bool
	Metadata      []byte // raw JSON bytes
	CreatedAt     time.Time
}

// MessageDTO is the client-facing message shape. System messages are never
// included in any response and this DTO has no `role='system'` path.
type MessageDTO struct {
	ID        string         `json:"id"`
	Role      string         `json:"role"`
	Content   string         `json:"content"`
	ModelUsed *string        `json:"model_used,omitempty"`
	IsError   bool           `json:"is_error,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

// MessagePage is a cursor-paginated window of messages (oldest-first).
type MessagePage struct {
	Messages        []MessageDTO `json:"messages"`
	HasMore         bool         `json:"has_more"`
	OldestMessageID *string      `json:"oldest_message_id,omitempty"`
}

// CreateSessionRequest is the inbound body for POST /chat/sessions.
type CreateSessionRequest struct {
	JobID string
}

// SendMessageRequest is the inbound body for POST /chat/sessions/:id/messages.
type SendMessageRequest struct {
	Content string
}

// MessageMetadata is persisted into chat_messages.metadata as JSON.
type MessageMetadata struct {
	TokensUsed   int    `json:"tokens_used,omitempty"`
	TokensIn     int    `json:"tokens_in,omitempty"`
	TokensOut    int    `json:"tokens_out,omitempty"`
	FinishReason string `json:"finish_reason,omitempty"`
	LatencyMS    int64  `json:"latency_ms,omitempty"`
}
