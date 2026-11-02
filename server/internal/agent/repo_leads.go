package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const leadCols = `id, user_id, run_id, source, source_label, external_id, dedupe_key, title, company,
	location, is_remote, employment_type, salary_min, salary_max, salary_currency, salary_text,
	url, apply_url, apply_email, ats, description, posted_at, match_score, match_fit, match_summary,
	match_pros, match_gaps, dealbreaker, scored_at, status, dismiss_reason, decided_at, job_id,
	created_at, updated_at`

func scanLead(row pgx.Row) (*Lead, error) {
	var (
		l          Lead
		pros, gaps []byte
	)
	err := row.Scan(&l.ID, &l.UserID, &l.RunID, &l.Source, &l.SourceLabel, &l.ExternalID, &l.DedupeKey,
		&l.Title, &l.Company, &l.Location, &l.IsRemote, &l.EmploymentType, &l.SalaryMin, &l.SalaryMax,
		&l.SalaryCurrency, &l.SalaryText, &l.URL, &l.ApplyURL, &l.ApplyEmail, &l.ATS, &l.Description,
		&l.PostedAt, &l.MatchScore, &l.MatchFit, &l.MatchSummary, &pros, &gaps, &l.Dealbreaker,
		&l.ScoredAt, &l.Status, &l.DismissReason, &l.DecidedAt, &l.JobID, &l.CreatedAt, &l.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(pros, &l.MatchPros)
	_ = json.Unmarshal(gaps, &l.MatchGaps)
	return &l, nil
}

func jsonOrNil(v []string) any {
	if v == nil {
		return nil
	}
	b, _ := json.Marshal(v)
	return b
}

// InsertLead stores a lead unless one with the same dedupe key exists.
// Returns the stored lead, or nil when it was a duplicate.
func (r *Repository) InsertLead(ctx context.Context, l Lead) (*Lead, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO job_leads (user_id, run_id, source, source_label, external_id, dedupe_key, title, company,
			location, is_remote, employment_type, salary_min, salary_max, salary_currency, salary_text,
			url, apply_url, apply_email, ats, description, posted_at, match_score, match_fit, match_summary,
			match_pros, match_gaps, dealbreaker, scored_at, status, dismiss_reason, decided_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
			$25,$26,$27,$28,$29,$30,$31)
		ON CONFLICT (user_id, dedupe_key) DO NOTHING
		RETURNING `+leadCols,
		l.UserID, l.RunID, l.Source, l.SourceLabel, l.ExternalID, l.DedupeKey, l.Title, l.Company,
		l.Location, l.IsRemote, l.EmploymentType, l.SalaryMin, l.SalaryMax, l.SalaryCurrency, l.SalaryText,
		l.URL, l.ApplyURL, l.ApplyEmail, l.ATS, l.Description, l.PostedAt, l.MatchScore, l.MatchFit,
		l.MatchSummary, jsonOrNil(l.MatchPros), jsonOrNil(l.MatchGaps), l.Dealbreaker, l.ScoredAt,
		l.Status, l.DismissReason, l.DecidedAt)
	return scanLead(row)
}

// ExistingDedupeKeys returns which of keys the user already has leads for.
func (r *Repository) ExistingDedupeKeys(ctx context.Context, userID string, keys []string) (map[string]bool, error) {
	out := map[string]bool{}
	if len(keys) == 0 {
		return out, nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT dedupe_key FROM job_leads WHERE user_id = $1 AND dedupe_key = ANY($2)`, userID, keys)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		out[k] = true
	}
	return out, rows.Err()
}

// LeadQuery filters the review list.
type LeadQuery struct {
	Statuses []string
	MinScore *int
	Source   string
	Remote   *bool
	Search   string
	Sort     string // "score" (default) | "recent"
	Page     int
	PageSize int
}

func (r *Repository) ListLeads(ctx context.Context, userID string, q LeadQuery) ([]Lead, int, error) {
	args := []any{userID}
	where := "user_id = $1"
	add := func(cond string, v any) {
		args = append(args, v)
		where += " AND " + strings.ReplaceAll(cond, "?", "$"+strconv.Itoa(len(args)))
	}
	if len(q.Statuses) > 0 {
		add("status = ANY(?)", q.Statuses)
	}
	if q.MinScore != nil {
		add("match_score >= ?", *q.MinScore)
	}
	if q.Source != "" {
		add("source = ?", q.Source)
	}
	if q.Remote != nil {
		add("is_remote = ?", *q.Remote)
	}
	if s := strings.TrimSpace(q.Search); s != "" {
		add("(title ILIKE ? OR company ILIKE ?)", "%"+s+"%")
	}

	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM job_leads WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	order := "match_score DESC NULLS LAST, created_at DESC"
	if q.Sort == "recent" {
		order = "created_at DESC"
	}
	args = append(args, q.PageSize, (q.Page-1)*q.PageSize)
	rows, err := r.db.Query(ctx, "SELECT "+leadCols+" FROM job_leads WHERE "+where+
		" ORDER BY "+order+" LIMIT $"+strconv.Itoa(len(args)-1)+" OFFSET $"+strconv.Itoa(len(args)), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []Lead
	for rows.Next() {
		l, err := scanLead(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *l)
	}
	return out, total, rows.Err()
}

func (r *Repository) GetLead(ctx context.Context, userID, id string) (*Lead, error) {
	return scanLead(r.db.QueryRow(ctx, `SELECT `+leadCols+` FROM job_leads WHERE user_id = $1 AND id = $2`, userID, id))
}

func (r *Repository) SetLeadStatus(ctx context.Context, userID, id, status string, dismissReason *string, decided bool) (*Lead, error) {
	return scanLead(r.db.QueryRow(ctx, `
		UPDATE job_leads SET status = $3, dismiss_reason = $4,
			decided_at = CASE WHEN $5 THEN NOW() ELSE decided_at END, updated_at = NOW()
		WHERE user_id = $1 AND id = $2
		RETURNING `+leadCols, userID, id, status, dismissReason, decided))
}

func (r *Repository) SetLeadJob(ctx context.Context, id, jobID string) error {
	_, err := r.db.Exec(ctx, `UPDATE job_leads SET job_id = $2, updated_at = NOW() WHERE id = $1`, id, jobID)
	return err
}

// UpdateLeadPosting stores the full posting found for a lead whose own
// description was too thin. Empty values leave a column unchanged.
func (r *Repository) UpdateLeadPosting(ctx context.Context, id, description, postingURL, applyURL, ats, applyEmail string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE job_leads SET
		  description = $2,
		  url         = COALESCE(NULLIF($3, ''), url),
		  apply_url   = COALESCE(NULLIF($4, ''), apply_url),
		  ats         = COALESCE(NULLIF($5, ''), ats),
		  apply_email = COALESCE(apply_email, NULLIF($6, '')),
		  updated_at  = NOW()
		WHERE id = $1`, id, description, postingURL, applyURL, ats, applyEmail)
	return err
}

// LastColdEmail returns when the user's agent last cold-emailed address
// (case-insensitive) after since, and the role it was about.
func (r *Repository) LastColdEmail(ctx context.Context, userID, address string, since time.Time) (*time.Time, string, error) {
	var at time.Time
	var title string
	err := r.db.QueryRow(ctx, `
		SELECT a.submitted_at, l.title FROM applications a JOIN job_leads l ON l.id = a.lead_id
		WHERE a.user_id = $1 AND a.channel = 'cold_email' AND a.status = 'submitted'
		  AND lower(a.apply_email) = lower($2) AND a.submitted_at > $3
		ORDER BY a.submitted_at DESC LIMIT 1`, userID, address, since).Scan(&at, &title)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", err
	}
	return &at, title, nil
}

// LeadScoreUpdate is the result of scoring one lead.
type LeadScoreUpdate struct {
	Score       int
	Fit         string
	Summary     string
	Pros, Gaps  []string
	Dealbreaker *string
}

func (r *Repository) SetLeadScore(ctx context.Context, id string, u LeadScoreUpdate) error {
	_, err := r.db.Exec(ctx, `
		UPDATE job_leads SET match_score = $2, match_fit = $3, match_summary = $4, match_pros = $5,
			match_gaps = $6, dealbreaker = $7, scored_at = NOW(), updated_at = NOW()
		WHERE id = $1`, id, u.Score, u.Fit, u.Summary, jsonOrNil(u.Pros), jsonOrNil(u.Gaps), u.Dealbreaker)
	return err
}

// UnscoredLeads returns new leads whose scoring failed in an earlier run.
func (r *Repository) UnscoredLeads(ctx context.Context, userID string, limit int) ([]Lead, error) {
	rows, err := r.db.Query(ctx, `
		SELECT `+leadCols+` FROM job_leads
		WHERE user_id = $1 AND scored_at IS NULL AND status = 'new'
		ORDER BY created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Lead
	for rows.Next() {
		l, err := scanLead(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *l)
	}
	return out, rows.Err()
}

func (r *Repository) CountLeadsByStatus(ctx context.Context, userID string) (map[string]int, error) {
	rows, err := r.db.Query(ctx, `SELECT status, COUNT(*) FROM job_leads WHERE user_id = $1 GROUP BY status`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var (
			s string
			n int
		)
		if err := rows.Scan(&s, &n); err != nil {
			return nil, err
		}
		out[s] = n
	}
	return out, rows.Err()
}

// RecentLeadLabels returns "Company - Title" for recent leads (used to tell
// web search what is already known).
func (r *Repository) RecentLeadLabels(ctx context.Context, userID string, limit int) ([]string, error) {
	rows, err := r.db.Query(ctx, `
		SELECT company, title FROM job_leads WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var c, t string
		if err := rows.Scan(&c, &t); err != nil {
			return nil, err
		}
		out = append(out, c+" - "+t)
	}
	return out, rows.Err()
}

// ExpireStaleLeads marks unreviewed leads older than cutoff as expired.
func (r *Repository) ExpireStaleLeads(ctx context.Context, userID string, cutoff time.Time) (int64, error) {
	tag, err := r.db.Exec(ctx, `
		UPDATE job_leads SET status = 'expired', updated_at = NOW()
		WHERE user_id = $1 AND status = 'new' AND created_at < $2`, userID, cutoff)
	return tag.RowsAffected(), err
}

// ── Applications ──────────────────────────────────────────────────────────────

const appCols = `a.id, a.user_id, a.lead_id, a.job_id, a.channel, a.status, a.apply_url, a.apply_email, a.ats,
	a.cover_letter, a.use_original_resume, a.attempts, a.last_error, a.needs, a.result, a.claimed_at,
	a.claim_expires_at, a.submitted_at, a.created_at, a.updated_at,
	l.title, l.company, l.match_score, l.url`

const appFrom = ` FROM applications a JOIN job_leads l ON l.id = a.lead_id `

func scanApp(row pgx.Row) (*Application, error) {
	var (
		a      Application
		needs  []byte
		result []byte
	)
	err := row.Scan(&a.ID, &a.UserID, &a.LeadID, &a.JobID, &a.Channel, &a.Status, &a.ApplyURL, &a.ApplyEmail,
		&a.ATS, &a.CoverLetter, &a.UseOriginalResume, &a.Attempts, &a.LastError, &needs, &result,
		&a.ClaimedAt, &a.ClaimExpiresAt, &a.SubmittedAt, &a.CreatedAt, &a.UpdatedAt,
		&a.LeadTitle, &a.LeadCompany, &a.LeadScore, &a.LeadURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if len(needs) > 0 {
		var n Needs
		if json.Unmarshal(needs, &n) == nil {
			a.Needs = &n
		}
	}
	a.Result = result
	return &a, nil
}

// QueueApplication creates the application for a lead, or re-queues an
// existing one that was cancelled or failed. Returns the current row.
func (r *Repository) QueueApplication(ctx context.Context, userID, leadID string) (*Application, error) {
	_, err := r.db.Exec(ctx, `
		INSERT INTO applications (user_id, lead_id, status) VALUES ($1, $2, 'queued')
		ON CONFLICT (lead_id) DO UPDATE SET
			status = 'queued', last_error = NULL, needs = NULL, claimed_at = NULL, claim_expires_at = NULL,
			updated_at = NOW()
		WHERE applications.status IN ('cancelled', 'failed')`, userID, leadID)
	if err != nil {
		return nil, err
	}
	return r.GetApplicationByLead(ctx, userID, leadID)
}

func (r *Repository) GetApplication(ctx context.Context, userID, id string) (*Application, error) {
	return scanApp(r.db.QueryRow(ctx, `SELECT `+appCols+appFrom+`WHERE a.user_id = $1 AND a.id = $2`, userID, id))
}

func (r *Repository) GetApplicationByLead(ctx context.Context, userID, leadID string) (*Application, error) {
	return scanApp(r.db.QueryRow(ctx, `SELECT `+appCols+appFrom+`WHERE a.user_id = $1 AND a.lead_id = $2`, userID, leadID))
}

func (r *Repository) ListApplications(ctx context.Context, userID string, statuses []string, limit, offset int) ([]Application, int, error) {
	args := []any{userID}
	where := "a.user_id = $1"
	if len(statuses) > 0 {
		args = append(args, statuses)
		where += " AND a.status = ANY($2)"
	}
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM applications a WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append(args, limit, offset)
	rows, err := r.db.Query(ctx, "SELECT "+appCols+appFrom+"WHERE "+where+
		" ORDER BY a.updated_at DESC LIMIT $"+strconv.Itoa(len(args)-1)+" OFFSET $"+strconv.Itoa(len(args)), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []Application
	for rows.Next() {
		a, err := scanApp(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *a)
	}
	return out, total, rows.Err()
}

// SaveApplication persists every mutable field of a.
func (r *Repository) SaveApplication(ctx context.Context, a *Application) error {
	var needs any
	if a.Needs != nil {
		b, _ := json.Marshal(a.Needs)
		needs = b
	}
	var result any
	if len(a.Result) > 0 {
		result = []byte(a.Result)
	}
	_, err := r.db.Exec(ctx, `
		UPDATE applications SET job_id = $3, channel = $4, status = $5, apply_url = $6, apply_email = $7,
			ats = $8, cover_letter = $9, use_original_resume = $10, attempts = $11, last_error = $12,
			needs = $13, result = $14, claimed_at = $15, claim_expires_at = $16, submitted_at = $17,
			updated_at = NOW()
		WHERE user_id = $1 AND id = $2`,
		a.UserID, a.ID, a.JobID, a.Channel, a.Status, a.ApplyURL, a.ApplyEmail, a.ATS, a.CoverLetter,
		a.UseOriginalResume, a.Attempts, a.LastError, needs, result, a.ClaimedAt, a.ClaimExpiresAt, a.SubmittedAt)
	return err
}

// DeleteApplication removes an application that never started (undoing
// an approval).
func (r *Repository) DeleteApplication(ctx context.Context, userID, id string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM applications WHERE user_id = $1 AND id = $2 AND status IN ('queued', 'cancelled')`, userID, id)
	return err
}

// ClaimBrowserApplication leases the next ready browser application (or one
// whose lease expired) to the extension. Returns nil when none is waiting.
func (r *Repository) ClaimBrowserApplication(ctx context.Context, userID string, lease time.Duration) (*Application, error) {
	var id string
	err := r.db.QueryRow(ctx, `
		UPDATE applications SET status = 'in_progress', claimed_at = NOW(),
			claim_expires_at = NOW() + $2::interval, attempts = attempts + 1, updated_at = NOW()
		WHERE id = (
			SELECT id FROM applications
			WHERE user_id = $1 AND channel = 'browser'
			  AND (status = 'ready' OR (status = 'in_progress' AND claim_expires_at < NOW()))
			ORDER BY updated_at
			LIMIT 1
			FOR UPDATE SKIP LOCKED
		)
		RETURNING id`, userID, pgInterval(lease)).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return r.GetApplication(ctx, userID, id)
}

// ApplicationsByStatus returns the user's applications in status, oldest first.
func (r *Repository) ApplicationsByStatus(ctx context.Context, userID, status string, limit int) ([]Application, error) {
	rows, err := r.db.Query(ctx, `SELECT `+appCols+appFrom+`
		WHERE a.user_id = $1 AND a.status = $2 ORDER BY a.updated_at LIMIT $3`, userID, status, limit)
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

// RequeueInterrupted puts applications left in "preparing" by an
// interrupted run back in the queue. Safe because a user never has two runs
// at once: anything still preparing when a run starts is stale.
func (r *Repository) RequeueInterrupted(ctx context.Context, userID string) (int64, error) {
	tag, err := r.db.Exec(ctx, `
		UPDATE applications SET status = 'queued', updated_at = NOW()
		WHERE user_id = $1 AND status = 'preparing'`, userID)
	return tag.RowsAffected(), err
}

func (r *Repository) CountSubmittedSince(ctx context.Context, userID string, since time.Time) (int, error) {
	var n int
	err := r.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM applications WHERE user_id = $1 AND status = 'submitted' AND submitted_at >= $2`,
		userID, since).Scan(&n)
	return n, err
}

func (r *Repository) CountApplicationsByStatus(ctx context.Context, userID string) (map[string]int, error) {
	rows, err := r.db.Query(ctx, `SELECT status, COUNT(*) FROM applications WHERE user_id = $1 GROUP BY status`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var (
			s string
			n int
		)
		if err := rows.Scan(&s, &n); err != nil {
			return nil, err
		}
		out[s] = n
	}
	return out, rows.Err()
}

// ApplicationsForMatching lists recent applications for inbox matching.
func (r *Repository) ApplicationsForMatching(ctx context.Context, userID string, limit int) ([]AppMatch, error) {
	rows, err := r.db.Query(ctx, `
		SELECT a.id, a.job_id, l.company, l.title, a.status, a.submitted_at
		FROM applications a JOIN job_leads l ON l.id = a.lead_id
		WHERE a.user_id = $1 AND a.status NOT IN ('cancelled')
		ORDER BY COALESCE(a.submitted_at, a.updated_at) DESC
		LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AppMatch
	for rows.Next() {
		var m AppMatch
		if err := rows.Scan(&m.ApplicationID, &m.JobID, &m.Company, &m.Title, &m.Status, &m.SubmittedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
