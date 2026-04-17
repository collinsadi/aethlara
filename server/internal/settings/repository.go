package settings

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// APIKeyRecord is the raw DB row — encrypted_key never leaves this package.
type APIKeyRecord struct {
	ID               string
	UserID           string
	EncryptedKey     string // never serialised in any response
	KeyPrefix        string
	Provider         string
	Label            *string
	LastUsedAt       *time.Time
	LastValidatedAt  *time.Time
	ValidationStatus string
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// EmailChangeRequest is the raw DB row for a pending email-change OTP.
type EmailChangeRequest struct {
	ID        string
	UserID    string
	NewEmail  string
	OTPHash   string
	Attempts  int
	Used      bool
	ExpiresAt time.Time
	CreatedAt time.Time
}

type Repository interface {
	// API key
	UpsertAPIKey(ctx context.Context, userID, encryptedKey, keyPrefix, provider string, label *string) (*APIKeyRecord, error)
	GetAPIKeyByUserID(ctx context.Context, userID string) (*APIKeyRecord, error)
	HasValidAPIKey(ctx context.Context, userID string) (bool, error) // used by AIGate middleware
	DeleteAPIKey(ctx context.Context, userID string) error
	UpdateAPIKeyValidation(ctx context.Context, userID, status string, validatedAt time.Time) error
	UpdateAPIKeyLastUsed(ctx context.Context, userID string, usedAt time.Time) error

	// Profile
	UpdateFullName(ctx context.Context, userID, fullName string) error

	// Email change
	InvalidateEmailChangeRequests(ctx context.Context, userID string) error
	CreateEmailChangeRequest(ctx context.Context, userID, newEmail, otpHash string, expiresAt time.Time) error
	GetPendingEmailChangeRequest(ctx context.Context, userID, newEmail string) (*EmailChangeRequest, error)
	IncrementEmailChangeAttempts(ctx context.Context, id string) (int, error)
	MarkEmailChangeUsed(ctx context.Context, id string) error
	UpdateUserEmail(ctx context.Context, userID, newEmail string) error
}

type pgxRepository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) Repository {
	return &pgxRepository{db: db}
}

func (r *pgxRepository) UpsertAPIKey(ctx context.Context, userID, encryptedKey, keyPrefix, provider string, label *string) (*APIKeyRecord, error) {
	var rec APIKeyRecord
	err := r.db.QueryRow(ctx, `
		INSERT INTO api_keys (user_id, encrypted_key, key_prefix, provider, label, validation_status, last_validated_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, 'valid', NOW(), NOW())
		ON CONFLICT (user_id, provider) DO UPDATE SET
			encrypted_key     = EXCLUDED.encrypted_key,
			key_prefix        = EXCLUDED.key_prefix,
			label             = EXCLUDED.label,
			validation_status = 'valid',
			last_validated_at = NOW(),
			updated_at        = NOW()
		RETURNING id, user_id, key_prefix, provider, label, last_used_at, last_validated_at, validation_status, created_at, updated_at
	`, userID, encryptedKey, keyPrefix, provider, label).Scan(
		&rec.ID, &rec.UserID, &rec.KeyPrefix, &rec.Provider, &rec.Label,
		&rec.LastUsedAt, &rec.LastValidatedAt, &rec.ValidationStatus,
		&rec.CreatedAt, &rec.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

func (r *pgxRepository) GetAPIKeyByUserID(ctx context.Context, userID string) (*APIKeyRecord, error) {
	var rec APIKeyRecord
	err := r.db.QueryRow(ctx, `
		SELECT id, user_id, encrypted_key, key_prefix, provider, label,
		       last_used_at, last_validated_at, validation_status, created_at, updated_at
		FROM api_keys
		WHERE user_id = $1 AND provider = 'openrouter'
	`, userID).Scan(
		&rec.ID, &rec.UserID, &rec.EncryptedKey, &rec.KeyPrefix, &rec.Provider, &rec.Label,
		&rec.LastUsedAt, &rec.LastValidatedAt, &rec.ValidationStatus,
		&rec.CreatedAt, &rec.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

func (r *pgxRepository) HasValidAPIKey(ctx context.Context, userID string) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM api_keys
			WHERE user_id = $1
			  AND provider = 'openrouter'
			  AND validation_status NOT IN ('revoked', 'invalid')
		)
	`, userID).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

func (r *pgxRepository) DeleteAPIKey(ctx context.Context, userID string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM api_keys WHERE user_id = $1 AND provider = 'openrouter'`, userID)
	return err
}

func (r *pgxRepository) UpdateAPIKeyValidation(ctx context.Context, userID, status string, validatedAt time.Time) error {
	_, err := r.db.Exec(ctx, `
		UPDATE api_keys SET validation_status = $2, last_validated_at = $3, updated_at = NOW()
		WHERE user_id = $1 AND provider = 'openrouter'
	`, userID, status, validatedAt)
	return err
}

func (r *pgxRepository) UpdateAPIKeyLastUsed(ctx context.Context, userID string, usedAt time.Time) error {
	_, err := r.db.Exec(ctx, `
		UPDATE api_keys SET last_used_at = $2, updated_at = NOW()
		WHERE user_id = $1 AND provider = 'openrouter'
	`, userID, usedAt)
	return err
}

func (r *pgxRepository) UpdateFullName(ctx context.Context, userID, fullName string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE users SET full_name = $2, updated_at = NOW() WHERE id = $1
	`, userID, fullName)
	return err
}

func (r *pgxRepository) InvalidateEmailChangeRequests(ctx context.Context, userID string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE email_change_requests SET used = true
		WHERE user_id = $1 AND used = false
	`, userID)
	return err
}

func (r *pgxRepository) CreateEmailChangeRequest(ctx context.Context, userID, newEmail, otpHash string, expiresAt time.Time) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO email_change_requests (user_id, new_email, otp_hash, expires_at)
		VALUES ($1, $2, $3, $4)
	`, userID, newEmail, otpHash, expiresAt)
	return err
}

func (r *pgxRepository) GetPendingEmailChangeRequest(ctx context.Context, userID, newEmail string) (*EmailChangeRequest, error) {
	var req EmailChangeRequest
	err := r.db.QueryRow(ctx, `
		SELECT id, user_id, new_email, otp_hash, attempts, used, expires_at, created_at
		FROM email_change_requests
		WHERE user_id = $1 AND new_email = $2 AND used = false
		ORDER BY created_at DESC
		LIMIT 1
	`, userID, newEmail).Scan(
		&req.ID, &req.UserID, &req.NewEmail, &req.OTPHash,
		&req.Attempts, &req.Used, &req.ExpiresAt, &req.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &req, nil
}

func (r *pgxRepository) IncrementEmailChangeAttempts(ctx context.Context, id string) (int, error) {
	var attempts int
	err := r.db.QueryRow(ctx, `
		UPDATE email_change_requests SET attempts = attempts + 1
		WHERE id = $1
		RETURNING attempts
	`, id).Scan(&attempts)
	return attempts, err
}

func (r *pgxRepository) MarkEmailChangeUsed(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `UPDATE email_change_requests SET used = true WHERE id = $1`, id)
	return err
}

func (r *pgxRepository) UpdateUserEmail(ctx context.Context, userID, newEmail string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE users SET email = $2, updated_at = NOW() WHERE id = $1
	`, userID, newEmail)
	return err
}
