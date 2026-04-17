package chat

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// JobContext is the minimal slice of a job needed to assemble a chat prompt.
// It intentionally excludes the raw JSONB blobs — the service decodes them.
type JobContext struct {
	JobID              string
	UserID             string
	ResumeID           string
	JobTitle           string
	Company            string
	AlignmentStatus    string
	MatchScore         *int
	ExtractedJobJSON   *string // raw JSONB as text, nil if absent
	TailoredResumeJSON *string
	ResumeExtractedJSON *string
}

type Repository interface {
	// Sessions
	CreateSession(ctx context.Context, userID, jobID string) (*Session, error)
	GetSessionForUserJob(ctx context.Context, userID, jobID string) (*Session, error)
	GetSessionByID(ctx context.Context, id, userID string) (*Session, error)
	ListSessions(ctx context.Context, userID string) ([]SessionSummary, error)
	SoftDeleteSession(ctx context.Context, id, userID string) error
	TouchSession(ctx context.Context, id string) error

	// Messages
	InsertMessage(ctx context.Context, m Message) (*Message, error)
	GetRecentMessages(ctx context.Context, sessionID string, limit int) ([]Message, error)
	GetMessagesPage(ctx context.Context, sessionID string, before *string, limit int) ([]Message, bool, error)
	CountMessages(ctx context.Context, sessionID string) (int, error)

	// Context for prompt assembly (reads jobs + resumes rows scoped to userID)
	GetJobContext(ctx context.Context, userID, jobID string) (*JobContext, error)
}

type pgxRepository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) Repository {
	return &pgxRepository{db: db}
}

// ── Sessions ──────────────────────────────────────────────────────────────────

func (r *pgxRepository) CreateSession(ctx context.Context, userID, jobID string) (*Session, error) {
	var s Session
	err := r.db.QueryRow(ctx, `
		INSERT INTO chat_sessions (user_id, job_id)
		VALUES ($1, $2)
		RETURNING id, user_id, job_id, created_at, updated_at
	`, userID, jobID).Scan(&s.ID, &s.UserID, &s.JobID, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		return nil, err
	}
	// Mirror the session pointer on the job row — best effort.
	_, _ = r.db.Exec(ctx, `UPDATE jobs SET chat_session_id = $1 WHERE id = $2`, s.ID, jobID)
	return &s, nil
}

func (r *pgxRepository) GetSessionForUserJob(ctx context.Context, userID, jobID string) (*Session, error) {
	var s Session
	err := r.db.QueryRow(ctx, `
		SELECT id, user_id, job_id, created_at, updated_at
		FROM chat_sessions
		WHERE user_id = $1 AND job_id = $2 AND deleted_at IS NULL
	`, userID, jobID).Scan(&s.ID, &s.UserID, &s.JobID, &s.CreatedAt, &s.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (r *pgxRepository) GetSessionByID(ctx context.Context, id, userID string) (*Session, error) {
	var s Session
	err := r.db.QueryRow(ctx, `
		SELECT id, user_id, job_id, created_at, updated_at
		FROM chat_sessions
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
	`, id, userID).Scan(&s.ID, &s.UserID, &s.JobID, &s.CreatedAt, &s.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (r *pgxRepository) ListSessions(ctx context.Context, userID string) ([]SessionSummary, error) {
	rows, err := r.db.Query(ctx, `
		SELECT
		  s.id, s.job_id,
		  j.job_title, j.company, j.match_score,
		  COALESCE((SELECT COUNT(*) FROM chat_messages m
		              WHERE m.session_id = s.id
		                AND m.deleted_at IS NULL
		                AND m.role <> 'system'), 0) AS message_count,
		  (SELECT MAX(created_at) FROM chat_messages m
		     WHERE m.session_id = s.id
		       AND m.deleted_at IS NULL
		       AND m.role <> 'system') AS last_message_at,
		  s.created_at
		FROM chat_sessions s
		JOIN jobs j ON j.id = s.job_id AND j.deleted_at IS NULL
		WHERE s.user_id = $1 AND s.deleted_at IS NULL
		ORDER BY COALESCE(
		  (SELECT MAX(created_at) FROM chat_messages m
		     WHERE m.session_id = s.id AND m.deleted_at IS NULL),
		  s.created_at
		) DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []SessionSummary
	for rows.Next() {
		var (
			summary SessionSummary
			score   *int
			last    *time.Time
		)
		if err := rows.Scan(
			&summary.ID, &summary.JobID,
			&summary.JobTitle, &summary.Company, &score,
			&summary.MessageCount, &last, &summary.CreatedAt,
		); err != nil {
			return nil, err
		}
		summary.MatchScore = score
		summary.LastMessageAt = last
		out = append(out, summary)
	}
	return out, rows.Err()
}

func (r *pgxRepository) SoftDeleteSession(ctx context.Context, id, userID string) error {
	tag, err := r.db.Exec(ctx, `
		UPDATE chat_sessions
		SET deleted_at = NOW(), updated_at = NOW()
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
	`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	// Soft-cascade messages.
	_, _ = r.db.Exec(ctx, `
		UPDATE chat_messages SET deleted_at = NOW()
		WHERE session_id = $1 AND deleted_at IS NULL
	`, id)
	// Clear the pointer on the job row — best effort.
	_, _ = r.db.Exec(ctx, `UPDATE jobs SET chat_session_id = NULL WHERE chat_session_id = $1`, id)
	return nil
}

func (r *pgxRepository) TouchSession(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1`, id)
	return err
}

// ── Messages ──────────────────────────────────────────────────────────────────

const messageCols = `id, session_id, user_id, role, content, token_count, model_used, prompt_version, is_error, metadata, created_at`

func scanMessage(row pgx.Row) (*Message, error) {
	var m Message
	err := row.Scan(
		&m.ID, &m.SessionID, &m.UserID, &m.Role, &m.Content,
		&m.TokenCount, &m.ModelUsed, &m.PromptVersion, &m.IsError,
		&m.Metadata, &m.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &m, err
}

func (r *pgxRepository) InsertMessage(ctx context.Context, m Message) (*Message, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO chat_messages
		  (session_id, user_id, role, content, token_count, model_used, prompt_version, is_error, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING `+messageCols,
		m.SessionID, m.UserID, m.Role, m.Content,
		m.TokenCount, m.ModelUsed, m.PromptVersion, m.IsError, m.Metadata,
	)
	return scanMessage(row)
}

// GetRecentMessages returns up to `limit` non-deleted, non-system messages for a
// session, ordered oldest → newest.
func (r *pgxRepository) GetRecentMessages(ctx context.Context, sessionID string, limit int) ([]Message, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := r.db.Query(ctx, `
		SELECT `+messageCols+`
		FROM (
		  SELECT `+messageCols+`
		  FROM chat_messages
		  WHERE session_id = $1
		    AND deleted_at IS NULL
		    AND role <> 'system'
		  ORDER BY created_at DESC
		  LIMIT $2
		) t
		ORDER BY created_at ASC
	`, sessionID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Message
	for rows.Next() {
		var m Message
		if err := rows.Scan(
			&m.ID, &m.SessionID, &m.UserID, &m.Role, &m.Content,
			&m.TokenCount, &m.ModelUsed, &m.PromptVersion, &m.IsError,
			&m.Metadata, &m.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// GetMessagesPage returns a cursor-paginated window of messages (oldest-first
// for rendering). `before` is the oldest currently-loaded message ID — we load
// messages created strictly before it. When `before` is nil, returns the most
// recent page.
func (r *pgxRepository) GetMessagesPage(
	ctx context.Context,
	sessionID string,
	before *string,
	limit int,
) ([]Message, bool, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	var (
		rows pgx.Rows
		err  error
	)
	// Fetch one extra to detect has_more.
	query := `
		SELECT ` + messageCols + `
		FROM chat_messages
		WHERE session_id = $1
		  AND deleted_at IS NULL
		  AND role <> 'system'`

	if before != nil {
		query += `
		  AND created_at < (SELECT created_at FROM chat_messages WHERE id = $3)`
		query += `
		ORDER BY created_at DESC
		LIMIT $2`
		rows, err = r.db.Query(ctx, query, sessionID, limit+1, *before)
	} else {
		query += `
		ORDER BY created_at DESC
		LIMIT $2`
		rows, err = r.db.Query(ctx, query, sessionID, limit+1)
	}
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()

	var descending []Message
	for rows.Next() {
		var m Message
		if err := rows.Scan(
			&m.ID, &m.SessionID, &m.UserID, &m.Role, &m.Content,
			&m.TokenCount, &m.ModelUsed, &m.PromptVersion, &m.IsError,
			&m.Metadata, &m.CreatedAt,
		); err != nil {
			return nil, false, err
		}
		descending = append(descending, m)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}

	hasMore := len(descending) > limit
	if hasMore {
		descending = descending[:limit]
	}
	// Reverse to ascending order (oldest first).
	ascending := make([]Message, len(descending))
	for i, m := range descending {
		ascending[len(descending)-1-i] = m
	}
	return ascending, hasMore, nil
}

func (r *pgxRepository) CountMessages(ctx context.Context, sessionID string) (int, error) {
	var n int
	err := r.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM chat_messages
		WHERE session_id = $1 AND deleted_at IS NULL AND role <> 'system'
	`, sessionID).Scan(&n)
	return n, err
}

// ── Job context ───────────────────────────────────────────────────────────────

func (r *pgxRepository) GetJobContext(ctx context.Context, userID, jobID string) (*JobContext, error) {
	var jc JobContext
	err := r.db.QueryRow(ctx, `
		SELECT
		  j.id, j.user_id, j.resume_id,
		  j.job_title, j.company, j.alignment_status, j.match_score,
		  j.extracted_job_json::text, j.tailored_resume_json::text,
		  r.extracted_json::text
		FROM jobs j
		LEFT JOIN resumes r ON r.id = j.resume_id AND r.deleted_at IS NULL
		WHERE j.id = $1 AND j.user_id = $2 AND j.deleted_at IS NULL
	`, jobID, userID).Scan(
		&jc.JobID, &jc.UserID, &jc.ResumeID,
		&jc.JobTitle, &jc.Company, &jc.AlignmentStatus, &jc.MatchScore,
		&jc.ExtractedJobJSON, &jc.TailoredResumeJSON, &jc.ResumeExtractedJSON,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &jc, nil
}
