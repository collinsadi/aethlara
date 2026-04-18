package job

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ResumeRef holds the minimal resume data the job service needs.
type ResumeRef struct {
	ID               string
	ExtractionStatus string
	ExtractedJSON    *string
}

type Repository interface {
	Create(ctx context.Context, j Job) (*Job, error)
	GetByID(ctx context.Context, id, userID string) (*Job, error)
	GetByIDWithJSON(ctx context.Context, id, userID string) (*Job, *string, *string, error)
	List(ctx context.Context, userID string, q ListJobsQuery) ([]Job, int, error)
	UpdateExtractionStatus(ctx context.Context, id, status string, extractedJSON, errMsg *string) error
	UpdateAlignmentStatus(ctx context.Context, id, status string, alignmentJSON *string, matchScore *int, errMsg *string) error
	UpdatePDF(ctx context.Context, id, r2Key string, generatedAt time.Time) error
	UpdateJobFields(ctx context.Context, id string, f JobFields) error
	UpdateStatus(ctx context.Context, id, userID, status string, appliedAt *time.Time, notes *string) (*Job, error)
	SoftDelete(ctx context.Context, id, userID string) (*Job, error)
	FindDuplicate(ctx context.Context, userID, jobURL string, since time.Time) (*Job, error)
	GetResumeForJob(ctx context.Context, resumeID, userID string) (*ResumeRef, error)
	GetUserProfile(ctx context.Context, userID string) (*UserProfile, error)
	GetRecentChatMessagesForJob(ctx context.Context, jobID, userID string, limit int) ([]ChatMessage, error)
	CreateFromPreview(ctx context.Context, j Job) (*Job, error)
}

type pgxRepository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) Repository {
	return &pgxRepository{db: db}
}

// jobCols lists all columns except the two JSONB blobs.
const jobCols = `id, user_id, resume_id,
	job_title, company, location, is_remote, job_url, employment_type, experience_level,
	salary_min, salary_max, salary_currency,
	input_method, raw_input_ref,
	extraction_status, extraction_error,
	match_score, alignment_status, alignment_error,
	pdf_r2_key, pdf_generated_at,
	status, applied_at, notes,
	created_at, updated_at, deleted_at`

func scanJob(row pgx.Row) (*Job, error) {
	var j Job
	err := row.Scan(
		&j.ID, &j.UserID, &j.ResumeID,
		&j.JobTitle, &j.Company, &j.Location, &j.IsRemote, &j.JobURL,
		&j.EmploymentType, &j.ExperienceLevel,
		&j.SalaryMin, &j.SalaryMax, &j.SalaryCurrency,
		&j.InputMethod, &j.RawInputRef,
		&j.ExtractionStatus, &j.ExtractionError,
		&j.MatchScore, &j.AlignmentStatus, &j.AlignmentError,
		&j.PDFR2Key, &j.PDFGeneratedAt,
		&j.Status, &j.AppliedAt, &j.Notes,
		&j.CreatedAt, &j.UpdatedAt, &j.DeletedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &j, err
}

func (r *pgxRepository) Create(ctx context.Context, j Job) (*Job, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO jobs (user_id, resume_id, input_method, job_url, extraction_status, alignment_status)
		VALUES ($1, $2, $3, $4, 'pending', 'pending')
		RETURNING `+jobCols,
		j.UserID, j.ResumeID, j.InputMethod, j.JobURL,
	)
	return scanJob(row)
}

func (r *pgxRepository) GetByID(ctx context.Context, id, userID string) (*Job, error) {
	row := r.db.QueryRow(ctx, `
		SELECT `+jobCols+`
		FROM jobs
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
		id, userID,
	)
	return scanJob(row)
}

func (r *pgxRepository) GetByIDWithJSON(ctx context.Context, id, userID string) (*Job, *string, *string, error) {
	var j Job
	var extractedJSON, tailoredJSON *string
	err := r.db.QueryRow(ctx, `
		SELECT `+jobCols+`, extracted_job_json::text, tailored_resume_json::text
		FROM jobs
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
		id, userID,
	).Scan(
		&j.ID, &j.UserID, &j.ResumeID,
		&j.JobTitle, &j.Company, &j.Location, &j.IsRemote, &j.JobURL,
		&j.EmploymentType, &j.ExperienceLevel,
		&j.SalaryMin, &j.SalaryMax, &j.SalaryCurrency,
		&j.InputMethod, &j.RawInputRef,
		&j.ExtractionStatus, &j.ExtractionError,
		&j.MatchScore, &j.AlignmentStatus, &j.AlignmentError,
		&j.PDFR2Key, &j.PDFGeneratedAt,
		&j.Status, &j.AppliedAt, &j.Notes,
		&j.CreatedAt, &j.UpdatedAt, &j.DeletedAt,
		&extractedJSON, &tailoredJSON,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil, nil
	}
	return &j, extractedJSON, tailoredJSON, err
}

func (r *pgxRepository) List(ctx context.Context, userID string, q ListJobsQuery) ([]Job, int, error) {
	// Build WHERE clause additions
	args := []any{userID}
	where := "user_id = $1 AND deleted_at IS NULL"
	idx := 2

	if q.Status != "" {
		where += " AND status = $" + itoa(idx)
		args = append(args, q.Status)
		idx++
	}
	if q.EmploymentType != "" {
		where += " AND employment_type = $" + itoa(idx)
		args = append(args, q.EmploymentType)
		idx++
	}
	if q.IsRemote != nil {
		where += " AND is_remote = $" + itoa(idx)
		args = append(args, *q.IsRemote)
		idx++
	}
	if q.MinMatch != nil {
		where += " AND match_score >= $" + itoa(idx)
		args = append(args, *q.MinMatch)
		idx++
	}
	if q.Search != "" {
		where += " AND (job_title ILIKE $" + itoa(idx) + " OR company ILIKE $" + itoa(idx) + ")"
		args = append(args, "%"+q.Search+"%")
		idx++
	}

	orderBy := "created_at DESC"
	if q.Sort == "best_match" {
		orderBy = "match_score DESC NULLS LAST, created_at DESC"
	}

	// Count total
	var total int
	countArgs := make([]any, len(args))
	copy(countArgs, args)
	if err := r.db.QueryRow(ctx,
		"SELECT COUNT(*) FROM jobs WHERE "+where, countArgs...,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	offset := (q.Page - 1) * q.PageSize
	args = append(args, q.PageSize, offset)
	limitIdx := itoa(idx)
	offsetIdx := itoa(idx + 1)

	rows, err := r.db.Query(ctx,
		"SELECT "+jobCols+" FROM jobs WHERE "+where+
			" ORDER BY "+orderBy+
			" LIMIT $"+limitIdx+" OFFSET $"+offsetIdx,
		args...,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var jobs []Job
	for rows.Next() {
		var j Job
		if err := rows.Scan(
			&j.ID, &j.UserID, &j.ResumeID,
			&j.JobTitle, &j.Company, &j.Location, &j.IsRemote, &j.JobURL,
			&j.EmploymentType, &j.ExperienceLevel,
			&j.SalaryMin, &j.SalaryMax, &j.SalaryCurrency,
			&j.InputMethod, &j.RawInputRef,
			&j.ExtractionStatus, &j.ExtractionError,
			&j.MatchScore, &j.AlignmentStatus, &j.AlignmentError,
			&j.PDFR2Key, &j.PDFGeneratedAt,
			&j.Status, &j.AppliedAt, &j.Notes,
			&j.CreatedAt, &j.UpdatedAt, &j.DeletedAt,
		); err != nil {
			return nil, 0, err
		}
		jobs = append(jobs, j)
	}
	return jobs, total, rows.Err()
}

func (r *pgxRepository) UpdateExtractionStatus(ctx context.Context, id, status string, extractedJSON, errMsg *string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE jobs
		SET extraction_status = $2,
		    extracted_job_json = CASE WHEN $3::text IS NOT NULL THEN $3::jsonb ELSE extracted_job_json END,
		    extraction_error   = $4,
		    updated_at         = NOW()
		WHERE id = $1`,
		id, status, extractedJSON, errMsg,
	)
	return err
}

func (r *pgxRepository) UpdateAlignmentStatus(ctx context.Context, id, status string, alignmentJSON *string, matchScore *int, errMsg *string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE jobs
		SET alignment_status      = $2,
		    tailored_resume_json  = CASE WHEN $3::text IS NOT NULL THEN $3::jsonb ELSE tailored_resume_json END,
		    match_score           = COALESCE($4, match_score),
		    alignment_error       = $5,
		    updated_at            = NOW()
		WHERE id = $1`,
		id, status, alignmentJSON, matchScore, errMsg,
	)
	return err
}

func (r *pgxRepository) UpdatePDF(ctx context.Context, id, r2Key string, generatedAt time.Time) error {
	_, err := r.db.Exec(ctx, `
		UPDATE jobs
		SET pdf_r2_key       = $2,
		    pdf_generated_at = $3,
		    updated_at       = NOW()
		WHERE id = $1`,
		id, r2Key, generatedAt,
	)
	return err
}

func (r *pgxRepository) UpdateJobFields(ctx context.Context, id string, f JobFields) error {
	_, err := r.db.Exec(ctx, `
		UPDATE jobs
		SET job_title        = $2,
		    company          = $3,
		    location         = $4,
		    is_remote        = $5,
		    employment_type  = $6,
		    experience_level = $7,
		    salary_min       = $8,
		    salary_max       = $9,
		    salary_currency  = $10,
		    updated_at       = NOW()
		WHERE id = $1`,
		id,
		f.JobTitle, f.Company, f.Location, f.IsRemote,
		f.EmploymentType, f.ExperienceLevel,
		f.SalaryMin, f.SalaryMax, f.SalaryCurrency,
	)
	return err
}

func (r *pgxRepository) UpdateStatus(ctx context.Context, id, userID, status string, appliedAt *time.Time, notes *string) (*Job, error) {
	row := r.db.QueryRow(ctx, `
		UPDATE jobs
		SET status     = $3,
		    applied_at = COALESCE($4, applied_at),
		    notes      = COALESCE($5, notes),
		    updated_at = NOW()
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
		RETURNING `+jobCols,
		id, userID, status, appliedAt, notes,
	)
	return scanJob(row)
}

func (r *pgxRepository) SoftDelete(ctx context.Context, id, userID string) (*Job, error) {
	row := r.db.QueryRow(ctx, `
		UPDATE jobs
		SET deleted_at = NOW(), updated_at = NOW()
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
		RETURNING `+jobCols,
		id, userID,
	)
	return scanJob(row)
}

func (r *pgxRepository) FindDuplicate(ctx context.Context, userID, jobURL string, since time.Time) (*Job, error) {
	row := r.db.QueryRow(ctx, `
		SELECT `+jobCols+`
		FROM jobs
		WHERE user_id = $1
		  AND job_url = $2
		  AND created_at >= $3
		  AND deleted_at IS NULL
		ORDER BY created_at DESC
		LIMIT 1`,
		userID, jobURL, since,
	)
	return scanJob(row)
}

func itoa(n int) string { return strconv.Itoa(n) }

// UserProfile holds the minimal user info needed for autofill context.
type UserProfile struct {
	FullName string
	Email    string
}

// ChatMessage holds a single message for autofill chat context.
type ChatMessage struct {
	Role    string
	Content string
}

func (r *pgxRepository) GetUserProfile(ctx context.Context, userID string) (*UserProfile, error) {
	var p UserProfile
	err := r.db.QueryRow(ctx, `SELECT full_name, email FROM users WHERE id = $1`, userID).Scan(&p.FullName, &p.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &p, err
}

func (r *pgxRepository) GetRecentChatMessagesForJob(ctx context.Context, jobID, userID string, limit int) ([]ChatMessage, error) {
	rows, err := r.db.Query(ctx, `
		SELECT m.role, m.content
		FROM chat_messages m
		JOIN chat_sessions s ON s.id = m.session_id
		WHERE s.job_id = $1 AND s.user_id = $2 AND m.is_error = false
		ORDER BY m.created_at DESC
		LIMIT $3`,
		jobID, userID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var msgs []ChatMessage
	for rows.Next() {
		var m ChatMessage
		if err := rows.Scan(&m.Role, &m.Content); err != nil {
			return nil, err
		}
		msgs = append(msgs, m)
	}
	// Reverse so oldest first
	for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
		msgs[i], msgs[j] = msgs[j], msgs[i]
	}
	return msgs, rows.Err()
}

func (r *pgxRepository) CreateFromPreview(ctx context.Context, j Job) (*Job, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO jobs (user_id, resume_id, input_method, job_url, extraction_status, alignment_status)
		VALUES ($1, $2, 'extension', $3, 'completed', 'completed')
		RETURNING `+jobCols,
		j.UserID, j.ResumeID, j.JobURL,
	)
	return scanJob(row)
}

func (r *pgxRepository) GetResumeForJob(ctx context.Context, resumeID, userID string) (*ResumeRef, error) {
	var ref ResumeRef
	var jsonStr *string
	err := r.db.QueryRow(ctx, `
		SELECT id, extraction_status, extracted_json::text
		FROM resumes
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
		resumeID, userID,
	).Scan(&ref.ID, &ref.ExtractionStatus, &jsonStr)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	ref.ExtractedJSON = jsonStr
	return &ref, nil
}
