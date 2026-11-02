package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

const msgCols = `id, user_id, direction, provider_id, message_id, from_address, from_name, to_addresses,
	subject, text_body, links, attachments, category, summary, extracted, important, application_id,
	job_id, triage_status, triage_attempts, read_at, received_at, created_at`

func scanMessage(row pgx.Row) (*Message, error) {
	var (
		m                         Message
		to, links, att, extracted []byte
	)
	err := row.Scan(&m.ID, &m.UserID, &m.Direction, &m.ProviderID, &m.MessageID, &m.FromAddress, &m.FromName,
		&to, &m.Subject, &m.TextBody, &links, &att, &m.Category, &m.Summary, &extracted, &m.Important,
		&m.ApplicationID, &m.JobID, &m.TriageStatus, &m.TriageAttempts, &m.ReadAt, &m.ReceivedAt, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(to, &m.ToAddresses)
	_ = json.Unmarshal(links, &m.Links)
	m.Attachments = att
	if len(extracted) > 0 {
		var t TriageResult
		if json.Unmarshal(extracted, &t) == nil {
			m.Extracted = &t
		}
	}
	return &m, nil
}

// InsertMessage stores a mail; returns nil (no error) for a duplicate
// provider id so webhook retries are idempotent.
func (r *Repository) InsertMessage(ctx context.Context, m Message) (*Message, error) {
	to, _ := json.Marshal(m.ToAddresses)
	var links any
	if m.Links != nil {
		b, _ := json.Marshal(m.Links)
		links = b
	}
	var att any
	if len(m.Attachments) > 0 {
		att = []byte(m.Attachments)
	}
	triage := m.TriageStatus
	if triage == "" {
		triage = "pending"
	}
	row := r.db.QueryRow(ctx, `
		INSERT INTO agent_messages (user_id, direction, provider_id, message_id, from_address, from_name,
			to_addresses, subject, text_body, links, attachments, category, summary, important,
			application_id, job_id, triage_status, received_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
		ON CONFLICT (user_id, provider_id) WHERE provider_id IS NOT NULL DO NOTHING
		RETURNING `+msgCols,
		m.UserID, m.Direction, m.ProviderID, m.MessageID, m.FromAddress, m.FromName, to, m.Subject,
		m.TextBody, links, att, m.Category, m.Summary, m.Important, m.ApplicationID, m.JobID, triage, m.ReceivedAt)
	return scanMessage(row)
}

func (r *Repository) GetMessage(ctx context.Context, userID, id string) (*Message, error) {
	return scanMessage(r.db.QueryRow(ctx, `SELECT `+msgCols+` FROM agent_messages WHERE user_id = $1 AND id = $2`, userID, id))
}

func (r *Repository) ListMessages(ctx context.Context, userID, category string, limit, offset int) ([]Message, int, error) {
	args := []any{userID}
	where := "user_id = $1"
	switch category {
	case "":
	case "important":
		where += " AND important"
	case "outbound":
		where += " AND direction = 'outbound'"
	default:
		args = append(args, category)
		where += " AND category = $2"
	}
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM agent_messages WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append(args, limit, offset)
	rows, err := r.db.Query(ctx, "SELECT "+msgCols+" FROM agent_messages WHERE "+where+
		" ORDER BY received_at DESC LIMIT $"+strconv.Itoa(len(args)-1)+" OFFSET $"+strconv.Itoa(len(args)), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *m)
	}
	return out, total, rows.Err()
}

// PendingTriage (cross-user) returns inbound mail still awaiting triage.
func (r *Repository) PendingTriage(ctx context.Context, limit int) ([]Message, error) {
	rows, err := r.db.Query(ctx, `SELECT `+msgCols+` FROM agent_messages
		WHERE triage_status = 'pending' AND direction = 'inbound' AND triage_attempts < 3
		ORDER BY received_at LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

// MessageTriageUpdate is the stored outcome of triage.
type MessageTriageUpdate struct {
	Status        string // done|failed|skipped|pending
	Category      *string
	Summary       *string
	Extracted     *TriageResult
	Important     bool
	ApplicationID *string
	JobID         *string
}

func (r *Repository) SetMessageTriage(ctx context.Context, id string, u MessageTriageUpdate) error {
	var extracted any
	if u.Extracted != nil {
		b, _ := json.Marshal(u.Extracted)
		extracted = b
	}
	_, err := r.db.Exec(ctx, `
		UPDATE agent_messages SET triage_status = $2, category = $3, summary = $4, extracted = $5,
			important = $6, application_id = $7, job_id = $8, triage_attempts = triage_attempts + 1
		WHERE id = $1`, id, u.Status, u.Category, u.Summary, extracted, u.Important, u.ApplicationID, u.JobID)
	return err
}

func (r *Repository) BumpTriageAttempt(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE agent_messages SET triage_attempts = triage_attempts + 1,
			triage_status = CASE WHEN triage_attempts + 1 >= 3 THEN 'failed' ELSE triage_status END
		WHERE id = $1`, id)
	return err
}

func (r *Repository) MarkMessageRead(ctx context.Context, userID, id string, read bool) error {
	_, err := r.db.Exec(ctx, `
		UPDATE agent_messages SET read_at = CASE WHEN $3 THEN COALESCE(read_at, NOW()) ELSE NULL END
		WHERE user_id = $1 AND id = $2`, userID, id, read)
	return err
}

func (r *Repository) CountUnreadImportant(ctx context.Context, userID string) (int, error) {
	var n int
	err := r.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM agent_messages WHERE user_id = $1 AND important AND read_at IS NULL`, userID).Scan(&n)
	return n, err
}

// RecentVerifications returns verification mail received since t, newest first.
func (r *Repository) RecentVerifications(ctx context.Context, userID string, since time.Time) ([]Message, error) {
	rows, err := r.db.Query(ctx, `SELECT `+msgCols+` FROM agent_messages
		WHERE user_id = $1 AND direction = 'inbound' AND received_at >= $2
		  AND (category = 'verification' OR triage_status = 'pending')
		ORDER BY received_at DESC LIMIT 10`, userID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

// ── Answers ───────────────────────────────────────────────────────────────────

func (r *Repository) ListAnswers(ctx context.Context, userID string) ([]Answer, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, user_id, question_key, question, answer, source, created_at, updated_at
		FROM agent_answers WHERE user_id = $1 ORDER BY updated_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Answer
	for rows.Next() {
		var a Answer
		if err := rows.Scan(&a.ID, &a.UserID, &a.QuestionKey, &a.Question, &a.Answer, &a.Source,
			&a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *Repository) UpsertAnswer(ctx context.Context, userID, key, question, answer, source string) (*Answer, error) {
	var a Answer
	err := r.db.QueryRow(ctx, `
		INSERT INTO agent_answers (user_id, question_key, question, answer, source)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, question_key) DO UPDATE SET
			question = EXCLUDED.question, answer = EXCLUDED.answer, source = EXCLUDED.source, updated_at = NOW()
		RETURNING id, user_id, question_key, question, answer, source, created_at, updated_at`,
		userID, key, question, answer, source).
		Scan(&a.ID, &a.UserID, &a.QuestionKey, &a.Question, &a.Answer, &a.Source, &a.CreatedAt, &a.UpdatedAt)
	return &a, err
}

func (r *Repository) DeleteAnswer(ctx context.Context, userID, id string) (bool, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM agent_answers WHERE user_id = $1 AND id = $2`, userID, id)
	return tag.RowsAffected() > 0, err
}
