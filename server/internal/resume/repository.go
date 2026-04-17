package resume

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Resume struct {
	ID               string
	UserID           string
	Name             string
	OriginalFilename string
	FileFormat       string
	FileSizeBytes    int64
	R2ObjectKey      string
	ExtractionStatus string
	ExtractionError  *string
	UploadedAt       time.Time
	UpdatedAt        time.Time
	DeletedAt        *time.Time
	// extracted_json is intentionally excluded — never sent to clients
}

type Repository interface {
	Create(ctx context.Context, r Resume) (*Resume, error)
	GetByID(ctx context.Context, id, userID string) (*Resume, error)
	GetAllActive(ctx context.Context, userID string) ([]Resume, error)
	CountActive(ctx context.Context, userID string) (int, error)
	UpdateExtraction(ctx context.Context, id, status string, extractedJSON, errMsg *string) error
	SoftDelete(ctx context.Context, id, userID string) (*Resume, error)
	CountActiveAfterDelete(ctx context.Context, userID string) (int, error)
}

type pgxRepository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) Repository {
	return &pgxRepository{db: db}
}

const resumeCols = `id, user_id, name, original_filename, file_format, file_size_bytes,
	r2_object_key, extraction_status, extraction_error, uploaded_at, updated_at, deleted_at`

func scanResume(row pgx.Row) (*Resume, error) {
	var r Resume
	err := row.Scan(
		&r.ID, &r.UserID, &r.Name, &r.OriginalFilename, &r.FileFormat,
		&r.FileSizeBytes, &r.R2ObjectKey, &r.ExtractionStatus, &r.ExtractionError,
		&r.UploadedAt, &r.UpdatedAt, &r.DeletedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &r, err
}

func (r *pgxRepository) Create(ctx context.Context, res Resume) (*Resume, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO resumes
			(user_id, name, original_filename, file_format, file_size_bytes, r2_object_key, extraction_status)
		VALUES ($1, $2, $3, $4, $5, $6, 'processing')
		RETURNING `+resumeCols,
		res.UserID, res.Name, res.OriginalFilename, res.FileFormat,
		res.FileSizeBytes, res.R2ObjectKey,
	)
	return scanResume(row)
}

func (r *pgxRepository) GetByID(ctx context.Context, id, userID string) (*Resume, error) {
	row := r.db.QueryRow(ctx, `
		SELECT `+resumeCols+`
		FROM resumes
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
		id, userID,
	)
	return scanResume(row)
}

func (r *pgxRepository) GetAllActive(ctx context.Context, userID string) ([]Resume, error) {
	rows, err := r.db.Query(ctx, `
		SELECT `+resumeCols+`
		FROM resumes
		WHERE user_id = $1 AND deleted_at IS NULL
		ORDER BY uploaded_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var resumes []Resume
	for rows.Next() {
		var res Resume
		if err := rows.Scan(
			&res.ID, &res.UserID, &res.Name, &res.OriginalFilename, &res.FileFormat,
			&res.FileSizeBytes, &res.R2ObjectKey, &res.ExtractionStatus, &res.ExtractionError,
			&res.UploadedAt, &res.UpdatedAt, &res.DeletedAt,
		); err != nil {
			return nil, err
		}
		resumes = append(resumes, res)
	}
	return resumes, rows.Err()
}

func (r *pgxRepository) CountActive(ctx context.Context, userID string) (int, error) {
	var n int
	err := r.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM resumes
		WHERE user_id = $1 AND deleted_at IS NULL`,
		userID,
	).Scan(&n)
	return n, err
}

func (r *pgxRepository) UpdateExtraction(ctx context.Context, id, status string, extractedJSON, errMsg *string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE resumes
		SET extraction_status = $2,
		    extracted_json   = CASE WHEN $3::text IS NOT NULL THEN $3::jsonb ELSE extracted_json END,
		    extraction_error = $4,
		    updated_at       = NOW()
		WHERE id = $1`,
		id, status, extractedJSON, errMsg,
	)
	return err
}

func (r *pgxRepository) SoftDelete(ctx context.Context, id, userID string) (*Resume, error) {
	row := r.db.QueryRow(ctx, `
		UPDATE resumes
		SET deleted_at = NOW(), updated_at = NOW()
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
		RETURNING `+resumeCols,
		id, userID,
	)
	return scanResume(row)
}

func (r *pgxRepository) CountActiveAfterDelete(ctx context.Context, userID string) (int, error) {
	return r.CountActive(ctx, userID)
}
