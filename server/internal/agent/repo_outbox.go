package agent

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ── Send queue (agent_outbox) ─────────────────────────────────────────────────

const outboxCols = `id, user_id, kind, to_address, subject, body, resume_job_id, resume_id, status, scheduled_at,
	locked_until, attempts, last_error, provider_id, sent_at, delivery_status, delivery_detail, created_at`

func scanOutbox(row pgx.Row) (*OutboxEmail, error) {
	var o OutboxEmail
	err := row.Scan(&o.ID, &o.UserID, &o.Kind, &o.ToAddress, &o.Subject, &o.Body, &o.ResumeJobID, &o.ResumeID,
		&o.Status, &o.ScheduledAt, &o.LockedUntil, &o.Attempts, &o.LastError, &o.ProviderID, &o.SentAt,
		&o.DeliveryStatus, &o.DeliveryDetail, &o.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// InsertOutbox queues an email for o.ScheduledAt.
func (r *Repository) InsertOutbox(ctx context.Context, o OutboxEmail) (*OutboxEmail, error) {
	return scanOutbox(r.db.QueryRow(ctx, `
		INSERT INTO agent_outbox (user_id, kind, to_address, subject, body, resume_job_id, resume_id, scheduled_at)
		VALUES ($1, $2, lower($3), $4, $5, $6, $7, $8)
		RETURNING `+outboxCols,
		o.UserID, o.Kind, o.ToAddress, o.Subject, o.Body, o.ResumeJobID, o.ResumeID, o.ScheduledAt))
}

func (r *Repository) GetOutbox(ctx context.Context, userID, id string) (*OutboxEmail, error) {
	return scanOutbox(r.db.QueryRow(ctx, `SELECT `+outboxCols+` FROM agent_outbox WHERE user_id = $1 AND id = $2`, userID, id))
}

// GetOutboxByProvider (cross-user) finds the email Resend knows as providerID.
func (r *Repository) GetOutboxByProvider(ctx context.Context, providerID string) (*OutboxEmail, error) {
	return scanOutbox(r.db.QueryRow(ctx, `SELECT `+outboxCols+` FROM agent_outbox WHERE provider_id = $1`, providerID))
}

// ClaimDueOutbox (cross-user) leases the next email that is due — or whose
// previous send attempt was interrupted — unless its user's sending is
// paused. Returns nil when nothing is due.
func (r *Repository) ClaimDueOutbox(ctx context.Context, lease time.Duration) (*OutboxEmail, error) {
	return scanOutbox(r.db.QueryRow(ctx, `
		UPDATE agent_outbox o
		SET status = 'sending', attempts = o.attempts + 1, locked_until = NOW() + $1::interval, updated_at = NOW()
		WHERE o.id = (
			SELECT x.id FROM agent_outbox x JOIN agent_profiles p ON p.user_id = x.user_id
			WHERE ((x.status = 'scheduled' AND x.scheduled_at <= NOW())
			    OR (x.status = 'sending' AND x.locked_until < NOW()))
			  AND (p.sending_paused_until IS NULL OR p.sending_paused_until <= NOW())
			ORDER BY x.scheduled_at
			LIMIT 1
			FOR UPDATE OF x SKIP LOCKED
		)
		RETURNING `+outboxCols, pgInterval(lease)))
}

// MarkOutboxSent records that Resend accepted the email.
func (r *Repository) MarkOutboxSent(ctx context.Context, id, providerID string, at time.Time) error {
	_, err := r.db.Exec(ctx, `
		UPDATE agent_outbox SET status = 'sent', provider_id = NULLIF($2, ''), sent_at = $3, locked_until = NULL,
			last_error = NULL, updated_at = NOW()
		WHERE id = $1`, id, providerID, at)
	return err
}

// RescheduleOutbox puts an email back in the queue for at. refund gives the
// claim's attempt back (the email was not tried, e.g. outside the window).
func (r *Repository) RescheduleOutbox(ctx context.Context, id string, at time.Time, lastErr *string, refund bool) error {
	_, err := r.db.Exec(ctx, `
		UPDATE agent_outbox SET status = 'scheduled', scheduled_at = $2, locked_until = NULL,
			last_error = COALESCE($3, last_error),
			attempts = CASE WHEN $4 AND attempts > 0 THEN attempts - 1 ELSE attempts END, updated_at = NOW()
		WHERE id = $1 AND status IN ('scheduled', 'sending')`, id, at, lastErr, refund)
	return err
}

// FinishOutbox closes an email that will not be sent (failed / cancelled).
func (r *Repository) FinishOutbox(ctx context.Context, id, status string, lastErr *string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE agent_outbox SET status = $2, last_error = COALESCE($3, last_error), locked_until = NULL, updated_at = NOW()
		WHERE id = $1 AND status IN ('scheduled', 'sending')`, id, status, lastErr)
	return err
}

// CancelScheduledOutbox cancels an email that has not started sending.
// False when it is being sent right now or is already done.
func (r *Repository) CancelScheduledOutbox(ctx context.Context, userID, id string) (bool, error) {
	tag, err := r.db.Exec(ctx, `
		UPDATE agent_outbox SET status = 'cancelled', updated_at = NOW()
		WHERE user_id = $1 AND id = $2 AND status = 'scheduled'`, userID, id)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() > 0 {
		return true, nil
	}
	var status string
	err = r.db.QueryRow(ctx, `SELECT status FROM agent_outbox WHERE user_id = $1 AND id = $2`, userID, id).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil // gone: nothing left to stop
	}
	if err != nil {
		return false, err
	}
	return status == OutboxCancelled || status == OutboxFailed, nil
}

// ApplicationsByOutbox lists the applications an email covers.
func (r *Repository) ApplicationsByOutbox(ctx context.Context, userID, outboxID string) ([]Application, error) {
	rows, err := r.db.Query(ctx, `SELECT `+appCols+appFrom+`
		WHERE a.user_id = $1 AND a.outbox_id = $2 ORDER BY a.created_at`, userID, outboxID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Application
	for rows.Next() {
		a, err := scanApp(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// RequeueOutboxApplications sends the applications of an email that will
// not go out back to the queue (except exceptID), so the next run prepares
// them again. Returns how many were re-queued.
func (r *Repository) RequeueOutboxApplications(ctx context.Context, userID, outboxID, exceptID string) (int64, error) {
	tag, err := r.db.Exec(ctx, `
		WITH moved AS (
			UPDATE applications SET status = 'queued', outbox_id = NULL, updated_at = NOW()
			WHERE user_id = $1 AND outbox_id = $2 AND status = 'scheduled' AND id::text <> $3
			RETURNING lead_id
		)
		UPDATE job_leads l SET status = 'approved', updated_at = NOW()
		FROM moved WHERE l.id = moved.lead_id`,
		userID, outboxID, exceptID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// deliveryRank orders delivery outcomes: a later event only replaces a
// lower-ranked one (webhooks arrive out of order and are retried).
func deliveryRank(status string) int {
	switch status {
	case DeliveryDelayed:
		return 1
	case DeliveryDelivered:
		return 2
	case DeliveryFailed, DeliverySuppressed:
		return 3
	case DeliveryBounced:
		return 4
	case DeliveryComplained:
		return 5
	}
	return 0
}

// SetOutboxDelivery records a delivery outcome when it outranks the stored
// one. Reports whether anything changed.
func (r *Repository) SetOutboxDelivery(ctx context.Context, id, status, detail string) (bool, error) {
	tag, err := r.db.Exec(ctx, `
		UPDATE agent_outbox SET delivery_status = $2, delivery_detail = NULLIF($3, ''), delivery_at = NOW(), updated_at = NOW()
		WHERE id = $1 AND COALESCE(CASE delivery_status
			WHEN 'delayed' THEN 1 WHEN 'delivered' THEN 2 WHEN 'failed' THEN 3 WHEN 'suppressed' THEN 3
			WHEN 'bounced' THEN 4 WHEN 'complained' THEN 5 END, 0) < $4`,
		id, status, clipText(detail, 500), deliveryRank(status))
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// plannedSend is an email a mailbox sent or will send.
type plannedSend struct {
	At time.Time
	To string // lower-case address
}

// PlannedSends returns the user's emails sent or scheduled at or after
// since, oldest first (pacing: daily cap, gaps, per-recipient spacing).
func (r *Repository) PlannedSends(ctx context.Context, userID string, since time.Time) ([]plannedSend, error) {
	rows, err := r.db.Query(ctx, `
		SELECT COALESCE(sent_at, scheduled_at) AS at, lower(to_address) FROM agent_outbox
		WHERE user_id = $1 AND status IN ('scheduled', 'sending', 'sent') AND COALESCE(sent_at, scheduled_at) >= $2
		ORDER BY at`, userID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []plannedSend
	for rows.Next() {
		var p plannedSend
		if err := rows.Scan(&p.At, &p.To); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// SentSince returns the user's emails actually sent at or after since,
// oldest first (pacing checked again at send time).
func (r *Repository) SentSince(ctx context.Context, userID string, since time.Time) ([]plannedSend, error) {
	rows, err := r.db.Query(ctx, `
		SELECT sent_at, lower(to_address) FROM agent_outbox
		WHERE user_id = $1 AND status = 'sent' AND sent_at >= $2
		ORDER BY sent_at`, userID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []plannedSend
	for rows.Next() {
		var p plannedSend
		if err := rows.Scan(&p.At, &p.To); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// FirstOutboundAt returns when the user's agent first emailed anyone (nil
// before the first email); the mailbox's warm-up counts from it.
func (r *Repository) FirstOutboundAt(ctx context.Context, userID string) (*time.Time, error) {
	var at *time.Time
	err := r.db.QueryRow(ctx, `
		SELECT MIN(received_at) FROM agent_messages WHERE user_id = $1 AND direction = 'outbound'`, userID).Scan(&at)
	return at, err
}

// CountOutboxSentSince (cross-user) counts emails sent since t.
func (r *Repository) CountOutboxSentSince(ctx context.Context, since time.Time) (int, error) {
	var n int
	err := r.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM agent_outbox WHERE status = 'sent' AND sent_at >= $1`, since).Scan(&n)
	return n, err
}

// DeliveryStats counts the user's emails sent since t and how many of them
// bounced or drew a spam complaint.
func (r *Repository) DeliveryStats(ctx context.Context, userID string, since time.Time) (sent, bounced, complained int, err error) {
	err = r.db.QueryRow(ctx, `
		SELECT COUNT(*),
		       COUNT(*) FILTER (WHERE delivery_status = 'bounced'),
		       COUNT(*) FILTER (WHERE delivery_status = 'complained')
		FROM agent_outbox WHERE user_id = $1 AND status = 'sent' AND sent_at >= $2`, userID, since).
		Scan(&sent, &bounced, &complained)
	return
}

// SendingSummary returns how many emails wait in the user's queue, when
// the next one is due and how many went out in the last 24 hours.
func (r *Repository) SendingSummary(ctx context.Context, userID string) (scheduled int, next *time.Time, sent24h int, err error) {
	err = r.db.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE status IN ('scheduled', 'sending')),
		       MIN(scheduled_at) FILTER (WHERE status IN ('scheduled', 'sending')),
		       COUNT(*) FILTER (WHERE status = 'sent' AND sent_at >= NOW() - INTERVAL '24 hours')
		FROM agent_outbox WHERE user_id = $1`, userID).Scan(&scheduled, &next, &sent24h)
	return
}

// ── Suppressions ──────────────────────────────────────────────────────────────

// Suppress adds address to the platform-wide do-not-email list. A spam
// complaint replaces an earlier reason; anything else keeps the first one.
func (r *Repository) Suppress(ctx context.Context, address, reason, detail string, userID *string) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO email_suppressions (address, reason, detail, user_id) VALUES (lower($1), $2, NULLIF($3, ''), $4)
		ON CONFLICT (address) DO UPDATE SET
			reason = CASE WHEN EXCLUDED.reason = 'complaint' THEN 'complaint' ELSE email_suppressions.reason END,
			detail = COALESCE(EXCLUDED.detail, email_suppressions.detail)`,
		strings.TrimSpace(address), reason, clipText(detail, 500), userID)
	return err
}

// Suppression returns why address must not be emailed ("" when it may be).
func (r *Repository) Suppression(ctx context.Context, address string) (string, error) {
	var reason string
	err := r.db.QueryRow(ctx, `SELECT reason FROM email_suppressions WHERE address = lower($1)`,
		strings.TrimSpace(address)).Scan(&reason)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return reason, err
}

// ── Sending pause ─────────────────────────────────────────────────────────────

// ExtendSendingPause pauses the user's sending until at least until.
// Reports whether the pause was extended (false when a longer one exists).
func (r *Repository) ExtendSendingPause(ctx context.Context, userID string, until time.Time, reason string) (bool, error) {
	tag, err := r.db.Exec(ctx, `
		UPDATE agent_profiles SET sending_paused_until = $2, sending_pause_reason = $3, updated_at = NOW()
		WHERE user_id = $1 AND (sending_paused_until IS NULL OR sending_paused_until < $2)`, userID, until, reason)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// SetSendingPause sets or (until == nil) clears the user's sending pause.
func (r *Repository) SetSendingPause(ctx context.Context, userID string, until *time.Time, reason *string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE agent_profiles SET sending_paused_until = $2, sending_pause_reason = $3, updated_at = NOW()
		WHERE user_id = $1`, userID, until, reason)
	return err
}
