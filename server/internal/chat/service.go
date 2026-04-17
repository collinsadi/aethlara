package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/collinsadi/aethlara/internal/ai"
	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/prompts"
)

// Token-budget constants. These are heuristic — OpenRouter returns actual
// usage in the response metadata which we persist for future accuracy.
const (
	// When `token_count` is unknown we estimate via char count / 4.
	charsPerToken = 4

	// History sliding-window budget (tokens). System prompt is pinned above
	// this budget; the model's actual context window must fit all three
	// (system + history + new user + response reservation).
	historyTokenBudget = 6000

	// Always retain at least N most recent messages even if the budget says
	// otherwise (keeps short-term context coherent).
	minRetainedMessages = 4

	// Maximum number of messages loaded from DB before walking the budget
	// backwards. This caps the DB read size.
	dbMessageLoadLimit = 50

	// Inbound user message limits.
	maxUserMessageChars = 4000
	minUserMessageChars = 1
)

// Service is the chat façade used by handlers.
type Service interface {
	CreateOrGetSession(ctx context.Context, userID, jobID string) (*SessionSummary, bool, error)
	ListSessions(ctx context.Context, userID string) ([]SessionSummary, error)
	GetMessages(ctx context.Context, userID, sessionID string, before *string, limit int) (*MessagePage, error)
	SendMessage(ctx context.Context, userID, sessionID, content string) (*MessageDTO, error)
	DeleteSession(ctx context.Context, userID, sessionID string) error
}

type service struct {
	repo Repository
	ai   *ai.Client
	cfg  *config.Config
}

func NewService(repo Repository, aiClient *ai.Client, cfg *config.Config) Service {
	return &service{repo: repo, ai: aiClient, cfg: cfg}
}

// ── Sessions ──────────────────────────────────────────────────────────────────

// CreateOrGetSession returns an existing session for the user+job pair, or
// creates one. The bool indicates whether a new session was created (201 vs 200).
func (s *service) CreateOrGetSession(ctx context.Context, userID, jobID string) (*SessionSummary, bool, error) {
	jobID = strings.TrimSpace(jobID)
	if jobID == "" {
		return nil, false, fmt.Errorf("%w: job_id is required", ErrInvalidInput)
	}

	// Ownership + readiness.
	jc, err := s.repo.GetJobContext(ctx, userID, jobID)
	if err != nil {
		slog.Error("chat: fetch job context failed", "user_id", userID, "job_id", jobID, "error", err)
		return nil, false, ErrInternal
	}
	if jc == nil {
		return nil, false, ErrJobNotFound
	}
	if jc.AlignmentStatus != "completed" {
		return nil, false, ErrJobNotReady
	}

	// Existing?
	existing, err := s.repo.GetSessionForUserJob(ctx, userID, jobID)
	if err != nil {
		return nil, false, ErrInternal
	}
	if existing != nil {
		summary, err := s.summarise(ctx, existing, jc)
		if err != nil {
			return nil, false, err
		}
		return summary, false, nil
	}

	created, err := s.repo.CreateSession(ctx, userID, jobID)
	if err != nil {
		slog.Error("chat: create session failed", "user_id", userID, "job_id", jobID, "error", err)
		return nil, false, ErrInternal
	}
	summary, err := s.summarise(ctx, created, jc)
	if err != nil {
		return nil, false, err
	}
	return summary, true, nil
}

func (s *service) ListSessions(ctx context.Context, userID string) ([]SessionSummary, error) {
	sessions, err := s.repo.ListSessions(ctx, userID)
	if err != nil {
		return nil, ErrInternal
	}
	if sessions == nil {
		sessions = []SessionSummary{}
	}
	return sessions, nil
}

func (s *service) DeleteSession(ctx context.Context, userID, sessionID string) error {
	if err := s.repo.SoftDeleteSession(ctx, sessionID, userID); err != nil {
		if errors.Is(err, errRowsAffectedZero()) {
			return ErrNotFound
		}
		// pgx.ErrNoRows from our repo means the session didn't match.
		// We can't import pgx here without introducing coupling; compare by message.
		if strings.Contains(err.Error(), "no rows") {
			return ErrNotFound
		}
		return ErrInternal
	}
	return nil
}

// errRowsAffectedZero is a placeholder to keep the errors.Is call above
// compiling cleanly. The actual pgx.ErrNoRows comparison happens via the
// error message above.
func errRowsAffectedZero() error { return errors.New("no rows") }

// ── Messages ──────────────────────────────────────────────────────────────────

func (s *service) GetMessages(
	ctx context.Context,
	userID, sessionID string,
	before *string,
	limit int,
) (*MessagePage, error) {
	sess, err := s.repo.GetSessionByID(ctx, sessionID, userID)
	if err != nil {
		return nil, ErrInternal
	}
	if sess == nil {
		return nil, ErrNotFound
	}

	msgs, hasMore, err := s.repo.GetMessagesPage(ctx, sessionID, before, limit)
	if err != nil {
		return nil, ErrInternal
	}

	page := &MessagePage{
		Messages: make([]MessageDTO, 0, len(msgs)),
		HasMore:  hasMore,
	}
	for _, m := range msgs {
		page.Messages = append(page.Messages, toDTO(m))
	}
	if len(msgs) > 0 {
		oldest := msgs[0].ID
		page.OldestMessageID = &oldest
	}
	return page, nil
}

func (s *service) SendMessage(ctx context.Context, userID, sessionID, content string) (*MessageDTO, error) {
	content = strings.TrimSpace(content)
	if len(content) < minUserMessageChars {
		return nil, fmt.Errorf("%w: message cannot be empty", ErrInvalidInput)
	}
	if len(content) > maxUserMessageChars {
		return nil, fmt.Errorf("%w: message must be %d characters or fewer", ErrInvalidInput, maxUserMessageChars)
	}

	sess, err := s.repo.GetSessionByID(ctx, sessionID, userID)
	if err != nil {
		return nil, ErrInternal
	}
	if sess == nil {
		return nil, ErrNotFound
	}

	jc, err := s.repo.GetJobContext(ctx, userID, sess.JobID)
	if err != nil {
		return nil, ErrInternal
	}
	if jc == nil {
		return nil, ErrJobNotFound
	}

	// 1. Persist user message FIRST — never lose a user utterance on AI failure.
	userTokens := estimateTokens(content)
	userMsg, err := s.repo.InsertMessage(ctx, Message{
		SessionID:  sessionID,
		UserID:     userID,
		Role:       RoleUser,
		Content:    content,
		TokenCount: &userTokens,
	})
	if err != nil {
		slog.Error("chat: persist user message failed", "session_id", sessionID, "error", err)
		return nil, ErrInternal
	}

	// 2. Assemble system prompt + sliding-window history.
	systemPrompt, err := buildSystemPrompt(jc)
	if err != nil {
		slog.Error("chat: context assembly failed", "session_id", sessionID, "error", err)
		return nil, ErrContextAssembly
	}

	history, err := s.repo.GetRecentMessages(ctx, sessionID, dbMessageLoadLimit)
	if err != nil {
		slog.Warn("chat: history load failed, proceeding with new message only", "session_id", sessionID)
		history = []Message{*userMsg}
	}
	windowed := applySlidingWindow(history, historyTokenBudget)
	aiMessages := toAIMessages(windowed)

	// 3. Call OpenRouter with user's own key.
	aiCtx, cancel := context.WithTimeout(ctx, time.Duration(s.cfg.JobAITimeoutSeconds)*time.Second)
	defer cancel()

	aiResp, aiErr := s.ai.Chat(aiCtx, ai.ChatRequest{
		UserID:        userID,
		SystemPrompt:  systemPrompt,
		Messages:      aiMessages,
		PromptVersion: prompts.JobChatV1,
	})

	if aiErr != nil {
		// Persist the error as an assistant message so UI retry has a reference.
		errNote := sanitiseAIError(aiErr)
		_, _ = s.repo.InsertMessage(ctx, Message{
			SessionID:     sessionID,
			UserID:        userID,
			Role:          RoleAssistant,
			Content:       errNote,
			IsError:       true,
			PromptVersion: stringPtr(prompts.JobChatV1),
		})

		if errors.Is(aiErr, ai.ErrNoAPIKey) {
			return nil, ai.ErrNoAPIKey
		}
		if errors.Is(aiErr, context.DeadlineExceeded) {
			return nil, fmt.Errorf("%w: model timed out", ErrAIUnavailable)
		}
		return nil, fmt.Errorf("%w: %s", ErrAIUnavailable, aiErr)
	}

	// 4. Persist assistant response.
	assistantTokens := aiResp.TokensOut
	model := aiResp.Model
	promptVer := prompts.JobChatV1
	meta := MessageMetadata{
		TokensUsed:   aiResp.TokensIn + aiResp.TokensOut,
		TokensIn:     aiResp.TokensIn,
		TokensOut:    aiResp.TokensOut,
		FinishReason: aiResp.FinishReason,
		LatencyMS:    aiResp.LatencyMS,
	}
	metaBytes, _ := json.Marshal(meta)

	assistantMsg, err := s.repo.InsertMessage(ctx, Message{
		SessionID:     sessionID,
		UserID:        userID,
		Role:          RoleAssistant,
		Content:       aiResp.Content,
		TokenCount:    &assistantTokens,
		ModelUsed:     &model,
		PromptVersion: &promptVer,
		Metadata:      metaBytes,
	})
	if err != nil {
		slog.Error("chat: persist assistant message failed", "session_id", sessionID, "error", err)
		return nil, ErrInternal
	}

	_ = s.repo.TouchSession(ctx, sessionID)

	dto := toDTO(*assistantMsg)
	return &dto, nil
}

// ── helpers ───────────────────────────────────────────────────────────────────

func (s *service) summarise(ctx context.Context, sess *Session, jc *JobContext) (*SessionSummary, error) {
	count, err := s.repo.CountMessages(ctx, sess.ID)
	if err != nil {
		return nil, ErrInternal
	}
	return &SessionSummary{
		ID:           sess.ID,
		JobID:        sess.JobID,
		JobTitle:     jc.JobTitle,
		Company:      jc.Company,
		MatchScore:   jc.MatchScore,
		MessageCount: count,
		CreatedAt:    sess.CreatedAt,
	}, nil
}

func toDTO(m Message) MessageDTO {
	dto := MessageDTO{
		ID:        m.ID,
		Role:      m.Role,
		Content:   m.Content,
		ModelUsed: m.ModelUsed,
		IsError:   m.IsError,
		CreatedAt: m.CreatedAt,
	}
	if len(m.Metadata) > 0 {
		var meta map[string]any
		if err := json.Unmarshal(m.Metadata, &meta); err == nil {
			dto.Metadata = meta
		}
	}
	return dto
}

func toAIMessages(msgs []Message) []ai.Message {
	out := make([]ai.Message, 0, len(msgs))
	for _, m := range msgs {
		// Skip error markers — they would confuse the model.
		if m.IsError {
			continue
		}
		if m.Role == RoleSystem {
			continue
		}
		out = append(out, ai.Message{Role: m.Role, Content: m.Content})
	}
	return out
}

// applySlidingWindow walks the history backwards from the most recent message,
// accumulating token counts. Messages that fit within the budget are kept.
// At least `minRetainedMessages` are always kept regardless of budget.
func applySlidingWindow(history []Message, budget int) []Message {
	if len(history) == 0 {
		return history
	}

	// history is oldest → newest. Walk from the end.
	total := 0
	startIdx := len(history) // slice will be history[startIdx:]
	for i := len(history) - 1; i >= 0; i-- {
		t := tokenCount(history[i])
		if total+t > budget && (len(history)-i) > minRetainedMessages {
			break
		}
		total += t
		startIdx = i
	}
	if startIdx < len(history) && len(history)-startIdx < minRetainedMessages {
		startIdx = len(history) - minRetainedMessages
		if startIdx < 0 {
			startIdx = 0
		}
	}

	dropped := startIdx
	if dropped > 0 {
		slog.Info("chat: sliding window truncated history",
			"total_messages", len(history),
			"kept", len(history)-startIdx,
			"dropped", dropped,
		)
	}
	return history[startIdx:]
}

func tokenCount(m Message) int {
	if m.TokenCount != nil && *m.TokenCount > 0 {
		return *m.TokenCount
	}
	return estimateTokens(m.Content)
}

func estimateTokens(s string) int {
	if s == "" {
		return 0
	}
	n := len(s) / charsPerToken
	if n < 1 {
		return 1
	}
	return n
}

func sanitiseAIError(err error) string {
	// Never surface decrypted key material or internal URLs. The ai.Client
	// already redacts API keys from its error strings.
	_ = err
	return "The assistant couldn't respond to that message. Please try again in a moment."
}

func stringPtr(s string) *string { return &s }
