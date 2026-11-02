package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the agent's data access. All methods scope by user_id
// except the scheduler/worker helpers documented as cross-user.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// ── Profiles ──────────────────────────────────────────────────────────────────

const profileCols = `user_id, enabled, resume_id, mailbox_address, search_prefs, application_profile,
	apply_settings, run_interval_hours, next_run_at, last_run_at, created_at, updated_at`

func scanProfile(row pgx.Row) (*Profile, error) {
	var (
		p                       Profile
		search, appProf, applyS []byte
	)
	err := row.Scan(&p.UserID, &p.Enabled, &p.ResumeID, &p.MailboxAddress, &search, &appProf,
		&applyS, &p.RunIntervalHours, &p.NextRunAt, &p.LastRunAt, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(search, &p.SearchPrefs)
	_ = json.Unmarshal(appProf, &p.ApplicationProfile)
	_ = json.Unmarshal(applyS, &p.ApplySettings)
	return &p, nil
}

func (r *Repository) GetProfile(ctx context.Context, userID string) (*Profile, error) {
	return scanProfile(r.db.QueryRow(ctx, `SELECT `+profileCols+` FROM agent_profiles WHERE user_id = $1`, userID))
}

func (r *Repository) GetProfileByMailbox(ctx context.Context, address string) (*Profile, error) {
	return scanProfile(r.db.QueryRow(ctx, `SELECT `+profileCols+` FROM agent_profiles WHERE mailbox_address = $1`, address))
}

// CreateProfile inserts p unless a profile already exists, then returns the
// stored row. Returns ErrMailboxTaken if the address collides.
func (r *Repository) CreateProfile(ctx context.Context, p Profile) (*Profile, error) {
	search, _ := json.Marshal(p.SearchPrefs)
	appProf, _ := json.Marshal(p.ApplicationProfile)
	applyS, _ := json.Marshal(p.ApplySettings)
	_, err := r.db.Exec(ctx, `
		INSERT INTO agent_profiles (user_id, enabled, resume_id, mailbox_address, search_prefs,
			application_profile, apply_settings, run_interval_hours, next_run_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (user_id) DO NOTHING`,
		p.UserID, p.Enabled, p.ResumeID, p.MailboxAddress, search, appProf, applyS, p.RunIntervalHours, p.NextRunAt)
	if isUniqueViolation(err) {
		return nil, ErrMailboxTaken
	}
	if err != nil {
		return nil, err
	}
	return r.GetProfile(ctx, p.UserID)
}

func (r *Repository) UpdateProfile(ctx context.Context, p Profile) (*Profile, error) {
	search, _ := json.Marshal(p.SearchPrefs)
	appProf, _ := json.Marshal(p.ApplicationProfile)
	applyS, _ := json.Marshal(p.ApplySettings)
	row := r.db.QueryRow(ctx, `
		UPDATE agent_profiles SET
			enabled = $2, resume_id = $3, mailbox_address = $4, search_prefs = $5,
			application_profile = $6, apply_settings = $7, run_interval_hours = $8,
			next_run_at = $9, updated_at = NOW()
		WHERE user_id = $1
		RETURNING `+profileCols,
		p.UserID, p.Enabled, p.ResumeID, p.MailboxAddress, search, appProf, applyS, p.RunIntervalHours, p.NextRunAt)
	out, err := scanProfile(row)
	if isUniqueViolation(err) {
		return nil, ErrMailboxTaken
	}
	return out, err
}

func (r *Repository) MailboxTaken(ctx context.Context, address, exceptUserID string) (bool, error) {
	var taken bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM agent_profiles WHERE mailbox_address = $1 AND user_id <> $2)`,
		address, exceptUserID).Scan(&taken)
	return taken, err
}

// ClaimDueProfile (cross-user) atomically picks one enabled profile whose run
// is due and pushes its next_run_at forward by its interval, so concurrent
// schedulers never pick the same user. Returns "" when nothing is due.
func (r *Repository) ClaimDueProfile(ctx context.Context) (string, error) {
	var userID string
	err := r.db.QueryRow(ctx, `
		UPDATE agent_profiles p
		SET next_run_at = NOW() + make_interval(hours => p.run_interval_hours), updated_at = NOW()
		WHERE p.user_id = (
			SELECT user_id FROM agent_profiles
			WHERE enabled AND next_run_at IS NOT NULL AND next_run_at <= NOW()
			ORDER BY next_run_at
			LIMIT 1
			FOR UPDATE SKIP LOCKED
		)
		RETURNING p.user_id`).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return userID, err
}

func (r *Repository) TouchLastRun(ctx context.Context, userID string, at time.Time) error {
	_, err := r.db.Exec(ctx, `UPDATE agent_profiles SET last_run_at = $2 WHERE user_id = $1`, userID, at)
	return err
}

// ── Runs ──────────────────────────────────────────────────────────────────────

const runCols = `id, user_id, trigger, status, stats, error, started_at, finished_at`

func scanRun(row pgx.Row) (*Run, error) {
	var (
		run   Run
		stats []byte
	)
	err := row.Scan(&run.ID, &run.UserID, &run.Trigger, &run.Status, &stats, &run.Error, &run.StartedAt, &run.FinishedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(stats, &run.Stats)
	return &run, nil
}

// StartRun records a running run; ErrRunInProgress if one already runs.
func (r *Repository) StartRun(ctx context.Context, userID, trigger string) (*Run, error) {
	run, err := scanRun(r.db.QueryRow(ctx, `
		INSERT INTO agent_runs (user_id, trigger) VALUES ($1, $2) RETURNING `+runCols, userID, trigger))
	if isUniqueViolation(err) {
		return nil, ErrRunInProgress
	}
	return run, err
}

func (r *Repository) FinishRun(ctx context.Context, runID, status string, stats RunStats, errMsg *string) error {
	b, _ := json.Marshal(stats)
	_, err := r.db.Exec(ctx, `
		UPDATE agent_runs SET status = $2, stats = $3, error = $4, finished_at = NOW() WHERE id = $1`,
		runID, status, b, errMsg)
	return err
}

func (r *Repository) GetRunningRun(ctx context.Context, userID string) (*Run, error) {
	return scanRun(r.db.QueryRow(ctx, `
		SELECT `+runCols+` FROM agent_runs WHERE user_id = $1 AND status = 'running'`, userID))
}

func (r *Repository) GetRun(ctx context.Context, userID, runID string) (*Run, error) {
	return scanRun(r.db.QueryRow(ctx, `
		SELECT `+runCols+` FROM agent_runs WHERE user_id = $1 AND id = $2`, userID, runID))
}

func (r *Repository) ListRuns(ctx context.Context, userID string, limit int) ([]Run, error) {
	rows, err := r.db.Query(ctx, `
		SELECT `+runCols+` FROM agent_runs WHERE user_id = $1 ORDER BY started_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Run
	for rows.Next() {
		run, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *run)
	}
	return out, rows.Err()
}

// FailStaleRuns (cross-user) closes runs left "running" by a crash.
func (r *Repository) FailStaleRuns(ctx context.Context, startedBefore time.Time) (int64, error) {
	tag, err := r.db.Exec(ctx, `
		UPDATE agent_runs SET status = 'failed', error = 'interrupted (server restart or timeout)', finished_at = NOW()
		WHERE status = 'running' AND started_at < $1`, startedBefore)
	return tag.RowsAffected(), err
}

// ── Events ────────────────────────────────────────────────────────────────────

func (r *Repository) AddEvent(ctx context.Context, e Event) error {
	var data any
	if len(e.Data) > 0 {
		data = []byte(e.Data)
	}
	level := e.Level
	if level == "" {
		level = "info"
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO agent_events (user_id, run_id, kind, level, message, lead_id, application_id, data)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		e.UserID, e.RunID, e.Kind, level, e.Message, e.LeadID, e.ApplicationID, data)
	return err
}

// LastEventOfKind returns when the user's most recent event of kind happened.
func (r *Repository) LastEventOfKind(ctx context.Context, userID, kind string) (*time.Time, error) {
	var at time.Time
	err := r.db.QueryRow(ctx, `
		SELECT created_at FROM agent_events WHERE user_id = $1 AND kind = $2
		ORDER BY id DESC LIMIT 1`, userID, kind).Scan(&at)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &at, nil
}

func (r *Repository) ListEvents(ctx context.Context, userID string, beforeID int64, limit int) ([]Event, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, user_id, run_id, kind, level, message, lead_id, application_id, data, created_at
		FROM agent_events
		WHERE user_id = $1 AND ($2::bigint = 0 OR id < $2)
		ORDER BY id DESC
		LIMIT $3`, userID, beforeID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Event
	for rows.Next() {
		var (
			e    Event
			data []byte
		)
		if err := rows.Scan(&e.ID, &e.UserID, &e.RunID, &e.Kind, &e.Level, &e.Message, &e.LeadID,
			&e.ApplicationID, &data, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.Data = data
		out = append(out, e)
	}
	return out, rows.Err()
}

// ── Cross-module lookups (read-only) ──────────────────────────────────────────

func (r *Repository) GetUserBasics(ctx context.Context, userID string) (*UserBasics, error) {
	var u UserBasics
	err := r.db.QueryRow(ctx, `SELECT id, full_name, email FROM users WHERE id = $1`, userID).
		Scan(&u.ID, &u.FullName, &u.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &u, err
}

const resumeCols = `id, name, original_filename, file_format, r2_object_key, extraction_status, extracted_json::text`

func scanResume(row pgx.Row) (*ResumeInfo, error) {
	var ri ResumeInfo
	err := row.Scan(&ri.ID, &ri.Name, &ri.OriginalFilename, &ri.FileFormat, &ri.R2ObjectKey,
		&ri.ExtractionStatus, &ri.ExtractedJSON)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &ri, err
}

func (r *Repository) GetResume(ctx context.Context, userID, resumeID string) (*ResumeInfo, error) {
	return scanResume(r.db.QueryRow(ctx, `
		SELECT `+resumeCols+` FROM resumes WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
		resumeID, userID))
}

// LatestResume returns the most recent fully processed resume.
func (r *Repository) LatestResume(ctx context.Context, userID string) (*ResumeInfo, error) {
	return scanResume(r.db.QueryRow(ctx, `
		SELECT `+resumeCols+` FROM resumes
		WHERE user_id = $1 AND deleted_at IS NULL AND extraction_status = 'completed'
		ORDER BY uploaded_at DESC LIMIT 1`, userID))
}

func (r *Repository) HasActiveExtensionDevice(ctx context.Context, userID string) (bool, error) {
	var ok bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM extension_devices WHERE user_id = $1 AND revoked_at IS NULL)`,
		userID).Scan(&ok)
	return ok, err
}

func pgInterval(d time.Duration) string {
	return fmt.Sprintf("%d seconds", int64(d.Seconds()))
}
